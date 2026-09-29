"""Собственный браузер Колсона (Chromium под управлением Playwright) — отдельно от браузера пользователя.

Зачем: Колсон видит устройство страницы и жмёт кнопки по тексту, заполняет поля, читает сайты на JavaScript —
это надёжнее кликов по картинке чужого окна. Если по тексту не нашлось — клик по снимку САМОЙ страницы
(координаты 0–1000 → точки страницы, без проблем Retina). Профиль свой и сохраняется (входы на сайты
остаются). Запускается при первом обращении, закрывается после простоя. Все вызовы Playwright — в одном
потоке (так требует его синхронный API).
"""
from __future__ import annotations

import logging
import queue
import re
import tempfile
import threading
import time
from concurrent.futures import Future
from pathlib import Path
from typing import Any, Callable

from . import config

log = logging.getLogger(__name__)


class InternalBrowser:
    def __init__(self, cfg):
        self.cfg = cfg.get("internal_browser") or {}
        self._jobs: queue.Queue[tuple[Callable, Future]] = queue.Queue()
        self._pw = self._ctx = self._page = None
        self._last_use = 0.0
        self._thread: threading.Thread | None = None

    # ------------------------------------------------------------ поток Playwright
    def _loop(self) -> None:
        idle = float(self.cfg.get("close_after_minutes", 10)) * 60
        while True:
            try:
                fn, fut = self._jobs.get(timeout=30)
            except queue.Empty:
                if self._ctx is not None and time.monotonic() - self._last_use > idle:
                    self._shutdown()
                continue
            try:
                fut.set_result(fn())
            except Exception as e:  # noqa: BLE001 — ошибку отдаём вызывающему
                fut.set_exception(e)
            self._last_use = time.monotonic()

    def _call(self, fn: Callable[[], Any], timeout: float = 90) -> Any:
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._loop, daemon=True, name="internal-browser")
            self._thread.start()
        fut: Future = Future()
        self._jobs.put((fn, fut))
        return fut.result(timeout=timeout)

    def _ensure(self):
        if self._page is not None and not self._page.is_closed():
            return self._page
        if self._ctx is None:
            from playwright.sync_api import sync_playwright

            self._pw = sync_playwright().start()
            profile = config.DATA_DIR / "browser-profile"
            profile.mkdir(parents=True, exist_ok=True)
            w, h = self.cfg.get("width", 1100), self.cfg.get("height", 800)
            self._ctx = self._pw.chromium.launch_persistent_context(
                str(profile), headless=bool(self.cfg.get("headless", False)), locale="ru-RU",
                viewport={"width": w, "height": h}, args=[f"--window-size={w},{h + 90}", "--window-position=60,60",
                                                          "--autoplay-policy=no-user-gesture-required"])
            self._ctx.set_default_timeout(15000)
        pages = [p for p in self._ctx.pages if not p.is_closed()]
        self._page = pages[0] if pages else self._ctx.new_page()
        return self._page

    def _shutdown(self) -> None:
        log.info("Внутренний браузер закрыт после простоя")
        try:
            if self._ctx:
                self._ctx.close()
            if self._pw:
                self._pw.stop()
        except Exception:
            pass
        self._pw = self._ctx = self._page = None

    # ------------------------------------------------------------ действия
    def open(self, url: str) -> str:
        def job():
            page = self._ensure()
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass
            return f"Открыл «{page.title()}» ({page.url})\n{_short(page.inner_text('body'), 2500)}"
        return self._call(job)

    def text(self, limit: int = 6000) -> str:
        def job():
            page = self._ensure()
            try:
                import trafilatura
                main = trafilatura.extract(page.content(), include_tables=True, url=page.url)
            except Exception:
                main = None
            return f"«{page.title()}» ({page.url})\n{_short(main or page.inner_text('body'), limit)}"
        return self._call(job)

    def click(self, target: str, locate: Callable | None = None, double: bool = False) -> str:
        def job():
            page = self._ensure()
            el = _find(page, target)
            if el is not None:
                (el.dblclick if double else el.click)(timeout=5000)
                page.wait_for_timeout(700)
                return f"Нажал «{target}»"
            if locate is None:
                return f"Ошибка: на странице не нашёл «{target}»"
            point = self._locate_on_page(page, target, locate)
            if point is None:
                return f"Ошибка: на странице не нашёл «{target}»"
            vw, vh = page.viewport_size["width"], page.viewport_size["height"]
            x, y = point[0] / 1000 * vw, point[1] / 1000 * vh
            (page.mouse.dblclick if double else page.mouse.click)(x, y)
            page.wait_for_timeout(700)
            return f"Нажал «{target}» (по снимку страницы)"
        return self._call(job, timeout=150)

    def click_vision(self, target: str, locate: Callable, double: bool = False) -> str:
        """Клик только по снимку страницы (когда текстовый поиск не подходит: иконки, «play» в строке трека)."""
        def job():
            page = self._ensure()
            point = self._locate_on_page(page, target, locate)
            if point is None:
                return f"Ошибка: на странице не нашёл «{target}»"
            vw, vh = page.viewport_size["width"], page.viewport_size["height"]
            (page.mouse.dblclick if double else page.mouse.click)(point[0] / 1000 * vw, point[1] / 1000 * vh)
            page.wait_for_timeout(700)
            return f"Нажал «{target}»"
        return self._call(job, timeout=150)

    def locate_on_page(self, target: str, locate: Callable):
        return self._call(lambda: self._locate_on_page(self._ensure(), target, locate), timeout=150)

    def type(self, target: str, text: str, submit: bool = False) -> str:
        def job():
            page = self._ensure()
            el = None
            if target:
                for get in (lambda: page.get_by_placeholder(re.compile(re.escape(target), re.I)),
                            lambda: page.get_by_label(re.compile(re.escape(target), re.I)),
                            lambda: page.get_by_role("textbox", name=re.compile(re.escape(target), re.I)),
                            lambda: page.get_by_role("searchbox")):
                    try:
                        loc = get()
                        if loc.count():
                            el = loc.first
                            break
                    except Exception:
                        continue
            if el is None:  # поле не назвали/не нашли — пишем в поле с фокусом или в первое видимое
                loc = page.locator("input:visible, textarea:visible, [contenteditable=true]:visible")
                if not loc.count():
                    return "Ошибка: на странице нет поля для ввода"
                el = loc.first
            el.fill(text)
            if submit:
                el.press("Enter")
                page.wait_for_timeout(1200)
            return f"Ввёл «{text[:60]}»" + (" и отправил" if submit else "")
        return self._call(job)

    def press(self, keys: str) -> str:
        combo = "+".join({"cmd": "Meta", "command": "Meta", "ctrl": "Control", "alt": "Alt", "option": "Alt",
                          "shift": "Shift", "enter": "Enter", "esc": "Escape", "space": "Space"}.get(k.lower(), k)
                         for k in re.split(r"\s*\+\s*", keys.strip()))
        return self._call(lambda: (self._ensure().keyboard.press(combo), f"Нажал {keys}")[1])

    def screenshot(self) -> str:
        path = Path(tempfile.gettempdir()) / f"coulson_page_{time.time_ns()}.png"
        self._call(lambda: self._ensure().screenshot(path=str(path)))
        return str(path)

    def page_text_contains(self, words: list[str]) -> bool:
        body = self._call(lambda: self._ensure().inner_text("body")).lower()
        return all(w.lower() in body for w in words)

    def close(self) -> str:
        if self._ctx is None:
            return "Внутренний браузер и так закрыт"
        self._call(self._shutdown)
        return "Закрыл внутренний браузер"

    @staticmethod
    def _locate_on_page(page, target: str, locate: Callable):
        from PIL import Image

        path = Path(tempfile.gettempdir()) / f"coulson_page_{time.time_ns()}.png"
        page.screenshot(path=str(path))
        try:
            return locate(target, str(path), Image.open(path).size)
        finally:
            path.unlink(missing_ok=True)


def _short(text: str, limit: int) -> str:
    text = re.sub(r"\n{3,}", "\n\n", (text or "").strip())
    return text if len(text) <= limit else text[:limit] + "\n…(обрезано)"


def _find(page, target: str):
    """Кнопка/ссылка/элемент по видимому тексту или подписи."""
    rx = re.compile(re.escape(target.strip(" «»\"'")), re.I)
    for get in (lambda: page.get_by_role("button", name=rx), lambda: page.get_by_role("link", name=rx),
                lambda: page.get_by_role("menuitem", name=rx), lambda: page.get_by_role("tab", name=rx),
                lambda: page.get_by_title(rx), lambda: page.get_by_text(rx)):
        try:
            loc = get()
            for i in range(min(loc.count(), 5)):
                if loc.nth(i).is_visible():
                    return loc.nth(i)
        except Exception:
            continue
    return None


_engine: InternalBrowser | None = None


def engine(cfg) -> InternalBrowser:
    global _engine
    if _engine is None:
        _engine = InternalBrowser(cfg)
    return _engine
