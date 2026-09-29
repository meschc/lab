import time

import numpy as np
import pytest

from coulson import assistant as A
from coulson.calibrate import merge_wake_words, pick_variant
from coulson.config import load
from coulson.intents import try_fast, words_to_int
from coulson.memory import Memory
from coulson.textutil import find_wake
from coulson.tools import Context, load_all


class Rec:
    """Подменяет инструменты: записывает вызовы вместо реальных действий на Маке."""

    def __init__(self, result="OK"):
        self.calls, self.result = [], result

    def execute(self, name, args, ctx):
        self.calls.append((name, args))
        if name == "sound" and args.get("action") in ("up", "down"):
            return "Громкость 45%"
        if name == "open_app":
            return f"Запущено: {args['name']}"
        return self.result


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    from coulson.tools import apps

    ix = apps.AppIndex()
    for n, t in [("Steam", "/Applications/Steam.app"), ("Telegram", "/Applications/Telegram.app"),
                 ("Music", "/System/Applications/Music.app")]:
        ix._add(n, t)
    ix._built = 9e18
    monkeypatch.setattr(apps, "index", ix)
    return Context(load(), memory=Memory(tmp_path / "m.db"))


def test_words_to_int():
    assert [words_to_int(x) for x in ["40", "сорок пять", "сто", "кот"]] == [40, 45, 100, None]


@pytest.mark.parametrize("cmd,tool,args", [
    ("громкость 30", "sound", {"action": "set", "level": 30}),
    ("Сделай громкость на сорок", "sound", {"action": "set", "level": 40}),
    ("погромче", "sound", {"action": "up"}),
    ("пауза", "sound", {"action": "play_pause"}),
    ("следующий трек", "sound", {"action": "next"}),
    ("заблокируй экран", "system_action", {"action": "lock_screen"}),
    ("поставь таймер на 5 минут", "set_timer", {"minutes": 5}),
    ("таймер на полчаса", "set_timer", {"minutes": 30}),
    ("таймер на 30 секунд", "set_timer", {"minutes": 0.5}),
    ("открой стим", "open_app", {"name": "Steam"}),
    ("Запусти телеграм.", "open_app", {"name": "Telegram"}),
    ("включи музыку", "open_app", {"name": "Music"}),
])
def test_fast_commands(ctx, cmd, tool, args):
    rec = Rec()
    fast = try_fast(cmd, rec, ctx)
    assert fast is not None and rec.calls == [(tool, args)]


@pytest.mark.parametrize("cmd", [
    "открой стим и запусти доту",       # составная — пусть планирует модель
    "открой сайт хабр",                # сайт, а не приложение
    "включи свет",                      # нет такого приложения
    "сделай громче и открой ютуб",
    "что ты думаешь о громкости",
    "напиши страницу про громкость 30",
    "продолжи",                         # «продолжай рассказ», а не музыка
])
def test_not_fast_goes_to_llm(ctx, cmd):
    rec = Rec()
    assert try_fast(cmd, rec, ctx) is None and rec.calls == []


def test_time_answer(ctx):
    fast = try_fast("который час", Rec(), ctx)
    assert fast.reply.startswith("Сейчас ")


def test_fast_failure_is_reddish(ctx):
    fast = try_fast("заблокируй экран", Rec(result="[код 1] execution error"), ctx)
    assert fast.mood == 0.5 and fast.reply.startswith("Не получилось")


# ---------------------------------------------------------------- диалог


@pytest.fixture
def asst(tmp_path, monkeypatch):
    monkeypatch.setattr(A.config, "DATA_DIR", tmp_path)
    cfg = load()
    cfg["memory"]["embed_model"] = None
    a = A.Assistant(cfg)
    a.handled = []
    a.handle = lambda cmd: a.handled.append(cmd)
    return a


def test_followup_limited_to_two_in_row(asst):
    now = time.monotonic()
    asst.followup_from, asst.followup_until = now - 1, now + 30
    for text in ["раз", "два", "три"]:
        asst._handle_utterance(A.Utterance(text, text, False, False, now))
    assert asst.handled == ["раз", "два"]
    asst._handle_utterance(A.Utterance("Колсон, четыре", "четыре", True, False, now))
    asst._handle_utterance(A.Utterance("пять", "пять", False, False, now))
    assert asst.handled == ["раз", "два", "четыре", "пять"]


def test_fast_path_in_handle(tmp_path, monkeypatch):
    monkeypatch.setattr(A.config, "DATA_DIR", tmp_path)
    cfg = load()
    cfg["memory"]["embed_model"] = None
    a = A.Assistant(cfg)
    said = []
    monkeypatch.setattr(a.speaker, "say", said.append)
    monkeypatch.setattr(a.speaker, "wait_idle", lambda timeout=0: None)
    from coulson.intents import Fast
    monkeypatch.setattr(A, "try_fast", lambda c, t, x: Fast("Громкость 30."))
    monkeypatch.setattr(a.brain, "respond", lambda *a_, **k: pytest.fail("модель не должна вызываться"))
    assert a.handle("громкость 30") == "Громкость 30."
    assert said == ["Громкость 30."] and a.brain.history[-1]["content"] == "[ok] Громкость 30."


def test_interrupted_reply_keeps_only_heard_part(tmp_path, monkeypatch):
    monkeypatch.setattr(A.config, "DATA_DIR", tmp_path)
    cfg = load()
    cfg["memory"]["embed_model"] = None
    a = A.Assistant(cfg)
    monkeypatch.setattr(a.speaker, "say", lambda s: None)
    monkeypatch.setattr(a.speaker, "wait_idle", lambda timeout=0: None)

    def respond(cmd, ctx, on_sentence, cancel=None, **kw):
        a.speaker.played.append("Первое предложение.")
        a.brain.history += [{"role": "user", "content": cmd},
                            {"role": "assistant", "content": "[ok] Первое предложение. Второе, которое не прозвучало."}]
        cancel.set()  # пользователь сказал «Колсон, стоп»
        return "…"

    monkeypatch.setattr(a.brain, "respond", respond)
    a.handle("расскажи длинную историю про космос")
    assert a.brain.history[-1]["content"] == "[ok] Первое предложение. …(перебит пользователем)"


# ---------------------------------------------------------------- память и активатор


class TopicEmbedder:
    available = True

    def embed(self, texts, query=False):
        vecs = []
        for t in texts:
            low = t.lower()
            v = np.array([("игр" in low) + ("дот" in low) + ("cs" in low), ("кофе" in low), 0.2], dtype=np.float32)
            vecs.append(v / np.linalg.norm(v))
        return np.stack(vecs)


def test_new_fact_supersedes_similar_old(tmp_path):
    m = Memory(tmp_path / "m.db", TopicEmbedder())
    assert m.add_fact("Любимая игра пользователя — Дота") == "Запомнил."
    m.add_fact("Пьёт кофе без сахара")
    res = m.add_fact("Любимая игра пользователя теперь CS2")
    assert "было: «Любимая игра пользователя — Дота»" in res
    texts = [t for _, t in m.facts()]
    assert "Любимая игра пользователя теперь CS2" in texts and len(texts) == 2


def test_calibration_helpers():
    known = ["колсон", "коулсон"]
    assert pick_variant("Кольсон.", known) == "кольсон"
    assert pick_variant("колесо", known) is None          # обычное слово — нельзя
    assert pick_variant("привет", known) is None
    merged = merge_wake_words({"llm": {"model": "x"}}, ["колсон"], ["кольтон"])
    assert merged["assistant"]["wake_words"] == ["колсон", "кольтон"] and merged["llm"] == {"model": "x"}


def test_exact_variant_from_calibration_always_wakes():
    words = ["колсон", "колтон"]  # «колтон» не проходит проверку согласных, но добавлен калибровкой
    assert find_wake("Колтон, открой стим", words) == (True, "открой стим")


def test_eighteen_tools_exposed_internal_still_work(tmp_path):
    reg = load_all()
    assert len(reg.exposed()) == 18 and "open_app" not in reg.exposed()
    ctx = Context(load(), memory=Memory(tmp_path / "m.db"))
    assert "нужно name" in reg.execute("app", {"action": "open"}, ctx)
    assert "Запомнил" in reg.execute("memory", {"action": "remember", "text": "тест"}, ctx)
