"""Распознавание речи на GPU Apple Silicon (MLX).

По умолчанию — NVIDIA Parakeet TDT 0.6B v3: 25 языков (русский и английский с автоопределением),
~5.5% WER на русском FLEURS, и главное — в десятки раз быстрее Whisper: нет паддинга до 30 секунд,
поэтому постоянное прослушивание почти не грузит GPU. Запасной вариант — Whisper large-v3-turbo.
"""
from __future__ import annotations

import logging
import re

import numpy as np

log = logging.getLogger(__name__)

# Типичные «галлюцинации» Whisper на тишине и шуме
_HALLUCINATIONS = re.compile(
    r"(субтитр|продолжение следует|спасибо за просмотр|подписывайтесь|dimatorzok|редактор|корректор|"
    r"amara\.org|thank you for watching|thanks for watching|please subscribe|♪|ставьте лайк)",
    re.I,
)


class STT:
    def __init__(self, cfg):
        self.cfg = cfg.stt
        self.engine = self.cfg.get("engine", "parakeet")
        self.languages = list(self.cfg.languages)
        self._parakeet = None

    def warmup(self) -> None:
        if self.engine == "parakeet":
            try:
                from parakeet_mlx import from_pretrained

                self._parakeet = from_pretrained(self.cfg.parakeet_model)
            except Exception as e:
                log.warning("Parakeet не загрузился (%s) — переключаюсь на Whisper", e)
                self.engine = "whisper"
        self.transcribe(np.zeros(16000, dtype=np.float32))
        log.info("Распознавание речи готово: %s", self.cfg.parakeet_model if self.engine == "parakeet" else self.cfg.model)

    # ------------------------------------------------------------ Parakeet
    def _parakeet_run(self, audio: np.ndarray) -> tuple[str, str]:
        import mlx.core as mx
        from parakeet_mlx.audio import get_logmel

        if self._parakeet is None:
            from parakeet_mlx import from_pretrained
            self._parakeet = from_pretrained(self.cfg.parakeet_model)
        mel = get_logmel(mx.array(audio, dtype=mx.bfloat16), self._parakeet.preprocessor_config)
        res = self._parakeet.generate(mel)[0]
        text = res.text.strip()
        tokens = res.tokens
        if not text or not tokens:
            return "", "ru"
        conf = float(np.exp(np.mean(np.log(np.array([t.confidence for t in tokens]) + 1e-10))))
        if conf < float(self.cfg.get("min_confidence", 0.35)):
            log.debug("отброшено (уверенность %.2f): %s", conf, text)
            return "", "ru"
        cyr = len(re.findall(r"[А-Яа-яЁё]", text))
        return text, ("ru" if cyr >= len(re.findall(r"[A-Za-z]", text)) else "en")

    # ------------------------------------------------------------ Whisper
    def _whisper_run(self, audio: np.ndarray, language: str | None) -> dict:
        import mlx_whisper

        return mlx_whisper.transcribe(
            audio,
            path_or_hf_repo=self.cfg.model,
            language=language,
            initial_prompt=self.cfg.initial_prompt,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.4,
            temperature=(0.0, 0.2, 0.4),
            verbose=None,
        )

    def _whisper(self, audio: np.ndarray) -> tuple[str, str]:
        res = self._whisper_run(audio, None)
        lang = res.get("language") or "ru"
        if lang not in self.languages:
            res = self._whisper_run(audio, self.languages[0])
            lang = self.languages[0]
        segments = res.get("segments") or []
        if segments and all(s.get("no_speech_prob", 0) > 0.6 and s.get("avg_logprob", 0) < -0.8 for s in segments):
            return "", lang
        text = (res.get("text") or "").strip()
        prompt = self.cfg.initial_prompt
        if len(text) > 0.6 * len(prompt) and text.strip(" .") in prompt:  # эхо initial_prompt
            return "", lang
        return text, lang

    # ------------------------------------------------------------ общее
    def transcribe(self, audio: np.ndarray) -> tuple[str, str]:
        text, lang = self._parakeet_run(audio) if self.engine == "parakeet" else self._whisper(audio)
        if _HALLUCINATIONS.search(text) or not re.search(r"\w", text):
            return "", lang
        return text, lang
