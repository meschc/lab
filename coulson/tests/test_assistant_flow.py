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
