"""Маленькое плавающее окно в стиле Siri (pywebview + WKWebView)."""
from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path

log = logging.getLogger(__name__)

HTML = Path(__file__).with_name("index.html")
FULL = (400, 128)
MINI = (84, 84)
MARGIN = 14


class _Api:
    """Методы, доступные из JS (window.pywebview.api)."""

    def __init__(self, ui: "WindowUI"):
        self._ui = ui

    def toggle_mic(self, on):
        if self._ui.assistant:
            self._ui.assistant.set_mic(bool(on))

    def stop(self):
        if self._ui.assistant:
            self._ui.assistant.cancel.set()
            self._ui.assistant.speaker.interrupt()

    def collapse(self, on):
        self._ui.collapse(bool(on))

    def quit(self):
        if self._ui.assistant:
            threading.Thread(target=self._ui.assistant.quit, daemon=True).start()


class WindowUI:
    def __init__(self, cfg):
        self.cfg = cfg.ui
        self.window = None
        self.assistant = None
        self._loaded = threading.Event()
        self._collapsed = False
        self._last_activity = time.monotonic()
        self._last_level = 0.0

    # ------------------------------------------------------------ окно
    def _geometry(self, size) -> tuple[int, int]:
        import webview

        try:
            screen = webview.screens[0]
            sw, sh = screen.width, screen.height
        except Exception:
            sw, sh = 1512, 982  # MacBook Pro 14"
        x = sw - size[0] - MARGIN
        y = MARGIN + 28 if self.cfg.position == "top-right" else sh - size[1] - MARGIN - 70
        return x, y

    def create(self) -> None:
        import webview

        x, y = self._geometry(FULL)
        self.window = webview.create_window(
            "Колсон", url=HTML.as_uri(), js_api=_Api(self), width=FULL[0], height=FULL[1], x=x, y=y,
            frameless=True, easy_drag=True, on_top=True, transparent=True, resizable=False, focus=False)
        self.window.events.loaded += self._on_loaded

    def run(self, on_start) -> None:
        import webview

        def boot():
            self._native_tweaks()
            threading.Thread(target=self._collapse_watcher, daemon=True).start()
            on_start()

        webview.start(boot, debug=False)

    def _on_loaded(self) -> None:
        self._loaded.set()
        self._native_tweaks()

    def _native_tweaks(self) -> None:
        """Без иконки в Dock, поверх полноэкранных игр, на всех рабочих столах."""
        try:
            from AppKit import (NSApplication, NSApplicationActivationPolicyAccessory,
                                NSWindowCollectionBehaviorCanJoinAllSpaces,
                                NSWindowCollectionBehaviorFullScreenAuxiliary, NSStatusWindowLevel)
            from PyObjCTools import AppHelper

            def apply():
                NSApplication.sharedApplication().setActivationPolicy_(NSApplicationActivationPolicyAccessory)
                win = getattr(self.window, "native", None)
                if win is not None and not hasattr(win, "setLevel_"):
                    win = getattr(win, "window", None)  # BrowserView -> NSWindow
                if win is not None:
                    win.setLevel_(NSStatusWindowLevel)
                    win.setCollectionBehavior_(NSWindowCollectionBehaviorCanJoinAllSpaces
                                               | NSWindowCollectionBehaviorFullScreenAuxiliary)
            AppHelper.callAfter(apply)
        except Exception as e:
            log.debug("native tweaks failed: %s", e)

    def collapse(self, on: bool) -> None:
        if on == self._collapsed or not self.window:
            return
        self._collapsed = on
        size = MINI if on else FULL
        x, y = self._geometry(size)
        self._js(f"ui.collapsed({json.dumps(on)})")
        self.window.resize(*size)
        self.window.move(x, y)

    def _collapse_watcher(self) -> None:
        delay = float(self.cfg.collapse_after_seconds)
        while True:
            time.sleep(0.5)
            if delay > 0 and not self._collapsed and time.monotonic() - self._last_activity > delay:
                self.collapse(True)

    def _activity(self) -> None:
        self._last_activity = time.monotonic()
        if self._collapsed:
            self.collapse(False)

    def _js(self, code: str) -> None:
        if not self.window or not self._loaded.is_set():
            return
        try:
            self.window.evaluate_js(code)
        except Exception as e:
            log.debug("evaluate_js failed: %s", e)

    # ------------------------------------------------------------ интерфейс для Assistant
    def set_state(self, state: str, detail: str = "") -> None:
        if state not in ("idle", "muted", "sleeping"):
            self._activity()
        else:
            self._last_activity = time.monotonic()
        self._js(f"ui.setState({json.dumps(state)}, {json.dumps(detail)})")

    def set_level(self, level: float) -> None:
        if abs(level - self._last_level) > 0.04:
            self._last_level = level
            self._js(f"ui.setLevel({level:.3f})")

    def show_user(self, text: str, accepted: bool = True) -> None:
        if accepted:
            self._activity()
        self._js(f"ui.user({json.dumps(text)}, {json.dumps(accepted)})")

    def show_assistant(self, text: str) -> None:
        self._activity()
        self._js(f"ui.reply({json.dumps(text)})")

    def set_mic(self, on: bool) -> None:
        self._js(f"ui.mic({json.dumps(on)})")

    def set_mood(self, level: float) -> None:
        if level > 0:
            self._activity()
        self._js(f"ui.mood({max(0.0, min(1.0, float(level))):.2f})")
