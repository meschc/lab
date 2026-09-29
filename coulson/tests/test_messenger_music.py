import time

import pytest

from coulson.config import load
from coulson.memory import Memory
from coulson.textutil import clean_for_speech, emoji_to_words, prepare_ru
from coulson.tools import Context, load_all, messenger as MS, music as MU


@pytest.fixture
def ui(monkeypatch, tmp_path):
    """Подменяем всё, что трогает Мак: запуск приложений, нажатия, буфер, снимки."""
    events = []
    from coulson.tools import system as SY
    from coulson.tools import vision as V

    clip = {"v": "старое содержимое буфера"}
    from pathlib import Path

    def fake_run(cmd, timeout=30):
        events.append(("run", cmd[0], cmd[-1]))
        if cmd[0] == "screencapture":
            Path(cmd[-1]).write_bytes(b"png")
        return "OK"

    monkeypatch.setattr(MS, "run", fake_run)
    monkeypatch.setattr(MS, "osascript", lambda s, timeout=20: events.append(("osa", s)) or "OK")
    monkeypatch.setattr(SY, "_pbcopy", lambda t: (events.append(("copy", t)), clip.__setitem__("v", t)))
    monkeypatch.setattr(SY, "_pbpaste", lambda: clip["v"])
    monkeypatch.setattr(MS.time, "sleep", lambda s: None)

    def capture(display):
        from PIL import Image
        p = tmp_path / f"check_{time.time_ns()}.png"
        Image.new("RGB", (100, 60), "white").save(p)
        return p

    monkeypatch.setattr(V, "_capture_screen", capture)
    monkeypatch.setattr(MS.tempfile, "gettempdir", lambda: str(tmp_path))
    return events


def _ctx(tmp_path, found=True, confirmed=True):
    return Context(load(), memory=Memory(tmp_path / "m.db"), confirm=lambda d: confirmed,
                   locate=lambda target, path, size: (500, 50) if found else None)


def test_send_screenshot_to_contact(ui, tmp_path):
    res = load_all().execute("message", {"app": "Макс", "contact": "Снежа", "attach": "screenshot",
                                         "text": "Смотри ❤️"}, _ctx(tmp_path))
    assert res == "Отправил контакту «Снежа» в MAX."
    copies = [e[1] for e in ui if e[0] == "copy"]
    assert copies[0] == "Снежа" and "Смотри ❤️" in copies and copies[-1] == "старое содержимое буфера"
    osa = " ".join(e[1] for e in ui if e[0] == "osa")
    assert "PNGf" in osa and "key code 36" in osa  # вложение из буфера и Enter
    assert ui[0][1] == "screencapture"               # снимок ДО переключения в мессенджер


def test_wrong_chat_is_not_sent(ui, tmp_path):
    res = load_all().execute("message", {"app": "max", "contact": "Снежа", "text": "привет"}, _ctx(tmp_path, found=False))
    assert res.startswith("Ошибка: не уверен") and not any(e[0] == "copy" and e[1] == "привет" for e in ui)


def test_message_always_confirmed(ui, tmp_path):
    asked = []
    ctx = _ctx(tmp_path)
    ctx.confirm = lambda d: asked.append(d) or False
    res = load_all().execute("message", {"app": "telegram", "contact": "Мама", "text": "Буду в 8"}, ctx)
    assert "НЕ подтвердил" in res and asked == ["отправить текст «Буду в 8» контакту «Мама» в Telegram"]
    assert ui == []


def test_emoji_spoken_as_words():
    assert emoji_to_words("Люблю тебя ❤️") == "Люблю тебя, сердечко"
    assert "сердечко" in prepare_ru("Снежа ❤️ ответила 😘")
    assert "🦄" not in clean_for_speech("Единорог 🦄")


def test_play_song_intent_and_tool(tmp_path, monkeypatch):
    from coulson.intents import try_fast

    calls = []

    class Rec:
        def execute(self, name, args, ctx):
            calls.append((name, args))
            return "Включаю «кино группа крови» в Яндекс Музыке"

    ctx = _ctx(tmp_path)
    assert try_fast("включи песню кино группа крови", Rec(), ctx) is not None
    assert calls == [("sound", {"action": "play_song", "query": "кино группа крови"})]

    opened, clicks = [], []
    monkeypatch.setattr("coulson.tools.web._open_in_browser", lambda c, url: opened.append(url) or "OK")
    monkeypatch.setattr(MU, "_locate_on_screen", lambda c, target: (100, 200))
    monkeypatch.setattr(MU, "click_at", lambda x, y, double=False: clicks.append((x, y, double)))
    monkeypatch.setattr(MU, "to_screen", lambda x, y: (x, y))
    monkeypatch.setattr(MU.time, "sleep", lambda s: None)
    res = load_all().execute("sound", {"action": "play_song", "query": "Кино Группа крови"}, ctx)
    assert opened[0].startswith("https://music.yandex.ru/search?text=") and clicks == [(100, 200, False)]
    assert res.startswith("Включаю")


def test_incident_log_file(tmp_path):
    m = Memory(tmp_path / "m.db")
    m.incident_log = tmp_path / "Журнал ошибок Колсона.md"
    m.add_incident("tool", "«открой доту» → Не нашёл приложение")
    text = m.incident_log.read_text(encoding="utf-8")
    assert text.startswith("# Журнал ошибок Колсона") and "не сработал инструмент" in text


def test_suggests_review_after_errors(tmp_path, monkeypatch):
    from coulson import assistant as A

    monkeypatch.setattr(A.config, "DATA_DIR", tmp_path)
    cfg = load()
    cfg["memory"]["embed_model"] = None
    a = A.Assistant(cfg)
    said = []
    monkeypatch.setattr(a, "say", said.append)
    monkeypatch.setattr(a.speaker, "wait_idle", lambda timeout=0: None)
    for i in range(5):
        a.memory.add_incident("tool", f"ошибка {i}")
    a._maybe_suggest_review()
    a._maybe_suggest_review()  # второй раз подряд — не повторяет
    assert len(said) == 1 and "Клоду" in said[0]


def test_tool_count():
    assert len(load_all().exposed()) == 21
