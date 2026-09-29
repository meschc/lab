"""Микрофон, который слушает всегда, и нарезка речи на фразы через Silero VAD."""
from __future__ import annotations

import collections
import logging
import queue
import threading
import time
from dataclasses import dataclass
from typing import Callable, Iterator

import numpy as np

log = logging.getLogger(__name__)

CHUNK = 512  # Silero VAD при 16 кГц работает окнами по 512 сэмплов (32 мс)


@dataclass
class Segment:
    audio: np.ndarray  # float32 mono 16 кГц
    t_start: float     # time.monotonic()
    t_end: float


class Listener:
    def __init__(self, cfg, on_level: Callable[[float], None] | None = None):
        self.cfg = cfg.audio
        self.sr = int(self.cfg.sample_rate)
        self.on_level = on_level
        self.enabled = threading.Event()
        self.enabled.set()
        self._q: queue.Queue[np.ndarray] = queue.Queue(maxsize=1000)
        self._stream = None
        self._vad = None

    # ------------------------------------------------------------ микрофон
    def _callback(self, indata, frames, time_info, status):
        if status:
            log.debug("audio status: %s", status)
        if not self.enabled.is_set():
            return
        try:
            self._q.put_nowait(indata[:, 0].copy())
        except queue.Full:
            pass

    def start(self) -> None:
        import sounddevice as sd
        from silero_vad import load_silero_vad

        self._vad = load_silero_vad()
        self._stream = sd.InputStream(samplerate=self.sr, channels=1, dtype="float32", blocksize=CHUNK,
                                      device=self.cfg.device, callback=self._callback)
        self._stream.start()
        log.info("Микрофон: %s", self._stream.device)

    def stop(self) -> None:
        if self._stream:
            self._stream.stop()
            self._stream.close()

    def set_enabled(self, on: bool) -> None:
        (self.enabled.set if on else self.enabled.clear)()
        if not on:
            with self._q.mutex:
                self._q.queue.clear()

    # ------------------------------------------------------------ сегментация
    def _chunks(self) -> Iterator[np.ndarray]:
        buf = np.zeros(0, dtype=np.float32)
        while True:
            data = self._q.get()
            buf = np.concatenate([buf, data])
            while len(buf) >= CHUNK:
                yield buf[:CHUNK]
                buf = buf[CHUNK:]

    def segments(self) -> Iterator[Segment]:
        import torch

        ms_per_chunk = CHUNK * 1000 / self.sr
        pad_chunks = max(1, int(self.cfg.speech_pad_ms / ms_per_chunk))
        silence_limit = int(self.cfg.min_silence_ms / ms_per_chunk)
        min_speech = int(self.cfg.min_speech_ms / ms_per_chunk)
        max_chunks = int(self.cfg.max_segment_s * 1000 / ms_per_chunk)
        thr = float(self.cfg.vad_threshold)

        preroll: collections.deque[np.ndarray] = collections.deque(maxlen=pad_chunks)
        speech: list[np.ndarray] = []
        voiced = silence = 0
        t_start = 0.0
        last_level = 0.0

        for chunk in self._chunks():
            now = time.monotonic()
            if self.on_level and now - last_level > 0.05:
                last_level = now
                self.on_level(float(min(1.0, np.sqrt(np.mean(chunk ** 2)) * 12)))
            prob = float(self._vad(torch.from_numpy(chunk), self.sr).item())

            if not speech:
                if prob >= thr:
                    speech = list(preroll) + [chunk]
                    voiced, silence = 1, 0
                    t_start = now - len(speech) * ms_per_chunk / 1000
                else:
                    preroll.append(chunk)
                continue

            speech.append(chunk)
            if prob >= thr - 0.15:
                voiced += 1
                silence = 0
            else:
                silence += 1

            if silence >= silence_limit or len(speech) >= max_chunks:
                if voiced >= min_speech:
                    yield Segment(np.concatenate(speech), t_start, now)
                speech, voiced, silence = [], 0, 0
                preroll.clear()
                self._vad.reset_states()


def chime(kind: str = "wake") -> None:
    """Короткий мягкий сигнал (без внешних файлов)."""
    import sounddevice as sd

    sr = 44100
    notes = {"wake": [(880, 0.07), (1320, 0.09)], "error": [(440, 0.12), (330, 0.15)],
             "off": [(990, 0.07), (660, 0.09)]}[kind]
    parts = []
    for freq, dur in notes:
        t = np.linspace(0, dur, int(sr * dur), False)
        env = np.minimum(1, np.minimum(t / 0.01, (dur - t) / 0.03))
        parts.append(0.18 * np.sin(2 * np.pi * freq * t) * env)
    sd.play(np.concatenate(parts).astype(np.float32), sr)
