import base64
import datetime as dt
import json

from coulson import movies as mv
from coulson import proactive as pa
from coulson.config import load
from coulson.memory import Memory
from coulson.rename import wake_variants
from coulson.textutil import find_wake
from coulson.tools import Context, load_all


def ctx_for(tmp_path, **assistant):
    cfg = load()
    cfg.assistant.update(assistant)
    return Context(cfg, memory=Memory(tmp_path / "m.db"))


def test_parse_date():
    assert pa.parse_date("12.10", yearly=True) == "0000-10-12"
    assert pa.parse_date("12 октября", yearly=True) == "0000-10-12"
    assert pa.parse_date("3 мая 1960", yearly=True) == "0000-05-03"
    assert pa.parse_date("2027-01-05") == "2027-01-05"
    assert pa.parse_date("05.01.27") == "2027-01-05"
    assert pa.parse_date("29.02", yearly=True) == "0000-02-29"
    assert pa.parse_date("31.02") == "" and pa.parse_date("завтра") == ""
    y = pa.parse_date("01.01")  # без года — ближайшее будущее 1 января
    assert dt.date.fromisoformat(y) >= dt.date.today()


def test_birthday_nudges_once(tmp_path, monkeypatch):
    monkeypatch.setattr(pa, "from_calendar", lambda days=8: [])
    ctx = ctx_for(tmp_path, user_name="Кирилл")
    in3 = dt.date.today() + dt.timedelta(days=3)
    ctx.memory.add_note("мама", title="День рождения мамы", kind="birthday", date=f"0000-{in3:%m-%d}")
    ctx.memory.add_note("далёкий", title="Совещание", kind="event", date=str(dt.date.today() + dt.timedelta(days=40)))
    items = pa.nudges(ctx)
    assert len(items) == 1
    key, text = items[0]
    assert text.startswith("Кирилл, через 3 дня день рождения") and "мамы" in text and "подарка" in text
    ctx.memory.mark_nudge(key)
    assert pa.nudges(ctx) == []  # второй раз не повторяет


def test_event_minutes_nudge(tmp_path, monkeypatch):
    now = dt.datetime.now().replace(second=0, microsecond=0)
    start = now + dt.timedelta(minutes=12)
    monkeypatch.setattr(pa, "from_calendar", lambda days=8: [pa.Upcoming("event", "Созвон с Андреем", start.date(),
                                                                         start, "calendar")])
    ctx = ctx_for(tmp_path)
    (key, text), = pa.nudges(ctx, now=now)
    assert "через 12 мин: Созвон с Андреем" in text and key.endswith(":15")


def test_briefing_and_notes_tool(tmp_path, monkeypatch):
    monkeypatch.setattr(pa, "from_calendar", lambda days=8: [])
    ctx = ctx_for(tmp_path, user_name="Кирилл")
    reg = load_all()
    tomorrow = dt.date.today() + dt.timedelta(days=1)
    res = reg.execute("notes", {"action": "add", "text": "Брат", "title": "День рождения брата", "kind": "birthday",
                                "date": f"{tomorrow:%d.%m}"}, ctx)
    assert "Ошибка" not in res
    ctx.memory.add_note("Купить молоко", kind="task")
    out = pa.briefing(ctx, weather="Москва: сейчас 12°.")
    assert "Кирилл" in out and "Москва: сейчас 12°." in out and "брата — завтра" in out and "задач: 1" in out
    assert "брата" in reg.execute("notes", {"action": "list", "kind": "birthday"}, ctx)


def test_wake_works_for_new_name():
    words = wake_variants("Джарвис")
    assert "джарвис" in words and "джарвиса" in words and any(w.isascii() for w in words)
    assert find_wake("Джарвис, включи музыку", words) == (True, "включи музыку")
    assert not find_wake("дарвин писал", words)[0]
    assert wake_variants("Пятница")[:3] == ["пятница", "пятницы", "пятници"]


def test_movies_import_suggest_info(tmp_path):
    ctx = ctx_for(tmp_path)
    data = {"items": [
        {"nameRu": "Легенда №17", "year": 2013, "ratingKinopoisk": 8.0, "genres": [{"genre": "драма"},
                                                                                     {"genre": "спорт"}]},
        {"nameRu": "Интерстеллар", "nameOriginal": "Interstellar", "year": 2014, "ratingKinopoisk": 8.6,
         "genres": [{"genre": "фантастика"}], "userRating": 10},
        {"nameRu": "Сумерки", "year": 2008, "ratingKinopoisk": 6.5, "status": "не смотреть"},
        {"nameRu": "Движение вверх", "year": 2017, "ratingKinopoisk": 7.5, "genres": "спорт, драма"},
    ]}
    f = tmp_path / "kp.json"
    f.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    res = mv.import_file(ctx.memory, str(f))
    assert "новых 4" in res and "посмотрено — 1" in res and "не смотреть — 1" in res
    assert "новых 0, обновлено 4" in mv.import_file(ctx.memory, str(f))  # повторный импорт не дублирует
    out = mv.suggest(ctx.memory, "что-нибудь про спорт", count=2)
    assert "Легенда №17" in out and "Движение вверх" in out and "Сумерки" not in out and "Интерстеллар" not in out
    first = out.splitlines()[1].split(". ", 1)[1].split(" (")[0]
    assert mv.resolve(ctx.memory, "1")["title"] == first
    assert mv.resolve(ctx.memory, "второй")["title"] != first
    assert mv.resolve(ctx.memory, "легенда номер 17")["title"] == "Легенда №17"
    assert mv.resolve(ctx.memory, "Interstellar")["title"] == "Интерстеллар"
    assert "Отметил" in mv.mark(ctx.memory, "Легенда №17", rating=9)
    assert "ваша оценка 9" in mv.describe(mv.resolve(ctx.memory, "Легенда №17"))


def test_movies_csv_russian_headers(tmp_path):
    ctx = ctx_for(tmp_path)
    f = tmp_path / "kp.csv"
    f.write_text("Название;Год;Рейтинг КП;Моя оценка;Жанры\nБрат;1997;8,3;9;драма\nБрат 2;2000;8,2;;боевик\n",
                 encoding="utf-8")
    assert "новых 2" in mv.import_file(ctx.memory, str(f))
    assert "Брат 2" in mv.listing(ctx.memory, "want") and "Брат (1997" in mv.listing(ctx.memory, "watched")


def test_weather_and_yandex_search(tmp_path, monkeypatch):
    import httpx

    from coulson import location
    from coulson.tools import web

    ctx = ctx_for(tmp_path)
    monkeypatch.setattr(location, "current", lambda cfg: location.Place(55.6, 37.7, "Домодедовская", "config"))
    monkeypatch.setattr(web, "forecast", lambda lat, lon, days=3: {
        "current": {"temperature_2m": 11.6, "apparent_temperature": 9.2, "weather_code": 61, "wind_speed_10m": 3.4,
                    "relative_humidity_2m": 80},
        "daily": {"time": ["2026-09-29"], "weather_code": [63], "temperature_2m_min": [7.1],
                  "temperature_2m_max": [13.4], "precipitation_probability_max": [70]}})
    out = load_all().execute("weather", {}, ctx)
    assert out.startswith("Домодедовская: сейчас 12°") and "небольшой дождь" in out
    assert "осадков 70%" in web.weather_text(location.current(None), 1, short=True)

    xml = ("<?xml version='1.0' encoding='utf-8'?><yandexsearch><response><results><grouping><group><doc>"
           "<url>https://example.ru/a</url><title>Курс <hlword>доллара</hlword></title>"
           "<passages><passage>Сегодня 92 рубля</passage></passages></doc></group></grouping></results>"
           "</response></yandexsearch>")

    class R:
        def raise_for_status(self):
            pass

        def json(self):
            return {"rawData": base64.b64encode(xml.encode()).decode()}

    sent = {}
    monkeypatch.setattr(httpx, "post", lambda url, **kw: sent.update(kw) or R())
    monkeypatch.setenv("YANDEX_SEARCH_API_KEY", "k")
    ctx.cfg.search["yandex_folder_id"] = "b1g"
    res = web.web_search(ctx, "курс доллара")
    assert "Курс доллара" in res and "92 рубля" in res and sent["json"]["folderId"] == "b1g"


def test_transit_url():
    from coulson.tools.transit import route_url
    url = route_url("Москва, ЖК Ольховка", "Москва, метро Домодедовская")
    assert url.startswith("https://yandex.ru/maps/?rtext=") and "rtt=mt" in url


def test_briefing_after_first_command_then_nudge(tmp_path, monkeypatch):
    import pytest

    from coulson import assistant as A
    from coulson.intents import Fast
    monkeypatch.setattr(A.config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(pa, "from_calendar", lambda days=8: [])
    import coulson.location as location
    monkeypatch.setattr(location, "current", lambda cfg: None)
    cfg = load()
    cfg["memory"]["embed_model"] = None
    cfg["assistant"]["user_name"] = "Кирилл"
    cfg["proactive"]["briefing_from_hour"] = 0
    cfg["proactive"]["briefing_until_hour"] = 24
    a = A.Assistant(cfg)
    said = []
    monkeypatch.setattr(a.speaker, "say", said.append)
    monkeypatch.setattr(a.speaker, "wait_idle", lambda timeout=0: None)
    monkeypatch.setattr(A, "try_fast", lambda c, t, x: Fast("Готово."))
    monkeypatch.setattr(a.brain, "respond", lambda *a_, **k: pytest.fail("модель не нужна"))
    in7 = dt.date.today() + dt.timedelta(days=7)
    a.memory.add_note("мама", title="День рождения мамы", kind="birthday", date=f"0000-{in7:%m-%d}")
    a.handle("громче")
    assert said[0] == "Готово." and said[1].startswith(("Доброе утро, Кирилл", "Добрый день, Кирилл",
                                                         "Добрый вечер, Кирилл"))
    assert "мамы" in said[1]
    a.handle("тише")  # сводка уже была — теперь напоминание за неделю
    assert "через 7 дней день рождения: мамы" in said[-1]
    assert a.brain.history[-1]["content"].endswith("Подобрать варианты подарка?")
    a.handle("тише")
    assert said[-1] == "Готово."  # один раз


def test_weather_fast_path(tmp_path, monkeypatch):
    from coulson import location
    from coulson.intents import try_fast
    from coulson.tools import web
    ctx = ctx_for(tmp_path)
    monkeypatch.setattr(location, "current", lambda cfg: location.Place(55.6, 37.7, "Москва", "corelocation"))
    monkeypatch.setattr(web, "weather_text", lambda place, days=3, short=False: f"{place}: сейчас 5°.")
    assert try_fast("какая погода сегодня", load_all(), ctx).reply == "Москва: сейчас 5°."
    assert try_fast("нужен ли зонт", load_all(), ctx).reply == "Москва: сейчас 5°."
    monkeypatch.setattr(location, "current", lambda cfg: None)
    assert try_fast("какая погода", load_all(), ctx) is None  # не знаем где — пусть модель спросит
