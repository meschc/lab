"""Голос: Silero v5 (русский), macOS «Daniel» (британский английский), опционально Qwen3-TTS.

Фразы ставятся в очередь и произносятся в отдельном потоке, так что можно говорить,
пока модель ещё дописывает ответ. interrupt() мгновенно обрывает речь.
Звук играет системный afplay — он всегда выводит в текущее устройство (подключил AirPods — звук там).
"""
from __future__ import annotations

import collections
import logging
import queue
import re
import subprocess
import tempfile
import threading
import time
import wave
from pathlib import Path

import numpy as np

from .textutil import clean_for_speech, detect_lang, prepare_ru

log = logging.getLogger(__name__)

SILERO_MAX_CHARS = 800  # Silero падает на слишком длинном тексте


def best_russian_say_voice() -> str | None:
    """Лучший установленный русский голос macOS или None, если ни одного нет."""
    try:
        out = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return None
    voices = [re.split(r"\s{2,}", line.strip())[0] for line in out.splitlines() if "ru_RU" in line]
    for pref in ("Yuri (Premium)", "Yuri (Enhanced)", "Yuri", "Milena (Premium)", "Milena (Enhanced)", "Milena"):
        if pref in voices:
            return pref
    return voices[0] if voices else None


def split_long(text: str, limit: int = SILERO_MAX_CHARS) -> list[str]:
    """Режет длинный текст по запятым/пробелам на куски не длиннее limit."""
    parts, rest = [], text.strip()
    while len(rest) > limit:
        cut = max(rest.rfind(sep, 0, limit) for sep in (", ", "; ", " — ", " "))
        cut = cut if cut > limit // 3 else limit
        parts.append(rest[:cut].strip(" ,;—"))
        rest = rest[cut:].strip(" ,;—")
    if rest:
        parts.append(rest)
    return parts


def write_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


class Speaker:
    def __init__(self, cfg):
        self.cfg = cfg.tts
        self._q: queue.Queue[tuple[int, str]] = queue.Queue()
        self._lock = threading.Lock()
        self._gen = 0          # «поколение»: interrupt() увеличивает его, и все старые фразы отменяются
        self._pending = 0      # сколько фраз текущего поколения ещё не договорено
        self._busy = threading.Event()
        self._silero = None
        self._qwen = None
        self._ru_voice: str | None = None
        self._tmp = Path(tempfile.gettempdir()) / "coulson_tts"
        self._tmp.mkdir(exist_ok=True)
        self._cur_start = 0.0
        self._intervals: collections.deque[tuple[float, float]] = collections.deque(maxlen=30)
        self.on_speaking = None     # callback(bool) для UI
        self.played: list[str] = []  # фразы, прозвучавшие ПОЛНОСТЬЮ (для истории при перебивании)
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
        cached = Path(torch.hub.get_dir()) / "snakers4_silero-models_master"
        if cached.exists():  # без интернета и без запросов к GitHub API при каждом старте
            model, _ = torch.hub.load(str(cached), "silero_tts", source="local", language="ru",
                                      speaker=self.cfg.silero_model)
        else:
            model, _ = torch.hub.load("snakers4/silero-models", "silero_tts", language="ru",
                                      speaker=self.cfg.silero_model, trust_repo=True, skip_validation=True)
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
    def _run_until_done(self, cmd: list[str], gen: int) -> None:
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            while proc.poll() is None:
                if gen != self._gen:  # перебили
                    proc.terminate()
                    break
                time.sleep(0.03)
        finally:
            if proc.poll() is None:
                proc.kill()

    def _play(self, audio: np.ndarray, sr: int, gen: int) -> None:
        path = self._tmp / f"say_{time.time_ns()}.wav"
        write_wav(path, audio, sr)
        try:
            self._run_until_done(["afplay", str(path)], gen)
        finally:
            path.unlink(missing_ok=True)

    def _say_cmd(self, text: str, voice: str | None, gen: int) -> None:
        cmd = ["say", "-r", str(self.cfg.say_rate), text]
        if voice:
            cmd[1:1] = ["-v", voice]
        self._run_until_done(cmd, gen)

    def _speak_one(self, sentence: str, gen: int) -> None:
        lang = detect_lang(sentence)
        if lang == "en":
            text = clean_for_speech(sentence)
            if self._qwen is not None:
                self._play(*self._synth_qwen(text, "en"), gen)
            else:
                self._say_cmd(text, self.cfg.say_en_voice, gen)
            return
        text = prepare_ru(sentence)
        if not re.search(r"\w", text):
            return
        for part in split_long(text):
            if gen != self._gen:
                return
            if self._qwen is not None:
                self._play(*self._synth_qwen(part, "ru"), gen)
            elif self._silero is not None:
                self._play(*self._synth_silero(part), gen)
            else:
                self._say_cmd(clean_for_speech(part), self._ru_voice, gen)

    def _worker(self) -> None:
        while True:
            gen, sentence = self._q.get()
            if gen == self._gen:
                try:
                    self._speak_one(sentence, gen)
                    if gen == self._gen:
                        self.played.append(sentence)
                        del self.played[:-500]
                except Exception:
                    log.exception("Ошибка синтеза речи: %r", sentence)
            changed = False
            with self._lock:
                if gen == self._gen:
                    self._pending -= 1
                    if self._pending <= 0:
                        self._pending = 0
                        changed = self._set_busy(False)
            if changed:
                self._notify(False)

    def _set_busy(self, on: bool) -> bool:
        """Вызывать под self._lock. Возвращает True, если состояние изменилось."""
        if on == self._busy.is_set():
            return False
        now = time.monotonic()
        if on:
            self._cur_start = now
            self._busy.set()
        else:
            self._intervals.append((self._cur_start or now, now + 0.5))  # +хвост эха в комнате
            self._cur_start = 0.0
            self._busy.clear()
        return True

    def _notify(self, on: bool) -> None:
        # вне блокировки: колбэк трогает окно, а оно не должно ждать голос
        if self.on_speaking:
            try:
                self.on_speaking(on)
            except Exception:
                log.exception("on_speaking")

    # ------------------------------------------------------------ публичное API
    def say(self, text: str) -> None:
        text = text.strip()
        if not text:
            return
        with self._lock:
            self._pending += 1
            changed = self._set_busy(True)
            self._q.put((self._gen, text))
        if changed:
            self._notify(True)

    @property
    def is_speaking(self) -> bool:
        return self._busy.is_set()

    def overlaps(self, t_start: float, t_end: float) -> bool:
        """Была ли фраза с микрофона записана, пока мы говорили (эхо из динамиков)."""
        with self._lock:
            if self._busy.is_set() and self._cur_start and t_end > self._cur_start:
                return True
            return any(s < t_end and e > t_start for s, e in self._intervals)

    def interrupt(self) -> None:
        with self._lock:
            self._gen += 1
            self._pending = 0
            with self._q.mutex:
                self._q.queue.clear()
            changed = self._set_busy(False)
        if changed:
            self._notify(False)

    def wait_idle(self, timeout: float = 120) -> None:
        end = time.monotonic() + timeout
        while self._busy.is_set() and time.monotonic() < end:
            time.sleep(0.05)
