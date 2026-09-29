"""Микрофон, который слушает всегда, и нарезка речи на фразы через Silero VAD."""
from __future__ import annotations

import collections
import logging
import queue
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator

import numpy as np

log = logging.getLogger(__name__)

CHUNK = 512  # Silero VAD при 16 кГц работает окнами по 512 сэмплов (32 мс)
STALL_SECONDS = 3.0  # столько без звука с микрофона — перезапускаем поток (сон Мака, отключили устройство)


@dataclass
class Segment:
    audio: np.ndarray  # float32 mono 16 кГц
    t_start: float     # time.monotonic() момента ЗАПИСИ начала фразы
    t_end: float


class Listener:
    def __init__(self, cfg, on_level: Callable[[float], None] | None = None):
        self.cfg = cfg.audio
        self.sr = int(self.cfg.sample_rate)
        self.on_level = on_level
        self.enabled = threading.Event()
        self.enabled.set()
        self._q: queue.Queue[tuple[float, np.ndarray]] = queue.Queue(maxsize=2000)
        self._stream = None
        self._vad = None
        self._last_audio = 0.0
        self._restart_lock = threading.Lock()

    # ------------------------------------------------------------ микрофон
    def _callback(self, indata, frames, time_info, status):
        now = time.monotonic()
        self._last_audio = now
        if status:
            log.debug("audio status: %s", status)
        if not self.enabled.is_set():
            return
        try:
            self._q.put_nowait((now, indata[:, 0].copy()))
        except queue.Full:
            pass

    def _open_stream(self) -> None:
        import sounddevice as sd

        self._stream = sd.InputStream(samplerate=self.sr, channels=1, dtype="float32", blocksize=CHUNK,
                                      device=self.cfg.device, callback=self._callback)
        self._stream.start()
        self._last_audio = time.monotonic()
        log.info("Микрофон: %s", sd.query_devices(self._stream.device)["name"])

    def start(self) -> None:
        from silero_vad import load_silero_vad

        self._vad = load_silero_vad()
        self._open_stream()
        threading.Thread(target=self._watchdog, daemon=True, name="mic-watchdog").start()

    def _watchdog(self) -> None:
        while True:
            time.sleep(1.0)
            if time.monotonic() - self._last_audio > STALL_SECONDS:
                self.restart()

    def restart(self) -> None:
        """Переоткрыть микрофон с обновлённым списком устройств (PortAudio сам его не обновляет)."""
        import sounddevice as sd

        with self._restart_lock:
            log.warning("Микрофон замолчал — переподключаюсь")
            try:
                if self._stream:
                    self._stream.abort()
                    self._stream.close()
            except Exception:
                pass
            self._stream = None
            try:
                sd._terminate()
                sd._initialize()
                self._open_stream()
            except Exception as e:
                log.error("Не удалось открыть микрофон: %s — повторю через несколько секунд", e)
                self._last_audio = time.monotonic()  # следующая попытка — после STALL_SECONDS

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
    def _chunks(self) -> Iterator[tuple[float, np.ndarray]]:
        """Куски по CHUNK сэмплов с временем записи их конца."""
        buf = np.zeros(0, dtype=np.float32)
        t_buf_end = 0.0
        while True:
            t, data = self._q.get()
            buf = np.concatenate([buf, data])
            t_buf_end = t
            while len(buf) >= CHUNK:
                left_after = len(buf) - CHUNK
                yield t_buf_end - left_after / self.sr, buf[:CHUNK]
                buf = buf[CHUNK:]

    def segments(self) -> Iterator[Segment]:
        import torch

        ms_per_chunk = CHUNK * 1000 / self.sr
        chunk_s = CHUNK / self.sr
        pad_chunks = max(1, int(self.cfg.speech_pad_ms / ms_per_chunk))
        silence_limit = int(self.cfg.min_silence_ms / ms_per_chunk)
        min_speech = int(self.cfg.min_speech_ms / ms_per_chunk)
        max_chunks = int(self.cfg.max_segment_s * 1000 / ms_per_chunk)
        thr = float(self.cfg.vad_threshold)

        preroll: collections.deque[tuple[float, np.ndarray]] = collections.deque(maxlen=pad_chunks)
        speech: list[np.ndarray] = []
        voiced = silence = 0
        t_start = 0.0
        last_level = 0.0

        for t_chunk, chunk in self._chunks():
            now = time.monotonic()
            if self.on_level and now - last_level > 0.05:
                last_level = now
                self.on_level(float(min(1.0, np.sqrt(np.mean(chunk ** 2)) * 12)))
            prob = float(self._vad(torch.from_numpy(chunk), self.sr).item())

            if not speech:
                if prob >= thr:
                    first_t = preroll[0][0] if preroll else t_chunk
                    speech = [c for _, c in preroll] + [chunk]
                    voiced, silence = 1, 0
                    t_start = first_t - chunk_s
                else:
                    preroll.append((t_chunk, chunk))
                continue

            speech.append(chunk)
            if prob >= thr - 0.15:
                voiced += 1
                silence = 0
            else:
                silence += 1

            if silence >= silence_limit or len(speech) >= max_chunks:
                if voiced >= min_speech:
                    yield Segment(np.concatenate(speech), t_start, t_chunk)
                speech, voiced, silence = [], 0, 0
                preroll.clear()
                self._vad.reset_states()


_CHIMES = {"wake": [(880, 0.07), (1320, 0.09)], "error": [(440, 0.12), (330, 0.15)],
           "off": [(990, 0.07), (660, 0.09)]}


def chime(kind: str = "wake") -> None:
    """Короткий мягкий сигнал (генерируется один раз, играет системным afplay)."""
    from .tts import write_wav

    path = Path(tempfile.gettempdir()) / f"coulson_chime_{kind}.wav"
    if not path.exists():
        sr = 44100
        parts = []
        for freq, dur in _CHIMES[kind]:
            t = np.linspace(0, dur, int(sr * dur), False)
            env = np.minimum(1, np.minimum(t / 0.01, (dur - t) / 0.03))
            parts.append(0.18 * np.sin(2 * np.pi * freq * t) * env)
        write_wav(path, np.concatenate(parts).astype(np.float32), sr)
    subprocess.Popen(["afplay", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
