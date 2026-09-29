"""Зрение: снимок экрана или камеры → мультимодальная модель."""
from __future__ import annotations

import tempfile
import time
from pathlib import Path

from . import registry, run


def _shrink(path: Path, max_width: int) -> Path:
    from PIL import Image

    img = Image.open(path)
    if img.width > max_width:
        img = img.resize((max_width, int(img.height * max_width / img.width)), Image.LANCZOS)
    out = path.with_suffix(".jpg")
    img.convert("RGB").save(out, "JPEG", quality=85)
    return out


@registry.add("look_at_screen", "Take a screenshot and look at it to answer a question about what is on screen "
              "(read text, find a button, describe a game/site, explain an error).",
              {"question": ("string", "What to find out from the screen"),
               "display": ("integer", "Display number, 1 = main (default)")}, ["question"])
def look_at_screen(ctx, question: str, display: int = 1) -> str:
    if ctx.vision is None:
        return "Зрение недоступно"
    tmp = Path(tempfile.gettempdir()) / f"coulson_screen_{int(time.time())}.png"
    res = run(["screencapture", "-x", "-D", str(int(display)), str(tmp)], timeout=15)
    if not tmp.exists():
        return f"Не удалось сделать снимок экрана (нужно разрешение «Запись экрана»): {res}"
    img = _shrink(tmp, int(ctx.cfg.vision.max_width))
    try:
        return ctx.vision(question, str(img))
    finally:
        tmp.unlink(missing_ok=True)
        img.unlink(missing_ok=True)


@registry.add("look_at_camera", "Take a photo with the Mac camera and look at it (what's in front of the Mac, "
              "what the user is holding, how they look).",
              {"question": ("string", "What to find out")}, ["question"])
def look_at_camera(ctx, question: str) -> str:
    if ctx.vision is None:
        return "Зрение недоступно"
    import cv2

    cam = cv2.VideoCapture(0)
    try:
        if not cam.isOpened():
            return "Камера недоступна (нужно разрешение «Камера»)"
        frame = None
        for _ in range(15):  # дать камере настроить экспозицию
            ok, frame = cam.read()
            time.sleep(0.03)
        if frame is None:
            return "Не удалось получить кадр"
    finally:
        cam.release()
    tmp = Path(tempfile.gettempdir()) / f"coulson_cam_{int(time.time())}.jpg"
    cv2.imwrite(str(tmp), frame)
    img = _shrink(tmp, 1280)
    try:
        return ctx.vision(question, str(img))
    finally:
        tmp.unlink(missing_ok=True)
        img.unlink(missing_ok=True)
