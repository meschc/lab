"""python -m coulson --calibrate — подстройка слова-активатора под голос пользователя.

Просит несколько раз сказать «Колсон», смотрит, как распознавание записывает имя, и добавляет
новые варианты в config.local.yaml. Варианты, похожие на обычные слова, не добавляются.
"""
from __future__ import annotations

import re
import time
from collections import Counter

import yaml
from rapidfuzz import fuzz

from . import config
from .textutil import find_wake, normalize

# обычные слова, которые нельзя делать активатором (иначе ложные срабатывания)
_COMMON = {"колесо", "колесом", "кольцо", "колонка", "колонку", "кулон", "клоун", "колос", "колосок", "сон", "коля",
           "кол", "солнце", "каллсон", "карлсон", "нельсон", "олсон", "close", "colson's"}


def pick_variant(text: str, known: list[str]) -> str | None:
    """Из распознанной фразы — слово, которое больше всего похоже на имя."""
    words = [normalize(w) for w in re.findall(r"[A-Za-zА-Яа-яЁё'-]+", text)]
    words = [w for w in words if len(w) >= 4]
    if not words:
        return None
    best = max(words, key=lambda w: max(fuzz.ratio(w, k) for k in known))
    return best if max(fuzz.ratio(best, k) for k in known) >= 55 and best not in _COMMON else None


def merge_wake_words(local: dict, defaults: list[str], new: list[str]) -> dict:
    local = dict(local or {})
    a = dict(local.get("assistant") or {})
    words = list(dict.fromkeys([*defaults, *(a.get("wake_words") or []), *new]))
    a["wake_words"] = words
    local["assistant"] = a
    return local


def run(cfg, attempts: int = 8) -> None:
    import sounddevice as sd

    from .audio import chime
    from .stt import STT

    known = [normalize(w) for w in cfg.assistant.wake_words]
    stt = STT(cfg)
    print("Загружаю распознавание речи…")
    stt.warmup()
    print(f"\nСкажите «{cfg.assistant.name}» после каждого сигнала — обычным голосом, с разных расстояний.\n")
    found: Counter[str] = Counter()
    hits = 0
    for i in range(attempts):
        input(f"[{i + 1}/{attempts}] Enter — и говорите после сигнала…")
        chime("wake")
        time.sleep(0.25)
        audio = sd.rec(int(2.2 * 16000), samplerate=16000, channels=1, dtype="float32")
        sd.wait()
        text, _ = stt.transcribe(audio[:, 0])
        wake, _ = find_wake(text, list(cfg.assistant.wake_words), int(cfg.assistant.wake_threshold))
        hits += bool(wake)
        variant = pick_variant(text, known)
        print(f"   распознано: «{text or '—'}» {'✅ узнал' if wake else '❌ не узнал'}")
        if variant and not wake:
            found[variant] += 1
    new = [w for w, n in found.items() if w not in known]
    print(f"\nУзнал с первого раза: {hits} из {attempts}.")
    if not new:
        print("Новых вариантов не нужно — всё и так распознаётся." if hits >= attempts - 1 else
              "Подходящих вариантов не нашлось: попробуйте говорить чётче или ближе к микрофону.")
        return
    path = config.ROOT / "config.local.yaml"
    local = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}
    merged = merge_wake_words(local, list(cfg.assistant.wake_words), new)
    path.write_text(yaml.safe_dump(merged, allow_unicode=True, sort_keys=False), encoding="utf-8")
    print(f"Добавил варианты: {', '.join(new)} → {path.name}. Перезапустите Колсона.")
