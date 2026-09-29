"""Сообщения в мессенджерах (MAX/Макс, Telegram, WhatsApp…) через интерфейс приложения.

Порядок: подтверждение у пользователя → открыть приложение → поиск контакта → Enter (открыть чат) →
ПРОВЕРКА зрением, что открыт чат именно с этим контактом (иначе стоп — не отправляем не тому) →
вставить вложение (скриншот/файл) и текст → Enter. У каждого мессенджера свой хоткей поиска (config).
"""
from __future__ import annotations

import logging
import tempfile
import time
from pathlib import Path

from . import osascript, registry, run

log = logging.getLogger(__name__)

DEFAULTS = {
    "max": {"app": "MAX", "search": "cmd+f"},
    "telegram": {"app": "Telegram", "search": "cmd+f"},
    "whatsapp": {"app": "WhatsApp", "search": "cmd+f"},
}
_NAMES = {"макс": "max", "max": "max", "телеграм": "telegram", "телега": "telegram", "telegram": "telegram",
          "вотсап": "whatsapp", "ватсап": "whatsapp", "whatsapp": "whatsapp"}


def _messenger(ctx, app: str) -> dict:
    key = _NAMES.get(app.strip().lower(), app.strip().lower())
    conf = dict(DEFAULTS.get(key, {"app": app, "search": "cmd+f"}))
    conf.update((ctx.cfg.get("messengers") or {}).get(key, {}) or {})
    return conf


def copy_image_to_clipboard(path: str) -> str:
    kind = "«class PNGf»" if path.lower().endswith(".png") else "JPEG picture"
    return osascript(f'set the clipboard to (read (POSIX file "{path}") as {kind})')


def copy_file_to_clipboard(path: str) -> str:
    return osascript(f'set the clipboard to (POSIX file "{path}")')


def _risk(ctx, app: str, contact: str, text: str = "", attach: str = "none", path: str = "") -> str:
    what = {"screenshot": "скриншот", "file": f"файл {Path(path).name}"}.get(attach, "")
    what = " и ".join(x for x in (what, f"текст «{text[:60]}»" if text else "") if x) or "сообщение"
    return f"отправить {what} контакту «{contact}» в {_messenger(ctx, app)['app']}"


@registry.add("message", "Send a message to a person in a messenger app (MAX/Макс, Telegram, WhatsApp): text and/or "
              "a screenshot of the screen or a file. contact — the name AS SAVED in the messenger (users call "
              "people by nicknames — look it up in memory first).",
              {"app": ("string", "messenger"), "contact": ("string", "saved contact name"), "text": ("string", ""),
               "attach": ("string", ""), "path": ("string", "file path for attach=file")},
              ["app", "contact"], enums={"attach": ["none", "screenshot", "file"]}, risk=_risk)
def message(ctx, app: str, contact: str, text: str = "", attach: str = "none", path: str = "") -> str:
    from .system import _pbcopy, _pbpaste, parse_keys

    conf = _messenger(ctx, app)
    shot = None
    if attach == "screenshot":  # снимок ДО переключения в мессенджер — чтобы на нём был текущий экран
        shot = Path(tempfile.gettempdir()) / f"coulson_send_{time.time_ns()}.png"
        run(["screencapture", "-x", "-D", "1", str(shot)], timeout=15)
        if not shot.exists():
            return "Ошибка: не удалось сделать снимок экрана (разрешение «Запись экрана»)"
    if attach == "file":
        from .files import resolve
        path = str(resolve(ctx, path))
        if not Path(path).exists():
            return f"Ошибка: файл не найден: {path}"

    def keys(combo: str) -> None:
        action, mods = parse_keys(combo)
        using = f" using {{{', '.join(mods)}}}" if mods else ""
        osascript(f'tell application "System Events" to {action}{using}')

    def paste_text(s: str) -> None:
        _pbcopy(s)
        keys("cmd+v")
        time.sleep(0.3)

    old_clip = _pbpaste()
    try:
        if run(["open", "-a", conf["app"]]) != "OK":
            return f"Ошибка: не открылось приложение {conf['app']}"
        time.sleep(1.5)
        keys(conf["search"])
        time.sleep(0.5)
        paste_text(contact)
        time.sleep(1.5)
        keys("enter")
        time.sleep(1.2)
        # Главная защита: убедиться, что открыт нужный чат, — иначе не отправляем
        if getattr(ctx, "locate", None):
            from .vision import _capture_screen, _shrink
            check = _capture_screen(1)
            if not isinstance(check, str):
                img = _shrink(check, int(ctx.cfg.vision.max_width))
                try:
                    from PIL import Image
                    point = ctx.locate(f"заголовок открытого чата с контактом «{contact}» (имя вверху переписки)",
                                       str(img), Image.open(img).size)
                finally:
                    img.unlink(missing_ok=True)
                if point is None:
                    keys("esc")
                    return f"Ошибка: не уверен, что открыл чат с «{contact}» — ничего не отправил. Проверь имя контакта."
        if shot is not None:
            copy_image_to_clipboard(str(shot))
            keys("cmd+v")
            time.sleep(1.5)  # у многих мессенджеров появляется окно вложения — текст пойдёт подписью
        elif attach == "file":
            copy_file_to_clipboard(path)
            keys("cmd+v")
            time.sleep(1.5)
        if text:
            paste_text(text)
        keys("enter")
        time.sleep(0.8)
    finally:
        _pbcopy(old_clip)
        if shot is not None:
            shot.unlink(missing_ok=True)
    return f"Отправил контакту «{contact}» в {conf['app']}."
