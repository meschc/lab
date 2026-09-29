"""Управление системой: громкость, медиа, таймеры, буфер обмена, shell, AppleScript, Shortcuts, файлы, VPN."""
from __future__ import annotations

import os
import shlex
import threading
import time
from pathlib import Path

from ..safety import applescript_risk, shell_risk
from . import osascript, registry, run


# ---------------------------------------------------------------- звук и медиа

@registry.add("volume", "Get or change system volume.",
              {"action": ("string", "set | up | down | mute | unmute | get"),
               "level": ("integer", "0-100 for 'set', step for up/down (default 15)")}, ["action"],
              enums={"action": ["set", "up", "down", "mute", "unmute", "get"]})
def volume(ctx, action: str, level: int | None = None) -> str:
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


_MEDIA_KEYS = {"play_pause": 16, "next": 17, "previous": 18}


@registry.add("media", "Control media playback in any player (Music, Spotify, YouTube in browser…).",
              {"action": ("string", "play_pause | next | previous")}, ["action"],
              enums={"action": list(_MEDIA_KEYS)})
def media(ctx, action: str) -> str:
    import AppKit
    import Quartz

    key = _MEDIA_KEYS[action]
    for down in (True, False):
        ev = AppKit.NSEvent.otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2_(
            14, (0, 0), 0xA00 if down else 0xB00, 0, 0, 0, 8, (key << 16) | ((0xA if down else 0xB) << 8), -1)
        Quartz.CGEventPost(0, ev.CGEvent())
    return "OK"


# ---------------------------------------------------------------- состояние и действия

@registry.add("system_status", "Battery, disk space, Wi-Fi network, uptime, current date/time.")
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


@registry.add("system_action", "Perform a system action.",
              {"action": ("string", "What to do")}, ["action"],
              risk=lambda action: _ACTIONS.get(action, (None, None))[1], enums={"action": list(_ACTIONS)})
def system_action(ctx, action: str) -> str:
    if action not in _ACTIONS:
        return f"Неизвестное действие. Доступны: {', '.join(_ACTIONS)}"
    return run(_ACTIONS[action][0], shell=True)


@registry.add("set_timer", "Set a timer/reminder: after N minutes Coulson will say the message aloud "
              "and show a notification.",
              {"minutes": ("number", "Minutes from now (can be fractional)"), "message": ("string", "What to remind")},
              ["minutes"])
def set_timer(ctx, minutes: float, message: str = "") -> str:
    minutes = float(minutes)
    text = message or f"Таймер на {minutes:g} мин истёк"

    def fire():
        ctx.notify(text)
        osascript(f'display notification {_as_str(text)} with title "Колсон" sound name "Glass"')
        ctx.speak(f"Сэр, напоминаю: {text}")

    t = threading.Timer(minutes * 60, fire)
    t.daemon = True
    t.start()
    return f"Таймер поставлен на {time.strftime('%H:%M', time.localtime(time.time() + minutes * 60))}"


@registry.add("clipboard", "Read or write the clipboard.",
              {"action": ("string", "get | set"), "text": ("string", "Text for 'set'")}, ["action"],
              enums={"action": ["get", "set"]})
def clipboard(ctx, action: str, text: str = "") -> str:
    if action == "get":
        return run(["pbpaste"])[:4000] or "(буфер пуст)"
    import subprocess
    subprocess.run(["pbcopy"], input=text, text=True, check=True)
    return "Скопировал в буфер обмена"


@registry.add("type_text", "Type text into the currently focused field (as if from keyboard).",
              {"text": ("string", "Text to type")}, ["text"])
def type_text(ctx, text: str) -> str:
    return osascript(f'tell application "System Events" to keystroke {_as_str(text)}')


def _as_str(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


# ---------------------------------------------------------------- shell / AppleScript / Shortcuts

@registry.add("run_shell", "Run a zsh command on the Mac and return output. Use for anything not covered by other "
              "tools. Dangerous commands are confirmed with the user automatically.",
              {"command": ("string", "zsh command")}, ["command"], risk=lambda command: shell_risk(command))
def run_shell(ctx, command: str) -> str:
    env_path = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    return run(f"export PATH={env_path}:$PATH; cd ~; {command}", shell=True, timeout=60)


@registry.add("run_applescript", "Run AppleScript to automate macOS apps (Finder, Music, Notes, Reminders, Calendar, "
              "System Events, browser…).",
              {"script": ("string", "AppleScript source")}, ["script"], risk=lambda script: applescript_risk(script))
def run_applescript(ctx, script: str) -> str:
    return run(["osascript", "-e", script], timeout=30)


@registry.add("run_shortcut", "Run a Shortcuts (Команды) shortcut by name, or list them with name='list'.",
              {"name": ("string", "Shortcut name or 'list'"), "input": ("string", "Optional text input")}, ["name"])
def run_shortcut(ctx, name: str, input: str = "") -> str:
    if name == "list":
        return run(["shortcuts", "list"])
    if input:
        import subprocess
        p = subprocess.run(["shortcuts", "run", name, "-i", "-"], input=input, capture_output=True, text=True, timeout=60)
        return (p.stdout or p.stderr or "OK").strip()
    return run(["shortcuts", "run", name], timeout=60)


# ---------------------------------------------------------------- файлы

@registry.add("find_files", "Find files/folders by name using Spotlight.",
              {"query": ("string", "Name or part of it"), "folder": ("string", "Limit to folder, default home")},
              ["query"])
def find_files(ctx, query: str, folder: str = "") -> str:
    base = os.path.expanduser(folder or "~")
    out = run(["mdfind", "-onlyin", base, "-name", query], timeout=20)
    lines = [l for l in out.splitlines() if "/Library/" not in l and "/." not in l][:20]
    return "\n".join(lines) or "Ничего не найдено"


@registry.add("open_path", "Open a file or folder with its default app (or reveal in Finder).",
              {"path": ("string", "Path"), "reveal": ("boolean", "Show in Finder instead of opening")}, ["path"])
def open_path(ctx, path: str, reveal: bool = False) -> str:
    path = os.path.expanduser(path)
    return run(["open", "-R", path] if reveal else ["open", path])


# ---------------------------------------------------------------- VPN

@registry.add("vpn", "Turn VPN on/off or check status.",
              {"action": ("string", "on | off | status")}, ["action"], enums={"action": ["on", "off", "status"]})
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
