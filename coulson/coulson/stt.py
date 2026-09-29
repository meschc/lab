"""Распознавание речи: Whisper large-v3-turbo на MLX (GPU Apple Silicon)."""
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
        self.languages = list(self.cfg.languages)

    def warmup(self) -> None:
        self.transcribe(np.zeros(16000, dtype=np.float32))
        log.info("Whisper загружен: %s", self.cfg.model)

    def _run(self, audio: np.ndarray, language: str | None) -> dict:
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

    def transcribe(self, audio: np.ndarray) -> tuple[str, str]:
        res = self._run(audio, None)
        lang = res.get("language") or "ru"
        if lang not in self.languages:
            res = self._run(audio, self.languages[0])
            lang = self.languages[0]
        segments = res.get("segments") or []
        if segments and all(s.get("no_speech_prob", 0) > 0.6 and s.get("avg_logprob", 0) < -0.8 for s in segments):
            return "", lang
        text = (res.get("text") or "").strip()
        if _HALLUCINATIONS.search(text) or not re.search(r"\w", text):
            return "", lang
        # Whisper иногда эхом повторяет initial_prompt
        prompt = self.cfg.initial_prompt
        if len(text) > 0.6 * len(prompt) and text.strip(" .") in prompt:
            return "", lang
        return text, lang
