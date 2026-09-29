"""Управление системой: громкость, медиа, таймеры, буфер обмена, shell, AppleScript, Shortcuts, файлы, VPN."""
from __future__ import annotations

import os
import re
import threading
import time
from pathlib import Path

from ..safety import applescript_risk, shell_risk
from . import osascript, registry, run


# ---------------------------------------------------------------- звук и медиа

_MEDIA_KEYS = {"play_pause": 16, "next": 17, "previous": 18}


@registry.add("sound", "System volume and media keys (play_pause/next/previous) for any player.",
              {"action": ("string", ""), "level": ("integer", "0-100 for set; step for up/down"),
               "query": ("string", "")}, ["action"],
              enums={"action": ["set", "up", "down", "mute", "unmute", "get", "play_pause", "next", "previous",
                                "play_song"]})
def sound(ctx, action: str, level: int | None = None, query: str = "") -> str:
    if action == "play_song":  # совместимость: песни теперь через music
        from .music import music
        return music(ctx, "play", query=query)
    if action in _MEDIA_KEYS:
        from .. import yamusic
        m = yamusic._music
        if m is not None and m.active():  # играет наш плеер Яндекс Музыки — управляем им напрямую
            return {"play_pause": m.pause, "next": m.next, "previous": m.previous}[action]()
        return _media_key(_MEDIA_KEYS[action])
    cur = int(osascript("output volume of (get volume settings)") or 0) if action in ("up", "down", "get") else 0
    if action == "get":
        return f"Громкость {cur}%"
    if action == "mute":
        return osascript("set volume with output muted")
    if action == "unmute":
        return osascript("set volume without output muted")
    step = int(level if level is not None else 15)
    target = {"set": step, "up": cur + step, "down": cur - step}[action]
    target = max(0, min(100, target))
    osascript(f"set volume output volume {target} without output muted")
    return f"Громкость {target}%"


def _media_key(key: int) -> str:
    import AppKit
    import Quartz

    for down in (True, False):
        ev = AppKit.NSEvent.otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2_(
            14, (0, 0), 0xA00 if down else 0xB00, 0, 0, 0, 8, (key << 16) | ((0xA if down else 0xB) << 8), -1)
        Quartz.CGEventPost(0, ev.CGEvent())
    return "OK"


# ---------------------------------------------------------------- состояние и действия

@registry.add("system_status", "Battery, free disk, Wi-Fi, uptime, date/time.")
def system_status(ctx) -> str:
    from ..brain import now_context
    parts = [now_context().strip("()").capitalize()]
    parts.append(run(["pmset", "-g", "batt"]).replace("Now drawing from", "Питание:"))
    st = os.statvfs(str(Path.home()))
    parts.append(f"Свободно на диске: {st.f_bavail * st.f_frsize / 1e9:.0f} ГБ")
    wifi = run("networksetup -getairportnetwork en0 2>/dev/null", shell=True)
    if "Current Wi-Fi Network:" in wifi:
        parts.append(f"Wi-Fi: {wifi.split(':', 1)[1].strip()}")
    parts.append(run(["uptime"]))
    return "\n".join(parts)


_ACTIONS = {
    "lock_screen": ("osascript -e 'tell application \"System Events\" to key code 12 using {control down, command down}'", None),
    "display_off": ("pmset displaysleepnow", None),
    "dark_mode_on": ("osascript -e 'tell application \"System Events\" to tell appearance preferences to set dark mode to true'", None),
    "dark_mode_off": ("osascript -e 'tell application \"System Events\" to tell appearance preferences to set dark mode to false'", None),
    "dark_mode_toggle": ("osascript -e 'tell application \"System Events\" to tell appearance preferences to set dark mode to not dark mode'", None),
    "show_desktop": ("osascript -e 'tell application \"System Events\" to key code 103'", None),
    "screenshot_to_desktop": ("screencapture -x ~/Desktop/Screenshot_$(date +%Y-%m-%d_%H-%M-%S).png", None),
    "empty_trash": ("osascript -e 'tell application \"Finder\" to empty trash'", "очистить корзину"),
    "sleep": ("pmset sleepnow", "перевести Мак в сон"),
    "restart": ("osascript -e 'tell application \"System Events\" to restart'", "перезагрузить Мак"),
    "shutdown": ("osascript -e 'tell application \"System Events\" to shut down'", "выключить Мак"),
    "logout": ("osascript -e 'tell application \"System Events\" to log out'", "выйти из учётной записи"),
}


@registry.add("system_action", "System action.",
              {"action": ("string", "")}, ["action"],
              risk=lambda ctx, action: _ACTIONS.get(action, (None, None))[1], enums={"action": list(_ACTIONS)})
def system_action(ctx, action: str) -> str:
    if action not in _ACTIONS:
        return f"Неизвестное действие. Доступны: {', '.join(_ACTIONS)}"
    return run(_ACTIONS[action][0], shell=True)


@registry.add("set_timer", "Timer/reminder: after N minutes say the message aloud and notify.",
              {"minutes": ("number", ""), "message": ("string", "")}, ["minutes"])
def set_timer(ctx, minutes: float, message: str = "") -> str:
    minutes = float(minutes)
    text = message or f"Таймер на {minutes:g} мин истёк"

    def fire():
        ctx.notify(text)
        osascript(f'display notification {_as_str(text)} with title "Колсон" sound name "Glass"')
        ctx.speak(f"Напоминаю: {text}")

    t = threading.Timer(minutes * 60, fire)
    t.daemon = True
    t.start()
    return f"Таймер поставлен на {time.strftime('%H:%M', time.localtime(time.time() + minutes * 60))}"


@registry.add("clipboard", "Read or write the clipboard.",
              {"action": ("string", ""), "text": ("string", "for set")}, ["action"],
              enums={"action": ["get", "set"]})
def clipboard(ctx, action: str, text: str = "") -> str:
    if action == "get":
        return _pbpaste()[:4000] or "(буфер пуст)"
    _pbcopy(text)
    return "Скопировал в буфер обмена"


_UTF8_ENV = {**os.environ, "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8"}  # иначе кириллица → «???»


def _pbpaste() -> str:
    import subprocess
    return subprocess.run(["pbpaste"], capture_output=True, text=True, encoding="utf-8", env=_UTF8_ENV,
                          timeout=10).stdout


def _pbcopy(text: str) -> None:
    import subprocess
    subprocess.run(["pbcopy"], input=text, text=True, encoding="utf-8", env=_UTF8_ENV, check=True, timeout=10)


@registry.add("type_text", "Type text into the focused field.", {"text": ("string", "")}, ["text"])
def type_text(ctx, text: str) -> str:
    # Через вставку из буфера: keystroke печатает кириллицу кракозябрами и зависит от раскладки
    old = _pbpaste()
    _pbcopy(text)
    res = osascript('tell application "System Events" to key code 9 using {command down}')
    time.sleep(0.4)
    _pbcopy(old)
    return "Напечатал" if res == "OK" else res


_KEY_CODES = {"esc": 53, "escape": 53, "enter": 36, "return": 36, "tab": 48, "space": 49, "пробел": 49,
              "delete": 51, "backspace": 51, "forwarddelete": 117, "left": 123, "right": 124, "down": 125, "up": 126,
              "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
              **{f"f{i}": c for i, c in enumerate([122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111], 1)}}
_MODS = {"cmd": "command down", "command": "command down", "⌘": "command down", "shift": "shift down",
         "alt": "option down", "option": "option down", "opt": "option down", "ctrl": "control down",
         "control": "control down"}


# Коды физических клавиш (ANSI): работают при любой раскладке, в том числе русской
_CHAR_CODES = {"a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
               "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
               "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34,
               "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46,
               ".": 47, "`": 50}
# та же клавиша в русской раскладке (модель может написать «cmd+е»)
_RU_KEYS = dict(zip("йцукенгшщзхъфывапролджэячсмитьбю", "qwertyuiop[]asdfghjkl;'zxcvbnm,."))


def parse_keys(keys: str) -> tuple[str, list[str]]:
    """'cmd+shift+t' -> ('key code 17', ['command down', 'shift down'])."""
    parts = [p.strip().lower() for p in re.split(r"\s*\+\s*", keys.strip()) if p.strip()]
    mods = [_MODS[p] for p in parts[:-1] if p in _MODS]
    key = parts[-1] if parts else ""
    key = _RU_KEYS.get(key, key)
    if key in _KEY_CODES:
        return f"key code {_KEY_CODES[key]}", mods
    if key in _CHAR_CODES:
        return f"key code {_CHAR_CODES[key]}", mods
    raise ValueError(f"Неизвестная клавиша: {key}")


def _keys_risk(ctx, keys: str, app: str = "", times: int = 1) -> str | None:
    action, mods = parse_keys(keys)
    if "command down" in mods and action in ("key code 12", "key code 13"):  # Cmd+Q / Cmd+W
        return "закрыть окно или приложение сочетанием клавиш (несохранённое может пропасть)"
    if "command down" in mods and action in ("key code 51", "key code 117"):
        return "удаление сочетанием клавиш"
    return None


@registry.add("press_keys", "Press a key/shortcut in the active app or `app`: 'cmd+t', 'esc', 'space', 'f5'.",
              {"keys": ("string", ""), "app": ("string", "activate first"), "times": ("integer", "")}, ["keys"],
              risk=_keys_risk)
def press_keys(ctx, keys: str, app: str = "", times: int = 1) -> str:
    action, mods = parse_keys(keys)
    using = f" using {{{', '.join(mods)}}}" if mods else ""
    script = ""
    if app:
        script += f'tell application {_as_str(app)} to activate\ndelay 0.3\n'
    script += "tell application \"System Events\"\n"
    script += f"repeat {max(1, min(int(times), 50))} times\n{action}{using}\ndelay 0.05\nend repeat\nend tell"
    res = osascript(script)
    return f"Нажато: {keys}" if res == "OK" else res


def _as_str(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def quit_if_running(app: str) -> str:
    """tell application … to quit ЗАПУСКАЕТ приложение, если оно закрыто, — поэтому сначала проверяем."""
    q = _as_str(app)
    res = osascript(f'if application {q} is running then\ntell application {q} to quit\nreturn "closed"\n'
                    f'else\nreturn "not running"\nend if')
    if res == "closed":
        return f"Закрыто: {app}"
    if res == "not running":
        return f"{app} и так не запущено"
    return res


# ---------------------------------------------------------------- shell / AppleScript / Shortcuts

@registry.add("run_shell", "Run a zsh command and return output (for anything other tools don't cover).",
              {"command": ("string", "")}, ["command"], risk=lambda ctx, command: shell_risk(command))
def run_shell(ctx, command: str) -> str:
    env_path = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    return run(f"export PATH={env_path}:$PATH; cd ~; {command}", shell=True, timeout=60)


@registry.add("run_applescript", "Run AppleScript (Finder, Notes, Reminders, Calendar, Music, System Events…).",
              {"script": ("string", "")}, ["script"], risk=lambda ctx, script: applescript_risk(script))
def run_applescript(ctx, script: str) -> str:
    return run(["osascript", "-e", script], timeout=30)


@registry.add("run_shortcut", "Run a Shortcuts shortcut by name ('list' to list them).",
              {"name": ("string", ""), "input": ("string", "optional text")}, ["name"])
def run_shortcut(ctx, name: str, input: str = "") -> str:
    if name == "list":
        return run(["shortcuts", "list"])
    if input:
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
            f.write(input)
        try:
            return run(["shortcuts", "run", name, "--input-path", f.name], timeout=60)
        finally:
            os.unlink(f.name)
    return run(["shortcuts", "run", name], timeout=60)
