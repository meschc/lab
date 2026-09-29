from pathlib import Path
from types import SimpleNamespace as NS

from coulson.config import load
from coulson.memory import Memory
from coulson.tools import Context, load_all, mouse as M


def test_parse_point_formats():
    assert M.parse_point('{"bbox_2d": [100, 200, 300, 400], "label": "Войти"}') == (200, 300)
    assert M.parse_point('```json\n[{"bbox_2d": [0, 0, 1000, 1000]}]\n```') == (500, 500)
    assert M.parse_point('{"point_2d": [812, 55]}') == (812, 55)
    assert M.parse_point('Кнопка находится в [420, 610, 480, 640]') == (450, 625)
    assert M.parse_point('{"bbox_2d": null}') is None
    assert M.parse_point("Не нашёл такой кнопки") is None
    assert M.parse_point("") is None
    # модель ответила пикселями снимка 1440×900 — переводим в 0–1000
    assert M.parse_point('{"point_2d": [1440, 450]}', (1440, 900)) == (1000, 500)


def _ctx(tmp_path, point, asked):
    cfg = load()
    return Context(cfg, memory=Memory(tmp_path / "m.db"), confirm=lambda d: asked.append(d) or False,
                   locate=lambda target, path, size: point)


def _fake_screen(monkeypatch, tmp_path, clicks):
    from coulson.tools import vision as V
    from PIL import Image

    def capture(display):
        p = tmp_path / "shot.png"
        Image.new("RGB", (3024, 1964), "white").save(p)
        return p

    monkeypatch.setattr(V, "_capture_screen", capture)
    monkeypatch.setattr(M, "_screen", lambda: (0.0, 0.0, 1512.0, 982.0))
    monkeypatch.setattr(M, "click_at", lambda x, y, button="left", double=False: clicks.append((x, y, button, double)))


def test_click_by_description(monkeypatch, tmp_path):
    clicks, asked = [], []
    _fake_screen(monkeypatch, tmp_path, clicks)
    reg = load_all()
    res = reg.execute("click", {"target": "кнопка Войти"}, _ctx(tmp_path, (500, 250), asked))
    assert clicks == [(756.0, 245.5, "left", False)] and "Кликнул" in res and not asked
    assert not list(tmp_path.glob("*.jpg")) and not list(tmp_path.glob("shot*"))  # снимки удалены


def test_click_not_found_and_risky(monkeypatch, tmp_path):
    clicks, asked = [], []
    _fake_screen(monkeypatch, tmp_path, clicks)
    reg = load_all()
    assert "Не нашёл" in reg.execute("click", {"target": "кнопка Войти"}, _ctx(tmp_path, None, asked))
    res = reg.execute("click", {"target": "кнопка Удалить аккаунт"}, _ctx(tmp_path, (1, 1), asked))
    assert "НЕ подтвердил" in res and asked == ["нажать «кнопка Удалить аккаунт»"] and clicks == []


def test_locate_reuses_conversation_prefix(tmp_path):
    from coulson.brain import Brain

    calls = []

    class Client:
        def chat(self, **kw):
            calls.append(kw)
            return NS(message=NS(content='{"bbox_2d": [10, 20, 30, 40]}', tool_calls=None))

    b = Brain(load(), load_all(), Memory(tmp_path / "m.db"))
    b.client = Client()
    live = b._prefix() + [{"role": "user", "content": "нажми войти"}]
    b._live = live
    img = tmp_path / "s.jpg"
    img.write_bytes(b"x")
    assert b.locate("кнопка Войти", str(img)) == (20, 30)
    msgs = calls[0]["messages"]
    assert msgs[:len(live)] == live and msgs[-1]["images"] == [str(img)] and "tools" in calls[0]
