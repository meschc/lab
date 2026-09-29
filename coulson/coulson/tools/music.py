"""Музыка: включить песню/исполнителя в Яндекс Музыке (веб в браузере пользователя) — поиск + клик зрением.
Пауза/следующий трек работают системными медиаклавишами (sound), в том числе для Яндекс Музыки в браузере."""
from __future__ import annotations

import time
import urllib.parse

from .mouse import click_at, to_screen


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


def play_music(ctx, query: str) -> str:
    from .web import _open_in_browser

    conf = ctx.cfg.get("music") or {}
    url = conf.get("search_url", "https://music.yandex.ru/search?text={}").format(urllib.parse.quote(query))
    if _open_in_browser(ctx, url) != "OK":
        return "Ошибка: не открылся браузер"
    if not getattr(ctx, "locate", None):
        return f"Открыл поиск «{query}» в Яндекс Музыке — нажми воспроизведение"
    time.sleep(float(conf.get("load_wait", 4)))
    point = _locate_on_screen(ctx, "кнопка воспроизведения (play) у первого трека в результатах поиска")
    double = False
    if point is None:
        point = _locate_on_screen(ctx, "первый трек в списке результатов поиска (строка с названием песни)")
        double = True
    if point is None:
        return f"Ошибка: открыл поиск «{query}», но не нашёл, что нажать — возможно, нужно войти в Яндекс Музыку"
    click_at(*to_screen(*point), double=double)
    return f"Включаю «{query}» в Яндекс Музыке"
