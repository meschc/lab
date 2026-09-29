"""Управление системой: громкость, медиа, таймеры, буфер обмена, shell, AppleScript, Shortcuts, файлы, VPN."""
from __future__ import annotations

import os
import re
import shlex
import threading
import time
from pathlib import Path

from ..safety import applescript_risk, shell_risk
from . import osascript, registry, run


# ---------------------------------------------------------------- звук и медиа

_MEDIA_KEYS = {"play_pause": 16, "next": 17, "previous": 18}


@registry.add("sound", "Volume and media playback in any player.",
              {"action": ("string", ""), "level": ("integer", "0-100 for set; step for up/down")}, ["action"],
              enums={"action": ["set", "up", "down", "mute", "unmute", "get", "play_pause", "next", "previous"]})
def sound(ctx, action: str, level: int | None = None) -> str:
    if action in _MEDIA_KEYS:
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
    parts = [time.strftime("Сейчас %A, %d.%m.%Y %H:%M")]
    parts.append(run(["pmset", "-g", "batt"]).replace("Now drawing from", "Питание:"))
    st = os.statvfs(str(Path.home()))
    parts.append(f"Свободно на диске: {st.f_bavail * st.f_frsize / 1e9:.0f} ГБ")
    wifi = run("networksetup -getairportnetwork en0 2>/dev/null | cut -d: -f2", shell=True).strip()
    if wifi and "[" not in wifi:
        parts.append(f"Wi-Fi: {wifi}")
    parts.append(run(["uptime"]))
    return "\n".join(parts)


_ACTIONS = {
    "lock_screen": ("osascript -e 'tell application \"System Events\" to keystroke \"q\" using {control down, command down}'", None),
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
        return run(["pbpaste"])[:4000] or "(буфер пуст)"
    import subprocess
    subprocess.run(["pbcopy"], input=text, text=True, check=True)
    return "Скопировал в буфер обмена"


@registry.add("type_text", "Type text into the focused field.", {"text": ("string", "")}, ["text"])
def type_text(ctx, text: str) -> str:
    return osascript(f'tell application "System Events" to keystroke {_as_str(text)}')


_KEY_CODES = {"esc": 53, "escape": 53, "enter": 36, "return": 36, "tab": 48, "space": 49, "пробел": 49,
              "delete": 51, "backspace": 51, "forwarddelete": 117, "left": 123, "right": 124, "down": 125, "up": 126,
              "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
              **{f"f{i}": c for i, c in enumerate([122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111], 1)}}
_MODS = {"cmd": "command down", "command": "command down", "⌘": "command down", "shift": "shift down",
         "alt": "option down", "option": "option down", "opt": "option down", "ctrl": "control down",
         "control": "control down"}


def parse_keys(keys: str) -> tuple[str, list[str]]:
    """'cmd+shift+t' -> ('keystroke "t"', ['command down', 'shift down'])."""
    parts = [p.strip().lower() for p in re.split(r"\s*\+\s*", keys.strip()) if p.strip()]
    mods = [_MODS[p] for p in parts[:-1] if p in _MODS]
    key = parts[-1] if parts else ""
    if key in _KEY_CODES:
        action = f"key code {_KEY_CODES[key]}"
    elif len(key) == 1:
        action = f"keystroke {_as_str(key)}"
    else:
        raise ValueError(f"Неизвестная клавиша: {key}")
    return action, mods


def _keys_risk(ctx, keys: str, app: str = "", times: int = 1) -> str | None:
    action, mods = parse_keys(keys)
    if "command down" in mods and action in ('keystroke "q"', 'keystroke "w"'):
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
        import subprocess
        p = subprocess.run(["shortcuts", "run", name, "-i", "-"], input=input, capture_output=True, text=True, timeout=60)
        return (p.stdout or p.stderr or "OK").strip()
    return run(["shortcuts", "run", name], timeout=60)


# ---------------------------------------------------------------- VPN

@registry.add("vpn", "VPN on/off/status.", {"action": ("string", "")}, ["action"], enums={"action": ["on", "off", "status"]})
def vpn(ctx, action: str) -> str:
    method, name = ctx.cfg.vpn.method, ctx.cfg.vpn.name
    if method == "none" or not name:
        return "VPN ещё не настроен (секция vpn в config.local.yaml)."
    if method == "scutil":
        cmd = {"on": "start", "off": "stop", "status": "status"}[action]
        return run(["scutil", "--nc", cmd, name])
    if method == "shortcut":
        return run(["shortcuts", "run", f"{name} {'On' if action == 'on' else 'Off'}"]) if action != "status" else \
            run("scutil --nc list | grep -i connected || echo 'нет активных'", shell=True)
    if method == "app":
        if action == "on":
            return run(["open", "-a", name])
        if action == "off":
            return osascript(f'tell application "{name}" to quit')
        return run(f"pgrep -fl {shlex.quote(name)} || echo 'не запущено'", shell=True)
    return f"Неизвестный метод VPN: {method}"
