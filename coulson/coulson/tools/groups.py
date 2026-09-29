"""Групповые инструменты: модель видит 18 инструментов вместо 34.

Маленькие модели (8B) заметно хуже выбирают инструмент, когда их больше 10–20 и описания похожи.
Поэтому родственные действия собраны в один инструмент с параметром action, а сами «мелкие»
инструменты остались внутренними — со своими проверками безопасности (risk) и тестами.
"""
from __future__ import annotations

from . import registry
from .system import _ACTIONS

_INTERNAL = ["open_app", "quit_app", "find_app", "running_apps", "open_url", "browser_search", "browser_tab",
             "web_search", "read_webpage", "weather", "type_text", "press_keys", "clipboard", "system_status",
             "system_action", "vpn", "run_applescript", "run_shortcut", "read_file", "list_dir", "find_files",
             "open_path", "disk_usage"]


def _call(ctx, name: str, **args) -> str:
    return registry.execute(name, {k: v for k, v in args.items() if v not in (None, "")}, ctx)


@registry.add("app", "Apps and games (Steam, Epic, CrossOver…): open/focus, quit, find installed, list running. "
              "name — as the user said it.",
              {"action": ("string", ""), "name": ("string", "")}, ["action"],
              enums={"action": ["open", "quit", "find", "running"]})
def app(ctx, action: str, name: str = "") -> str:
    if action == "running":
        return _call(ctx, "running_apps")
    if not name:
        return "Ошибка: нужно name"
    return _call(ctx, {"open": "open_app", "quit": "quit_app"}.get(action, "find_app"),
                 **({"query": name} if action == "find" else {"name": name}))


@registry.add("browser", "User's browser (Yandex): open a URL/domain, show search results to the user "
              "(engine: yandex, youtube, maps, market, wikipedia, google, github), or get the current tab.",
              {"action": ("string", ""), "target": ("string", "URL or search query"), "engine": ("string", "")},
              ["action"], enums={"action": ["open", "search", "current_tab"]})
def browser(ctx, action: str, target: str = "", engine: str = "yandex") -> str:
    if action == "current_tab":
        return _call(ctx, "browser_tab")
    if action == "search":
        return _call(ctx, "browser_search", query=target, engine=engine)
    return _call(ctx, "open_url", url=target)


@registry.add("web", "Internet for YOU (your own built-in browser, not the user's): search (then read the best "
              "link), read a page, weather (query=city); open a site and work on it yourself: click a button/link "
              "(query=its text), type into a field (query=field name, text=what), press a key, look at the page, "
              "close.",
              {"action": ("string", ""), "query": ("string", "search text, URL, city or element text"),
               "text": ("string", "text to type")}, ["action"],
              enums={"action": ["search", "read", "weather", "open", "click", "type", "press", "look", "close"]})
def web(ctx, action: str, query: str = "", text: str = "") -> str:
    if action == "weather":
        return _call(ctx, "weather", city=query)
    if action == "search":
        return _call(ctx, "web_search", query=query)
    if action == "read" and query:
        return _call(ctx, "read_webpage", url=query)
    from ..browser_engine import engine

    b = engine(ctx.cfg)
    if action == "open":
        url = query if "://" in query else ("https://" + query if "." in query and " " not in query
                                            else "https://yandex.ru/search/?text=" + query)
        return b.open(url)
    if action == "read":
        return b.text()
    if action == "click":
        return b.click(query, locate=getattr(ctx, "locate", None))
    if action == "type":
        return b.type(query, text, submit=True)
    if action == "press":
        return b.press(query or "enter")
    if action == "close":
        return b.close()
    shot = b.screenshot()  # look
    if ctx.attach_image:
        ctx.attach_image(shot)
        return "Снимок страницы внутреннего браузера приложен следующим сообщением."
    return "Зрение недоступно"


@registry.add("keyboard", "Keyboard and clipboard: type text into the focused field, press keys/shortcut "
              "('cmd+t', 'esc', 'space'), copy text to clipboard, read clipboard.",
              {"action": ("string", ""), "text": ("string", "text, or keys for 'keys'"),
               "app": ("string", "activate first"), "times": ("integer", "")}, ["action"],
              enums={"action": ["type", "keys", "copy", "read_clipboard"]})
def keyboard(ctx, action: str, text: str = "", app: str = "", times: int = 1) -> str:
    if action == "keys":
        return _call(ctx, "press_keys", keys=text, app=app, times=times)
    if action == "copy":
        return _call(ctx, "clipboard", action="set", text=text)
    if action == "read_clipboard":
        return _call(ctx, "clipboard", action="get")
    return _call(ctx, "type_text", text=text)


_SYSTEM_ACTIONS = ["status", *_ACTIONS, "vpn_on", "vpn_off", "vpn_status"]


@registry.add("system", "Mac status (battery, disk, Wi-Fi, time) and actions: lock, sleep, dark mode, trash, "
              "restart, VPN…", {"action": ("string", "")}, ["action"], enums={"action": _SYSTEM_ACTIONS})
def system(ctx, action: str) -> str:
    if action == "status":
        return _call(ctx, "system_status")
    if action.startswith("vpn_"):
        return _call(ctx, "vpn", action=action[4:])
    return _call(ctx, "system_action", action=action)


@registry.add("automation", "Automate macOS apps: run AppleScript (Notes, Calendar, Reminders, Finder, Music…), "
              "run a Shortcuts shortcut by name, or list shortcuts.",
              {"action": ("string", ""), "code": ("string", "AppleScript source or shortcut name"),
               "input": ("string", "optional text for a shortcut")}, ["action"],
              enums={"action": ["applescript", "shortcut", "list_shortcuts"]})
def automation(ctx, action: str, code: str = "", input: str = "") -> str:
    if action == "list_shortcuts":
        return _call(ctx, "run_shortcut", name="list")
    if action == "shortcut":
        return _call(ctx, "run_shortcut", name=code, input=input)
    return _call(ctx, "run_applescript", script=code)


@registry.add("files", "Files on the Mac: read a file (text, CSV, Excel, Word), list a folder, find by name, "
              "open with default app, reveal in Finder, disk usage (biggest folders).",
              {"action": ("string", ""), "path": ("string", "file/folder; relative = ~/Documents/Колсон"),
               "query": ("string", "name to find")}, ["action"],
              enums={"action": ["read", "list", "find", "open", "reveal", "disk_usage"]})
def files(ctx, action: str, path: str = "", query: str = "") -> str:
    if action == "find":
        return _call(ctx, "find_files", query=query or path, folder=path if query else "")
    if action == "list":
        return _call(ctx, "list_dir", path=path)
    if action == "disk_usage":
        return _call(ctx, "disk_usage", path=path or "~")
    if not path:
        return "Ошибка: нужен path"
    if action == "read":
        return _call(ctx, "read_file", path=path)
    return _call(ctx, "open_path", path=path, reveal=action == "reveal")


for _name in _INTERNAL:
    registry.tools[_name].expose = False
