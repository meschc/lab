"""Зрение: снимок экрана или камеры прикладывается к диалогу, и модель смотрит на него сама."""
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
    out = path.with_name(path.stem + "_s.jpg")
    img.convert("RGB").save(out, "JPEG", quality=85)
    path.unlink(missing_ok=True)
    return out


def _capture_screen(display: int) -> Path | str:
    tmp = Path(tempfile.gettempdir()) / f"coulson_screen_{time.time_ns()}.png"
    res = run(["screencapture", "-x", "-D", str(int(display or 1)), str(tmp)], timeout=15)
    return tmp if tmp.exists() else f"Не удалось сделать снимок экрана (нужно разрешение «Запись экрана»): {res}"


def _capture_camera() -> Path | str:
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
    tmp = Path(tempfile.gettempdir()) / f"coulson_cam_{time.time_ns()}.jpg"
    cv2.imwrite(str(tmp), frame)
    return tmp


@registry.add("look", "See the screen (read text, find a button, explain an error, describe a game/site) or the "
              "camera (what is in front of the Mac). The image is attached to the conversation for you.",
              {"source": ("string", ""), "question": ("string", "What to find out"),
               "display": ("integer", "Screen number, 1 = main")}, ["source", "question"],
              enums={"source": ["screen", "camera"]})
def look(ctx, source: str, question: str, display: int = 1) -> str:
    shot = _capture_camera() if source == "camera" else _capture_screen(display)
    if isinstance(shot, str):
        return shot
    img = _shrink(shot, int(ctx.cfg.vision.max_width) if source == "screen" else 1280)
    if ctx.attach_image:
        ctx.attach_image(str(img))
        what = "Снимок экрана" if source == "screen" else "Кадр с камеры"
        return f"{what} приложен следующим сообщением. Ответь по нему на вопрос: {question}"
    if ctx.vision:
        try:
            return ctx.vision(question, str(img))
        finally:
            img.unlink(missing_ok=True)
    return "Зрение недоступно"
