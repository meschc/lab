"""Музыка: включить конкретную песню/исполнителя в Яндекс Музыке.

По умолчанию — во встроенном браузере Колсона: открыть поиск → найти на снимке страницы кнопку
воспроизведения у строки именно с этой песней → нажать → проверить по плееру, что заиграло то, что просили.
Нужно один раз войти в Яндекс Музыку во встроенном браузере («Колсон, открой яндекс музыку у себя»).
music.browser: external — то же в браузере пользователя (клик по экрану).
"""
from __future__ import annotations

import time
import urllib.parse

from .mouse import click_at, to_screen

PLAY_TARGET = ("кнопка воспроизведения (play) в строке трека «{q}» в результатах поиска; если такой строки нет — "
               "кнопка воспроизведения первого трека")
PLAYING_CHECK = "панель плеера внизу, в которой сейчас играет трек «{q}»"


def _locate_on_screen(ctx, target: str):
    from PIL import Image

    from .vision import _capture_screen, _shrink

    shot = _capture_screen(1)
    if isinstance(shot, str):
        return None
    img = _shrink(shot, int(ctx.cfg.vision.max_width))
    try:
        return ctx.locate(target, str(img), Image.open(img).size)
    finally:
        img.unlink(missing_ok=True)


def _internal(ctx, query: str, url: str, wait: float) -> str:
    from ..browser_engine import engine

    b = engine(ctx.cfg)
    b.open(url)
    time.sleep(wait)
    res = b.click_vision(PLAY_TARGET.format(q=query), ctx.locate)
    if res.startswith("Ошибка"):
        return (f"Ошибка: открыл поиск «{query}» во встроенном браузере, но не нашёл кнопку воспроизведения — "
                "возможно, нужно войти в Яндекс Музыку (скажи «открой яндекс музыку у себя» и войди)")
    time.sleep(2.5)
    playing = b.locate_on_page(PLAYING_CHECK.format(q=query), ctx.locate)
    if playing is None:
        return f"Нажал воспроизведение, но не уверен, что играет именно «{query}» — проверь, пожалуйста"
    return f"Включаю «{query}» в Яндекс Музыке"


def play_music(ctx, query: str) -> str:
    conf = ctx.cfg.get("music") or {}
    url = conf.get("search_url", "https://music.yandex.ru/search?text={}").format(urllib.parse.quote(query))
    wait = float(conf.get("load_wait", 4))
    if not getattr(ctx, "locate", None):
        return "Ошибка: для выбора песни нужно зрение модели"
    if conf.get("browser", "internal") == "internal":
        return _internal(ctx, query, url, wait)
    from .web import _open_in_browser
    if _open_in_browser(ctx, url) != "OK":
        return "Ошибка: не открылся браузер"
    time.sleep(wait)
    point = _locate_on_screen(ctx, PLAY_TARGET.format(q=query))
    if point is None:
        return f"Ошибка: открыл поиск «{query}», но не нашёл кнопку воспроизведения"
    click_at(*to_screen(*point))
    return f"Включаю «{query}» в Яндекс Музыке"
