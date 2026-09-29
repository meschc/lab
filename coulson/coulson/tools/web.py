"""Интернет: поиск, чтение страниц, открытие сайтов в Яндекс Браузере, погода."""
from __future__ import annotations

import re
import urllib.parse

from . import osascript, registry, run

_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) "
                     "Chrome/126.0 Safari/537.36"}


def _open_in_browser(ctx, url: str) -> str:
    app = ctx.cfg.browser.app
    res = run(["open", "-a", app, url]) if app else "fail"
    if res != "OK":
        res = run(["open", url])
    return res


@registry.add("open_url", "Open a URL or domain in the browser.", {"url": ("string", "")}, ["url"])
def open_url(ctx, url: str) -> str:
    url = url.strip()
    if not re.match(r"^[a-z][a-z0-9+.-]*://", url, re.I):
        if re.match(r"^[\w.-]+\.[a-zа-я]{2,}(/.*)?$", url, re.I):
            url = "https://" + url
        else:
            url = "https://yandex.ru/search/?text=" + urllib.parse.quote(url)
    res = _open_in_browser(ctx, url)
    return f"Открыл {url}" if res == "OK" else res


_ENGINES = {
    "yandex": "https://yandex.ru/search/?text={}",
    "google": "https://www.google.com/search?q={}",
    "youtube": "https://www.youtube.com/results?search_query={}",
    "maps": "https://yandex.ru/maps/?text={}",
    "market": "https://market.yandex.ru/search?text={}",
    "wikipedia": "https://ru.wikipedia.org/w/index.php?search={}",
    "github": "https://github.com/search?q={}",
}


@registry.add("browser_search", "Open search results in the browser for the user to SEE (YouTube, maps…).",
              {"query": ("string", ""), "engine": ("string", "")}, ["query"],
              enums={"engine": list(_ENGINES)})
def browser_search(ctx, query: str, engine: str = "yandex") -> str:
    url = _ENGINES.get(engine, _ENGINES["yandex"]).format(urllib.parse.quote(query))
    res = _open_in_browser(ctx, url)
    return f"Открыл поиск «{query}» ({engine})" if res == "OK" else res


def _yandex_key(ctx) -> str:
    import os
    import subprocess
    key = os.environ.get("YANDEX_SEARCH_API_KEY") or (ctx.cfg.get("search") or {}).get("yandex_api_key") or ""
    if not key:
        try:
            p = subprocess.run(["security", "find-generic-password", "-a", "coulson", "-s", "coulson-yandex-search",
                                "-w"], capture_output=True, text=True, timeout=5)
            key = p.stdout.strip() if p.returncode == 0 else ""
        except Exception:
            key = ""
    return key


def yandex_search(ctx, query: str, n: int = 5) -> list[dict]:
    """Официальный Yandex Search API (Yandex Cloud): API-ключ сервисного аккаунта + folder_id.
    Ответ — XML в base64. Без ключа — пустой список (тогда запасной поиск)."""
    import base64
    import xml.etree.ElementTree as ET

    import httpx

    c = ctx.cfg.get("search") or {}
    key, folder = _yandex_key(ctx), c.get("yandex_folder_id") or ""
    if not key or not folder:
        return []
    r = httpx.post("https://searchapi.api.cloud.yandex.net/v2/web/search", timeout=20,
                   headers={"Authorization": f"Api-Key {key}"},
                   json={"query": {"searchType": "SEARCH_TYPE_RU", "queryText": query},
                         "groupSpec": {"groupMode": "GROUP_MODE_DEEP", "groupsOnPage": str(n), "docsInGroup": "1"},
                         "maxPassages": "2", "region": str(c.get("region", 213)), "l10n": "LOCALIZATION_RU",
                         "folderId": folder, "responseFormat": "FORMAT_XML"})
    r.raise_for_status()
    root = ET.fromstring(base64.b64decode(r.json()["rawData"]))
    text = lambda el: re.sub(r"\s+", " ", "".join(el.itertext())).strip() if el is not None else ""  # noqa: E731
    out = []
    for doc in root.iter("doc"):
        body = " ".join(text(p) for p in doc.iter("passage")) or text(doc.find("headline"))
        out.append({"title": text(doc.find("title")), "href": text(doc.find("url")), "body": body})
    return out[:n]


@registry.add("web_search", "Search the internet; returns results for YOU to answer from (then read_webpage).",
              {"query": ("string", ""), "max_results": ("integer", "")}, ["query"])
def web_search(ctx, query: str, max_results: int = 5) -> str:
    n = max(1, min(int(max_results), 10))
    results: list[dict] = []
    engine = (ctx.cfg.get("search") or {}).get("engine", "auto")
    if engine in ("auto", "yandex"):
        try:
            results = yandex_search(ctx, query, n)
        except Exception as e:
            if engine == "yandex":
                return f"Ошибка Yandex Search API: {e}"
    if not results:
        from ddgs import DDGS
        results = list(DDGS().text(query, max_results=n, region="ru-ru"))
    lines = [f"{i}. {r.get('title')}\n{r.get('href')}\n{r.get('body')}" for i, r in enumerate(results, 1)]
    return "\n\n".join(lines) or "Ничего не найдено"


@registry.add("read_webpage", "Main text of a web page.", {"url": ("string", "")}, ["url"])
def read_webpage(ctx, url: str) -> str:
    import httpx
    import trafilatura

    try:
        r = httpx.get(url, headers=_UA, timeout=20, follow_redirects=True)
        r.raise_for_status()
        text = trafilatura.extract(r.text, include_comments=False, include_tables=True, url=url) or ""
    except Exception:
        text = ""
    if len(text) < 400:  # сайт на JavaScript или не пустил простой запрос — открываем во внутреннем браузере
        try:
            from ..browser_engine import engine
            engine(ctx.cfg).open(url)
            return engine(ctx.cfg).text()
        except Exception as e:
            if not text:
                return f"Ошибка: не удалось прочитать страницу: {e}"
    return text[:6000]


@registry.add("browser_tab", "URL and title of the active browser tab.")
def browser_tab(ctx) -> str:
    app = ctx.cfg.browser.app
    return osascript(f'tell application "{app}" to return (URL of active tab of front window) & " | " & '
                     f'(title of active tab of front window)')


_WMO = {0: "ясно", 1: "в основном ясно", 2: "переменная облачность", 3: "пасмурно", 45: "туман", 48: "изморозь",
        51: "слабая морось", 53: "морось", 55: "сильная морось", 56: "ледяная морось", 57: "ледяная морось",
        61: "небольшой дождь", 63: "дождь", 65: "сильный дождь", 66: "ледяной дождь", 67: "ледяной дождь",
        71: "небольшой снег", 73: "снег", 75: "сильный снег", 77: "снежная крупа", 80: "ливень", 81: "ливень",
        82: "сильный ливень", 85: "снегопад", 86: "сильный снегопад", 95: "гроза", 96: "гроза с градом",
        99: "гроза с градом"}


def forecast(lat: float, lon: float, days: int = 3) -> dict:
    import httpx
    return httpx.get("https://api.open-meteo.com/v1/forecast", params={
        "latitude": lat, "longitude": lon, "timezone": "auto", "forecast_days": days, "wind_speed_unit": "ms",
        "current": "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m",
        "daily": "weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max",
    }, timeout=15).json()


def weather_text(place, days: int = 3, short: bool = False) -> str:
    d = forecast(place.lat, place.lon, days)
    cur, day = d["current"], d["daily"]
    now = (f"{place}: сейчас {round(cur['temperature_2m'])}°, ощущается как {round(cur['apparent_temperature'])}°, "
           f"{_WMO.get(cur['weather_code'], '')}")
    if short:  # для утренней сводки
        rain = day["precipitation_probability_max"][0]
        return (f"{now}, днём до {round(day['temperature_2m_max'][0])}°"
                + (f", вероятность осадков {rain}%" if rain and rain >= 40 else "") + ".")
    out = [now + f", ветер {round(cur['wind_speed_10m'])} м/с, влажность {cur['relative_humidity_2m']}%"]
    for i, date in enumerate(day["time"][:days]):
        out.append(f"{date}: {round(day['temperature_2m_min'][i])}…{round(day['temperature_2m_max'][i])}°, "
                   f"{_WMO.get(day['weather_code'][i], '')}, осадки {day['precipitation_probability_max'][i]}%")
    return "\n".join(out)


@registry.add("weather", "Weather now and 3-day forecast.", {"city": ("string", "empty = where the user is now")})
def weather(ctx, city: str = "") -> str:
    from .. import location

    place = location.geocode(city) if city.strip() else location.current(ctx.cfg)
    if place is None:
        return ("Ошибка: не знаю, где ты. " + (f"Не нашёл город «{city}»." if city else
                "Разреши Колсону геолокацию (Настройки → Конфиденциальность → Службы геолокации) "
                "или укажи location.home в config.local.yaml."))
    return weather_text(place)
