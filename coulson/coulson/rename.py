"""Смена имени ассистента: `python -m coulson --rename "Джарвис"`.

Пишет в config.local.yaml новое имя и варианты для распознавания (падежи, латиница). Остальное подхватывается
само: промпт, окно, приветствие, проверка «похожести» имени (textutil._skeleton_ok не привязан к «Колсон»).
Хорошее имя — 2–3 слога, редкое в обычной речи (не «Пятница», не «Макс»), с чёткими согласными.
"""
from __future__ import annotations

import yaml

from . import config
from .textutil import lat_to_ru, normalize, ru_to_lat


def wake_variants(name: str) -> list[str]:
    base = normalize(name)
    if not base:
        raise ValueError("пустое имя")
    cyr = base if any("а" <= ch <= "я" for ch in base) else normalize(lat_to_ru(base))
    forms = [cyr]
    if cyr[-1] in "ая":
        stem = cyr[:-1]
        forms += [stem + e for e in ("ы", "и", "е", "у", "ю", "ой", "ей")]
    elif cyr[-1] in "ьй":
        stem = cyr[:-1]
        forms += [stem + e for e in ("я", "ю", "е", "ем")]
    elif cyr[-1] not in "аеёиоуыэюя":
        forms += [cyr + e for e in ("а", "у", "е", "ом")]
    lat = ru_to_lat(cyr)
    forms += [lat] + ([base] if base != cyr else [])
    return list(dict.fromkeys(f for f in forms if f))


def rename(name: str) -> str:
    name = name.strip()
    path = config.ROOT / "config.local.yaml"
    local = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}
    local = dict(local or {})
    a = dict(local.get("assistant") or {})
    a["name"] = name[:1].upper() + name[1:]
    a["wake_words"] = wake_variants(name)  # заменяем, а не дополняем: старое имя больше не отзывается
    local["assistant"] = a
    path.write_text(yaml.safe_dump(local, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return (f"Теперь меня зовут {a['name']}. Варианты: {', '.join(a['wake_words'])}.\n"
            f"Дальше: `python -m coulson --calibrate` (8 раз скажите новое имя) и перезапуск.")
