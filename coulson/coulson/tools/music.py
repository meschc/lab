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


# ---------------------------------------------------------------- Яндекс Музыка через API аккаунта (основной путь)

from . import registry  # noqa: E402


def _connect(ctx) -> str:
    from .. import yamusic
    from .web import _open_in_browser

    m = yamusic.get(ctx.cfg)

    def on_code(url: str, code: str) -> None:
        _open_in_browser(ctx, url)
        spaced = " ".join(code)
        ctx.notify(f"Код для Яндекс Музыки: {code} (страница {url})")
        ctx.speak(f"Открыл страницу Яндекса. Введите код: {spaced}. Код также на экране.")

    m.login(on_code, lambda ok, text: ctx.speak(text))
    return "Запускаю вход в Яндекс Музыку: сейчас продиктую код, его нужно ввести на странице Яндекса."


@registry.add("music", "Yandex Music on the user's account (no browser): play a song/artist/album (query), "
              "my_wave («Моя волна»), liked (favourites), pause, resume, next, previous, now_playing, like, "
              "dislike, volume (level), connect (log into the account once).",
              {"action": ("string", ""), "query": ("string", "song, artist or album"),
               "level": ("integer", "volume 0-100")}, ["action"],
              enums={"action": ["play", "my_wave", "liked", "pause", "resume", "next", "previous", "now_playing",
                                "like", "dislike", "volume", "connect"]})
def music(ctx, action: str, query: str = "", level: int | None = None) -> str:
    from .. import yamusic

    if action == "connect":
        return _connect(ctx)
    m = yamusic.get(ctx.cfg)
    if not m.connected():
        if action == "play" and query:
            return play_music(ctx, query) + " (Яндекс Музыка не подключена — включил через браузер; скажите " \
                                            "«подключи Яндекс Музыку», чтобы работать напрямую)"
        return "Ошибка: Яндекс Музыка не подключена — скажите «подключи Яндекс Музыку»"
    try:
        if action == "play":
            return m.play(query) if query.strip() else m.pause(False)
        if action == "my_wave":
            return m.my_wave()
        if action == "liked":
            return m.liked()
        if action in ("pause", "resume"):
            return m.pause(action == "pause")
        if action == "next":
            return m.next()
        if action == "previous":
            return m.previous()
        if action == "now_playing":
            return m.now_playing()
        if action in ("like", "dislike"):
            return m.like(dislike=action == "dislike")
        if action == "volume":
            return m.volume(level if level is not None else 50)
    except PermissionError:
        return "Ошибка: Яндекс Музыка не подключена — скажите «подключи Яндекс Музыку»"
    except RuntimeError as e:
        return f"Ошибка: {e}"
    return f"Неизвестное действие {action}"
