import time

import pytest

from coulson import assistant as A
from coulson.config import load


@pytest.fixture
def asst(tmp_path, monkeypatch):
    monkeypatch.setattr(A.config, "DATA_DIR", tmp_path)
    a = A.Assistant(load())
    a.handled, a.said, a.acks = [], [], []
    a.handle = lambda cmd: a.handled.append(cmd)
    a.say = lambda text: a.said.append(text)
    a._ack = lambda: (a.acks.append(1), setattr(a, "awaiting_until", time.monotonic() + 5))
    return a


def U(text, wake=False, rest=None):
    return A.Utterance(text, rest if rest is not None else text, wake, False, time.monotonic())


def test_ignores_without_wake(asst):
    asst._handle_utterance(U("открой стим"))
    assert asst.handled == []


def test_wake_with_command(asst):
    asst._handle_utterance(U("Колсон, открой стим", True, "открой стим"))
    assert asst.handled == ["открой стим"]


def test_wake_alone_then_command(asst):
    asst._handle_utterance(U("Колсон", True, ""))
    assert asst.acks == [1]
    asst._handle_utterance(U("включи музыку"))
    assert asst.handled == ["включи музыку"]


def test_followup_window(asst):
    asst.followup_until = time.monotonic() + 5
    asst._handle_utterance(U("а громче можно?"))
    assert asst.handled == ["а громче можно?"]


def test_sleep_mode(asst):
    asst._handle_utterance(U("Колсон, не слушай", True, "не слушай"))
    assert asst.sleeping and asst.handled == []
    asst._handle_utterance(U("Колсон, открой стим", True, "открой стим"))
    assert asst.handled == []
    asst._handle_utterance(U("Колсон, проснись", True, "проснись"))
    assert not asst.sleeping


def test_sleep_regex_word_boundaries():
    assert not A._SLEEP_RE.search("открой список покупок")
    assert A._SLEEP_RE.search("спи")


def test_filler_not_during_confirmation(asst, monkeypatch):
    import threading
    said = []
    monkeypatch.setattr(asst.speaker, "say", lambda t: said.append(t))
    monkeypatch.setattr(asst.speaker, "wait_idle", lambda timeout=0: None)
    asst.cfg["assistant"]["filler_after_seconds"] = 0.05
    started = threading.Event()

    def slow_respond(cmd, ctx, on_sentence, cancel=None, on_tool=None, on_mood=None):
        asst.confirming = True
        started.set()
        time.sleep(0.2)
        asst.confirming = False
        return "ok"

    monkeypatch.setattr(asst.brain, "respond", slow_respond)
    A.Assistant.handle(asst, "удали файл")
    assert said == []

    def slow_plain(cmd, ctx, on_sentence, cancel=None, on_tool=None, on_mood=None):
        time.sleep(0.2)
        return "ok"

    monkeypatch.setattr(asst.brain, "respond", slow_plain)
    A.Assistant.handle(asst, "напиши страницу")
    assert len(said) == 1


def test_followup_ignores_speech_from_before_reply_end(asst):
    now = time.monotonic()
    asst.followup_from, asst.followup_until = now, now + 5
    old = A.Utterance("это я не тебе", "это я не тебе", False, False, now - 2)  # сказано, пока Колсон думал
    asst._handle_utterance(old)
    assert asst.handled == []
    asst._handle_utterance(A.Utterance("а громче", "а громче", False, False, now + 0.5))
    assert asst.handled == ["а громче"]


def test_local_commands():
    assert A._QUIT_RE.search("выключись") and A._GAME_MODE_RE.search("включи игровой режим")
    for cmd in ["выключи свет", "quit steam", "закрой стим", "выключись когда закончишь загрузку"]:
        assert not A._QUIT_RE.search(cmd), cmd
    assert A._is_connection_error(ConnectionError("Connection refused"))
    assert not A._is_connection_error(ValueError("model not found"))
