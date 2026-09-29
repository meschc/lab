"""Транспорт: маршрут на общественном транспорте через Яндекс Карты.

Открытого API городских автобусов у Яндекса нет, поэтому: встроенный браузер открывает маршрут
(yandex.ru/maps/?rtext=A~B&rtt=mt) и читает текст панели с вариантами (время, номера автобусов, прибытие).
show=true — открыть тот же маршрут в браузере пользователя. Частые маршруты — в config transit.places.
"""
from __future__ import annotations

import time
import urllib.parse

from . import registry


def route_url(src: str, dst: str, mode: str = "mt") -> str:
    return "https://yandex.ru/maps/?" + urllib.parse.urlencode({"rtext": f"{src}~{dst}", "rtt": mode})


@registry.add("transit", "Public transport route and nearest buses between two places (Yandex Maps). "
              "Places: stop names, addresses or saved names like «дом».",
              {"src": ("string", "from; empty = home"), "dst": ("string", "to"),
               "show": ("boolean", "also open the map for the user")}, ["dst"])
def transit(ctx, dst: str, src: str = "", show: bool = False) -> str:
    c = ctx.cfg.get("transit") or {}
    places = {k.lower(): v for k, v in (c.get("places") or {}).items()}
    city = c.get("city", "Москва")

    def place(p: str) -> str:
        p = (p or "").strip()
        v = places.get(p.lower()) or (places.get("дом") if not p else None) or p
        return v if (city.lower() in v.lower() or "," in v) else f"{city}, {v}"

    if not dst.strip():
        return "Ошибка: куда ехать?"
    url = route_url(place(src), place(dst))
    if show:
        from .web import _open_in_browser
        _open_in_browser(ctx, url)
    try:
        from ..browser_engine import engine
        b = engine(ctx.cfg)
        b.open(url)
        time.sleep(float(c.get("wait_seconds", 4)))
        text = b.text()
    except Exception as e:
        return f"Ошибка: не открыл Яндекс Карты ({e}). Ссылка: {url}"
    if "robot" in text.lower() or "капч" in text.lower():
        return "Яндекс Карты попросили капчу — открой встроенный браузер (web look) или show=true. " + url
    return f"Маршрут ({url}). Текст с карты — выбери ближайшие варианты и время:\n{text[:3000]}"
