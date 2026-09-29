"""Голос: Silero v5 (русский), macOS «Daniel» (британский английский), опционально Qwen3-TTS.

Фразы ставятся в очередь и произносятся в отдельном потоке, так что можно говорить,
пока модель ещё дописывает ответ. interrupt() мгновенно обрывает речь.
"""
from __future__ import annotations

import collections
import logging
import queue
import re
import subprocess
import threading
import time

import numpy as np

from .textutil import clean_for_speech, detect_lang, prepare_ru

log = logging.getLogger(__name__)


def best_russian_say_voice() -> str:
    try:
        out = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return "Milena"
    voices = [line.split("  ")[0].strip() for line in out.splitlines() if "ru_RU" in line]
    for pref in ("Yuri (Premium)", "Yuri (Enhanced)", "Yuri", "Milena (Premium)", "Milena (Enhanced)", "Milena"):
        if pref in voices:
            return pref
    return voices[0] if voices else "Milena"


class Speaker:
    def __init__(self, cfg):
        self.cfg = cfg.tts
        self._q: queue.Queue[str | None] = queue.Queue()
        self._stop = threading.Event()
        self._busy = threading.Event()
        self._proc: subprocess.Popen | None = None
        self._silero = None
        self._qwen = None
        self._ru_voice = None
        self.speaking_until = 0.0  # monotonic: до какого момента мы (плюс хвост эха) говорили
        self._cur_start = 0.0
        self._intervals: collections.deque[tuple[float, float]] = collections.deque(maxlen=30)
        self.on_speaking = None     # callback(bool) для UI
        threading.Thread(target=self._worker, daemon=True, name="tts").start()

    # ------------------------------------------------------------ загрузка
    def warmup(self) -> None:
        engine = self.cfg.engine
        if engine == "qwen3":
            try:
                self._load_qwen()
            except Exception as e:
                log.warning("Qwen3-TTS не загрузился (%s), переключаюсь на Silero", e)
                engine = "silero"
        if engine == "silero":
            try:
                self._load_silero()
            except Exception as e:
                log.warning("Silero не загрузился (%s), использую голос macOS", e)
        self._ru_voice = self.cfg.say_ru_voice if self.cfg.say_ru_voice != "auto" else best_russian_say_voice()

    def _load_silero(self) -> None:
        import torch

        torch.set_num_threads(4)
        model, _ = torch.hub.load("snakers4/silero-models", "silero_tts", language="ru",
                                  speaker=self.cfg.silero_model, trust_repo=True)
        self._silero = model
        self._synth_silero("Проверка.")
        log.info("Silero TTS готов (%s, %s)", self.cfg.silero_model, self.cfg.silero_speaker)

    def _load_qwen(self) -> None:
        from mlx_audio.tts.utils import load_model

        self._qwen = load_model(self.cfg.qwen3_model)
        log.info("Qwen3-TTS готов (%s)", self.cfg.qwen3_model)

    # ------------------------------------------------------------ синтез
    def _synth_silero(self, text: str) -> tuple[np.ndarray, int]:
        sr = int(self.cfg.sample_rate)
        audio = self._silero.apply_tts(text=text, speaker=self.cfg.silero_speaker, sample_rate=sr,
                                       put_accent=True, put_yo=True)
        return audio.numpy().astype(np.float32), sr

    def _synth_qwen(self, text: str, lang: str) -> tuple[np.ndarray, int]:
        language = "Russian" if lang == "ru" else "English"
        m = self._qwen
        if self.cfg.qwen3_ref_audio:
            gen = m.generate(text=text, ref_audio=self.cfg.qwen3_ref_audio, ref_text=self.cfg.qwen3_ref_text,
                             lang_code=language)
        elif hasattr(m, "generate_custom_voice"):
            gen = m.generate_custom_voice(text=text, speaker="Ryan", language=language)
        else:
            gen = m.generate(text=text, lang_code=language)
        chunks, sr = [], 24000
        for r in gen:
            chunks.append(np.array(r.audio, dtype=np.float32))
            sr = getattr(r, "sample_rate", sr)
        return np.concatenate(chunks), sr

    # ------------------------------------------------------------ воспроизведение
    def _play(self, audio: np.ndarray, sr: int) -> None:
        import sounddevice as sd

        sd.play(audio, sr)
        end = time.monotonic() + len(audio) / sr
        while time.monotonic() < end:
            if self._stop.is_set():
                sd.stop()
                return
            self.speaking_until = time.monotonic() + 0.6
            time.sleep(0.03)
        sd.wait()

    def _say_cmd(self, text: str, voice: str) -> None:
        self._proc = subprocess.Popen(["say", "-v", voice, "-r", str(self.cfg.say_rate), text])
        while self._proc.poll() is None:
            if self._stop.is_set():
                self._proc.terminate()
                break
            self.speaking_until = time.monotonic() + 0.6
            time.sleep(0.03)
        self._proc = None

    def _speak_one(self, sentence: str) -> None:
        lang = detect_lang(sentence)
        if lang == "en":
            text = clean_for_speech(sentence)
            if self._qwen is not None:
                self._play(*self._synth_qwen(text, "en"))
            else:
                self._say_cmd(text, self.cfg.say_en_voice)
            return
        text = prepare_ru(sentence)
        if not re.search(r"\w", text):
            return
        if self._qwen is not None:
            self._play(*self._synth_qwen(text, "ru"))
        elif self._silero is not None:
            self._play(*self._synth_silero(text))
        else:
            self._say_cmd(clean_for_speech(sentence), self._ru_voice or "Milena")

    def _worker(self) -> None:
        while True:
            sentence = self._q.get()
            if sentence is None or self._stop.is_set():
                if self._q.empty():
                    self._set_busy(False)
                continue
            self._set_busy(True)
            try:
                self._speak_one(sentence)
            except Exception:
                log.exception("Ошибка синтеза речи: %r", sentence)
            self.speaking_until = time.monotonic() + 0.5
            if self._q.empty():
                self._set_busy(False)

    def _set_busy(self, on: bool) -> None:
        if on == self._busy.is_set():
            if on and not self._cur_start:
                self._cur_start = time.monotonic()
            return
        if on:
            self._cur_start = time.monotonic()
        else:
            self._intervals.append((self._cur_start or time.monotonic(), time.monotonic() + 0.5))
            self._cur_start = 0.0
        (self._busy.set if on else self._busy.clear)()
        if self.on_speaking:
            self.on_speaking(on)

    # ------------------------------------------------------------ публичное API
    def say(self, text: str) -> None:
        text = text.strip()
        if text:
            self._stop.clear()
            self._set_busy(True)
            self._q.put(text)

    @property
    def is_speaking(self) -> bool:
        return self._busy.is_set() or time.monotonic() < self.speaking_until

    def overlaps(self, t_start: float, t_end: float) -> bool:
        """Была ли фраза с микрофона записана, пока мы говорили (эхо из динамиков)."""
        if self._busy.is_set() and self._cur_start and t_end > self._cur_start:
            return True
        return any(s < t_end and e > t_start for s, e in self._intervals)

    def interrupt(self) -> None:
        self._stop.set()
        with self._q.mutex:
            self._q.queue.clear()
        self._q.put(None)

    def wait_idle(self, timeout: float = 120) -> None:
        end = time.monotonic() + timeout
        while self._busy.is_set() and time.monotonic() < end:
            time.sleep(0.05)
