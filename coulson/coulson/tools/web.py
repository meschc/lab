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


@registry.add("web_search", "Search the internet; returns results for YOU to answer from (then read_webpage).",
              {"query": ("string", ""), "max_results": ("integer", "")}, ["query"])
def web_search(ctx, query: str, max_results: int = 5) -> str:
    from ddgs import DDGS

    results = DDGS().text(query, max_results=max(1, min(int(max_results), 10)), region="ru-ru")
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


@registry.add("weather", "Weather now and 3-day forecast.", {"city": ("string", "empty = by IP")})
def weather(ctx, city: str = "") -> str:
    import httpx

    r = httpx.get(f"https://wttr.in/{urllib.parse.quote(city)}", params={"format": "j1", "lang": "ru"},
                  headers=_UA, timeout=15)
    d = r.json()
    cur = d["current_condition"][0]
    area = d.get("nearest_area", [{}])[0].get("areaName", [{}])[0].get("value", city)
    desc = (cur.get("lang_ru") or cur.get("weatherDesc") or [{}])[0].get("value", "")
    out = [f"{area}: {cur['temp_C']}°C (ощущается {cur['FeelsLikeC']}°C), {desc}, ветер {cur['windspeedKmph']} км/ч, "
           f"влажность {cur['humidity']}%"]
    for day in d.get("weather", [])[:3]:
        out.append(f"{day['date']}: от {day['mintempC']} до {day['maxtempC']}°C")
    return "\n".join(out)
