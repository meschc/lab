import threading
import time

import numpy as np

from coulson import tts as T
from coulson.audio import CHUNK, Listener
from coulson.config import load


def make_speaker(monkeypatch, duration=0.15):
    spoken, events = [], []

    def fake_speak(self, sentence, gen):
        end = time.monotonic() + duration
        while time.monotonic() < end:
            if gen != self._gen:
                return
            time.sleep(0.01)
        spoken.append(sentence)

    monkeypatch.setattr(T.Speaker, "_speak_one", fake_speak)
    s = T.Speaker(load())
    s.on_speaking = events.append
    return s, spoken, events


def test_speaks_in_order_and_busy_until_done(monkeypatch):
    s, spoken, events = make_speaker(monkeypatch)
    s.say("Раз.")
    s.say("Два.")
    assert s.is_speaking
    s.wait_idle(5)
    assert spoken == ["Раз.", "Два."] and not s.is_speaking
    assert events == [True, False]  # без «дребезга» между фразами


def test_interrupt_then_new_phrase(monkeypatch):
    s, spoken, events = make_speaker(monkeypatch, duration=0.5)
    s.say("Длинная старая фраза.")
    s.say("Ещё старая.")
    time.sleep(0.1)
    s.interrupt()
    s.say("Новая.")          # сразу после «стоп» — старое не должно доиграть
    s.wait_idle(5)
    assert spoken == ["Новая."]


def test_callback_not_under_lock(monkeypatch):
    s, spoken, events = make_speaker(monkeypatch)
    # колбэк сам обращается к Speaker — при вызове под блокировкой это был бы deadlock
    s.on_speaking = lambda on: s.overlaps(0, 1)
    t = threading.Thread(target=lambda: (s.say("Проверка."), s.wait_idle(5)))
    t.start()
    t.join(3)
    assert not t.is_alive()


def test_echo_intervals(monkeypatch):
    s, spoken, events = make_speaker(monkeypatch, duration=0.1)
    t0 = time.monotonic()
    s.say("Фраза.")
    s.wait_idle(5)
    t1 = time.monotonic()
    assert s.overlaps(t0 + 0.02, t0 + 0.05)          # записано, пока говорили
    assert s.overlaps(t1 + 0.2, t1 + 0.3)            # хвост эха 0.5 с
    assert not s.overlaps(t1 + 1.0, t1 + 2.0)        # потом — уже пользователь


def test_split_long():
    text = ("Это очень длинное предложение, " * 60).strip()
    parts = T.split_long(text, 200)
    assert all(len(p) <= 200 for p in parts) and len(parts) > 5
    assert " ".join(parts).replace(",", "").split() == text.replace(",", "").split()
    assert T.split_long("Коротко.") == ["Коротко."]


def test_chunks_carry_capture_time():
    lst = Listener(load())
    t = 100.0
    block = np.zeros(CHUNK * 2, dtype=np.float32)  # один блок = два куска
    lst._q.put((t, block))
    gen = lst._chunks()
    (t1, c1), (t2, c2) = next(gen), next(gen)
    assert abs(t2 - t) < 1e-9 and abs(t1 - (t - CHUNK / 16000)) < 1e-9 and len(c1) == CHUNK
