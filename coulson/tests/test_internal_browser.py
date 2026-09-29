"""Настоящий Chromium (Playwright) на локальных страницах — без интернета."""
import pytest

pytest.importorskip("playwright")

from coulson import browser_engine as BE  # noqa: E402
from coulson.config import load  # noqa: E402
from coulson.memory import Memory  # noqa: E402
from coulson.tools import Context, load_all  # noqa: E402

PAGE = """<html><head><title>Тестовая страница</title></head><body style="margin:0">
<h1>Магазин</h1><input placeholder="Поиск товаров" id="q">
<button onclick="document.getElementById('out').textContent='куплено'">Купить</button>
<div id="icon" onclick="document.getElementById('out').textContent='иконка'"
     style="position:absolute;left:500px;top:400px;width:40px;height:40px;background:red"></div>
<p id="out">—</p><script>document.getElementById('q').addEventListener('keydown',e=>{
if(e.key==='Enter')document.getElementById('out').textContent='ищу: '+e.target.value})</script></body></html>"""

MUSIC = """<html><head><title>Яндекс Музыка</title></head><body style="margin:0;font:16px sans-serif">
<div style="height:60px">Результаты поиска</div>
<div class="row" style="height:50px">Ария — Беспечный ангел <button id="p1" style="position:absolute;left:600px;top:60px"
 onclick="play('Ария — Беспечный ангел')">▶</button></div>
<div class="row" style="height:50px">Кино — Группа крови <button id="p2" style="position:absolute;left:600px;top:110px"
 onclick="play('Кино — Группа крови')">▶</button></div>
<div id="player" style="position:fixed;bottom:0;height:40px">Ничего не играет</div>
<script>function play(t){document.getElementById('player').textContent='Играет: '+t}</script></body></html>"""


@pytest.fixture
def browser(tmp_path, monkeypatch):
    monkeypatch.setattr("coulson.config.DATA_DIR", tmp_path)
    cfg = load()
    cfg["internal_browser"] = {"headless": True, "width": 1000, "height": 700}
    b = BE.InternalBrowser(cfg)
    yield b, cfg, tmp_path
    b.close()


def test_open_click_type(browser):
    b, cfg, tmp = browser
    page = tmp / "shop.html"
    page.write_text(PAGE, encoding="utf-8")
    assert "Тестовая страница" in b.open(page.as_uri())
    assert b.click("Купить") == "Нажал «Купить»" and b.page_text_contains(["куплено"])
    assert "Ввёл" in b.type("поиск товаров", "ноутбук", submit=True) and b.page_text_contains(["ищу: ноутбук"])
    assert "Магазин" in b.text()


def test_click_by_page_screenshot(browser):
    b, cfg, tmp = browser
    page = tmp / "shop.html"
    page.write_text(PAGE, encoding="utf-8")
    b.open(page.as_uri())
    # «модель» нашла красную иконку: центр (520, 420) в странице 1000×700 → в 0–1000
    res = b.click("красная иконка", locate=lambda t, p, size: (520, 420 / 700 * 1000))
    assert "по снимку страницы" in res and b.page_text_contains(["иконка"])


def test_music_plays_requested_song_not_first(browser, monkeypatch):
    b, cfg, tmp = browser
    page = tmp / "music.html"
    page.write_text(MUSIC, encoding="utf-8")
    monkeypatch.setattr(BE, "_engine", b)
    cfg["music"]["search_url"] = page.as_uri() + "?text={}"
    cfg["music"]["load_wait"] = 0
    monkeypatch.setattr("coulson.tools.music.time.sleep", lambda s: None)
    asked = []

    def locate(target, path, size):
        asked.append(target)
        if "панель плеера" in target:  # проверка: в плеере то, что просили?
            return (100, 980) if b._page.inner_text("#player").endswith("Группа крови") else None
        # «модель» нашла кнопку в строке «Кино — Группа крови» (вторая строка), а не первую
        return (615, 125 / 700 * 1000)

    ctx = Context(cfg, memory=Memory(tmp / "m.db"), locate=locate)
    res = load_all().execute("sound", {"action": "play_song", "query": "Кино — Группа крови"}, ctx)
    assert res.startswith("Включаю «Кино — Группа крови» в Яндекс Музыке")
    assert "«Кино — Группа крови»" in asked[0]


def test_web_tool_uses_internal_browser(browser, monkeypatch):
    b, cfg, tmp = browser
    page = tmp / "shop.html"
    page.write_text(PAGE, encoding="utf-8")
    monkeypatch.setattr(BE, "_engine", b)
    ctx = Context(cfg, memory=Memory(tmp / "m.db"))
    reg = load_all()
    assert "Тестовая страница" in reg.execute("web", {"action": "open", "query": page.as_uri()}, ctx)
    assert "Нажал" in reg.execute("web", {"action": "click", "query": "Купить"}, ctx)
    assert "Закрыл" in reg.execute("web", {"action": "close"}, ctx)
