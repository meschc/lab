"""Где пользователь: для погоды, «что рядом», транспорта.

Порядок: 1) Службы геолокации macOS (CoreLocation, точность Wi-Fi — десятки метров, разрешение
«Геолокация → Колсон»); 2) `location.home` из настроек («Москва, Домодедовская» или «55.61,37.72»);
3) по внешнему IP — только если выход из своей страны (`location.home_country`), иначе это VPN-сервер.
Результат кэшируется на `location.cache_minutes`.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass

log = logging.getLogger(__name__)


@dataclass
class Place:
    lat: float
    lon: float
    name: str = ""
    source: str = ""  # corelocation | config | ip

    def __str__(self) -> str:
        return self.name or f"{self.lat:.3f}, {self.lon:.3f}"


_cache: tuple[float, Place | None] = (0.0, None)


def current(cfg) -> Place | None:
    global _cache
    c = cfg.get("location") or {}
    if _cache[1] and time.monotonic() - _cache[0] < float(c.get("cache_minutes", 30)) * 60:
        return _cache[1]
    place = None
    if c.get("use_system", True):
        place = _corelocation()
    if place is None and c.get("home"):
        place = parse_or_geocode(str(c["home"]))
        if place:
            place.source = "config"
    if place is None and c.get("use_ip", True):
        place = _by_ip(cfg)
    if place and not place.name:
        place.name = reverse_name(place.lat, place.lon)
    _cache = (time.monotonic(), place)
    return place


def parse_or_geocode(text: str) -> Place | None:
    m = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*", text)
    if m:
        return Place(float(m.group(1)), float(m.group(2)))
    return geocode(text)


def geocode(query: str) -> Place | None:
    """Город/адрес → координаты (Open-Meteo, без ключа)."""
    import httpx
    city = query.split(",")[0].strip()
    try:
        r = httpx.get("https://geocoding-api.open-meteo.com/v1/search",
                      params={"name": city, "count": 1, "language": "ru", "format": "json"}, timeout=10)
        res = (r.json().get("results") or [None])[0]
    except Exception as e:
        log.debug("geocode: %s", e)
        return None
    if not res:
        return None
    return Place(float(res["latitude"]), float(res["longitude"]), res.get("name", city), "geocode")


def reverse_name(lat: float, lon: float) -> str:
    import httpx
    try:
        r = httpx.get("https://nominatim.openstreetmap.org/reverse",
                      params={"lat": lat, "lon": lon, "format": "json", "zoom": 14, "accept-language": "ru"},
                      headers={"User-Agent": "Coulson-assistant/1.0"}, timeout=10)
        a = r.json().get("address", {})
        parts = [a.get(k) for k in ("suburb", "city_district", "city", "town", "village") if a.get(k)]
        return ", ".join(dict.fromkeys(parts[:2]))
    except Exception:
        return ""


def _corelocation(timeout: float = 8.0) -> Place | None:
    try:
        import CoreLocation
        import Foundation
    except Exception:
        return None
    try:
        mgr = CoreLocation.CLLocationManager.alloc().init()
        status = mgr.authorizationStatus() if hasattr(mgr, "authorizationStatus") \
            else CoreLocation.CLLocationManager.authorizationStatus()
        if status in (1, 2):  # restricted / denied — не мучаем
            return None
        got = threading.Event()

        class Delegate(Foundation.NSObject):
            def locationManager_didUpdateLocations_(self, m, locs):
                got.set()

            def locationManager_didFailWithError_(self, m, err):
                got.set()

            def locationManagerDidChangeAuthorization_(self, m):
                pass

        delegate = Delegate.alloc().init()
        mgr.setDelegate_(delegate)
        mgr.setDesiredAccuracy_(CoreLocation.kCLLocationAccuracyHundredMeters)
        if status == 0:
            mgr.requestWhenInUseAuthorization()
        mgr.startUpdatingLocation()
        end = time.monotonic() + timeout
        while not got.is_set() and time.monotonic() < end:  # делегату нужен работающий run loop
            Foundation.NSRunLoop.currentRunLoop().runUntilDate_(Foundation.NSDate.dateWithTimeIntervalSinceNow_(0.2))
        mgr.stopUpdatingLocation()
        loc = mgr.location()
        if loc is None:
            return None
        c = loc.coordinate()
        return Place(float(c.latitude), float(c.longitude), "", "corelocation")
    except Exception as e:
        log.debug("CoreLocation: %s", e)
        return None


def _by_ip(cfg) -> Place | None:
    """По IP — только если выход в интернет из своей страны (с VPN IP показывает страну сервера)."""
    import httpx
    home = str((cfg.get("location") or {}).get("home_country", "RU")).upper()
    try:
        d = httpx.get("https://ipinfo.io/json", timeout=8, headers={"User-Agent": "curl/8"}).json()
        if str(d.get("country", "")).upper() != home:
            return None
        lat, lon = (float(x) for x in d["loc"].split(","))
        return Place(lat, lon, d.get("city", ""), "ip")
    except Exception:
        return None
