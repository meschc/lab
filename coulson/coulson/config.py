"""Загрузка настроек: config.yaml + config.local.yaml поверх."""
from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("COULSON_DATA", Path.home() / "Library/Application Support/Coulson"))
LOG_FILE = Path.home() / "Library/Logs/Coulson.log"


class Config(dict):
    """dict с доступом через точку: cfg.llm.model."""

    def __getattr__(self, key: str) -> Any:
        try:
            value = self[key]
        except KeyError as e:
            raise AttributeError(key) from e
        return Config(value) if isinstance(value, dict) and not isinstance(value, Config) else value


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def _to_config(d: dict) -> Config:
    return Config({k: _to_config(v) if isinstance(v, dict) else v for k, v in d.items()})


def load(path: str | Path | None = None) -> Config:
    data = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8")) or {}
    local = Path(path) if path else ROOT / "config.local.yaml"
    if local.exists():
        data = _merge(data, yaml.safe_load(local.read_text(encoding="utf-8")) or {})
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return _to_config(data)
