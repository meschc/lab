"""Мышь: клик по описанию элемента на экране (зрение Qwen3-VL находит его), прокрутка, перетаскивание.

Координаты модели — относительные 0–1000 по снимку главного экрана (так обучен Qwen3-VL);
здесь они переводятся в экранные точки macOS и кликаются через Quartz (нужен «Универсальный доступ»).
"""
from __future__ import annotations

import json
import re
import time

from . import registry

_RISKY_TARGET = re.compile(r"(удал|стере|очист|оплат|купи|покуп|заказ|отправ|подтверд|перевест|перевод|формат|"
                           r"сброс|выйти из|delete|remove|erase|buy|pay|purchase|order|send|submit|confirm|format|"
                           r"reset|transfer|sign out|log out)", re.I)


def parse_point(text: str, img_size: tuple[int, int] | None = None) -> tuple[float, float] | None:
    """Ответ модели → точка (x, y) в 0–1000. Понимает bbox_2d, point_2d и просто числа."""
    if not text:
        return None
    nums: list[float] | None = None
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            data = json.loads(m.group(0))
            if isinstance(data, list):
                data = data[0] if data else {}
            box = data.get("bbox_2d") if isinstance(data, dict) else None
            pt = data.get("point_2d") if isinstance(data, dict) else None
            if box is None and pt is None and isinstance(data, dict) and ("bbox_2d" in data or "point_2d" in data):
                return None  # модель явно сказала: не нашла
            nums = [float(v) for v in (box or pt or [])] or None
        except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
            nums = None
    if nums is None:
        if re.search(r"\bnull\b|не наш|not found", text, re.I):
            return None
        found = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", text)]
        nums = found[:4] if len(found) >= 4 else (found[:2] if len(found) >= 2 else None)
    if not nums or len(nums) not in (2, 4):
        return None
    x, y = ((nums[0] + nums[2]) / 2, (nums[1] + nums[3]) / 2) if len(nums) == 4 else (nums[0], nums[1])
    if max(x, y) > 1000 and img_size:  # модель ответила в пикселях снимка
        x, y = x / img_size[0] * 1000, y / img_size[1] * 1000
    if not (0 <= x <= 1000 and 0 <= y <= 1000):
        return None
    return x, y


def _screen() -> tuple[float, float, float, float]:
    """Главный экран в точках macOS: (x, y, ширина, высота)."""
    import Quartz

    b = Quartz.CGDisplayBounds(Quartz.CGMainDisplayID())
    return b.origin.x, b.origin.y, b.size.width, b.size.height


def to_screen(x_rel: float, y_rel: float) -> tuple[float, float]:
    ox, oy, w, h = _screen()
    return ox + x_rel / 1000 * w, oy + y_rel / 1000 * h


def _post(event_type, x: float, y: float, button, clicks: int = 1) -> None:
    import Quartz

    ev = Quartz.CGEventCreateMouseEvent(None, event_type, (x, y), button)
    if clicks > 1:
        Quartz.CGEventSetIntegerValueField(ev, Quartz.kCGMouseEventClickState, clicks)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)


def click_at(x: float, y: float, button: str = "left", double: bool = False) -> None:
    import Quartz

    down, up, btn = {
        "left": (Quartz.kCGEventLeftMouseDown, Quartz.kCGEventLeftMouseUp, Quartz.kCGMouseButtonLeft),
        "right": (Quartz.kCGEventRightMouseDown, Quartz.kCGEventRightMouseUp, Quartz.kCGMouseButtonRight),
    }[button]
    _post(Quartz.kCGEventMouseMoved, x, y, btn)
    time.sleep(0.05)
    for n in (1, 2) if double else (1,):
        _post(down, x, y, btn, n)
        _post(up, x, y, btn, n)
        time.sleep(0.05)


def _current_pos() -> tuple[float, float]:
    import Quartz

    loc = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
    return loc.x, loc.y


@registry.add("click", "Click a UI element on the screen described in words (button, link, icon, field, "
              "menu item). Works in any app, site or game.",
              {"target": ("string", "What to click, e.g. 'кнопка Войти', 'поле поиска'"),
               "button": ("string", ""), "double": ("boolean", "")}, ["target"],
              enums={"button": ["left", "right"]},
              risk=lambda ctx, target, button="left", double=False:
                  f"нажать «{target}»" if _RISKY_TARGET.search(target) else None)
def click(ctx, target: str, button: str = "left", double: bool = False) -> str:
    from .vision import _capture_screen, _shrink

    if not getattr(ctx, "locate", None):
        return "Клик по описанию недоступен (нужна модель со зрением)"
    shot = _capture_screen(1)
    if isinstance(shot, str):
        return shot
    img = _shrink(shot, int(ctx.cfg.vision.max_width))
    try:
        from PIL import Image
        size = Image.open(img).size
        point = ctx.locate(target, str(img), size)
    finally:
        img.unlink(missing_ok=True)
    if point is None:
        return f"Не нашёл на экране: {target}"
    x, y = to_screen(*point)
    click_at(x, y, button if button in ("left", "right") else "left", bool(double))
    return f"Кликнул: {target} (экран {x:.0f}, {y:.0f})"


@registry.add("mouse", "Mouse without vision: scroll, drag, or click at a point (x, y in 0-1000 of the main "
              "screen, e.g. from look). Without x/y — at the current cursor position.",
              {"action": ("string", ""), "x": ("number", ""), "y": ("number", ""),
               "to_x": ("number", "drag target"), "to_y": ("number", "drag target"),
               "amount": ("integer", "scroll lines, default 5")}, ["action"],
              enums={"action": ["scroll_up", "scroll_down", "click", "double_click", "right_click", "move", "drag"]})
def mouse(ctx, action: str, x: float | None = None, y: float | None = None, to_x: float | None = None,
          to_y: float | None = None, amount: int = 5) -> str:
    import Quartz

    pos = to_screen(x, y) if x is not None and y is not None else _current_pos()
    if action in ("scroll_up", "scroll_down"):
        if x is not None and y is not None:
            _post(Quartz.kCGEventMouseMoved, *pos, Quartz.kCGMouseButtonLeft)
        lines = max(1, min(int(amount or 5), 50)) * (1 if action == "scroll_up" else -1)
        ev = Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitLine, 1, lines)
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
        return "Прокрутил"
    if action == "move":
        _post(Quartz.kCGEventMouseMoved, *pos, Quartz.kCGMouseButtonLeft)
        return "Навёл курсор"
    if action == "drag":
        if to_x is None or to_y is None:
            return "Для перетаскивания нужны to_x и to_y"
        end = to_screen(to_x, to_y)
        btn = Quartz.kCGMouseButtonLeft
        _post(Quartz.kCGEventMouseMoved, *pos, btn)
        _post(Quartz.kCGEventLeftMouseDown, *pos, btn)
        for i in range(1, 21):  # плавно, иначе многие приложения не понимают перетаскивание
            _post(Quartz.kCGEventLeftMouseDragged, pos[0] + (end[0] - pos[0]) * i / 20,
                  pos[1] + (end[1] - pos[1]) * i / 20, btn)
            time.sleep(0.01)
        _post(Quartz.kCGEventLeftMouseUp, *end, btn)
        return "Перетащил"
    click_at(*pos, "right" if action == "right_click" else "left", action == "double_click")
    return "Кликнул"
