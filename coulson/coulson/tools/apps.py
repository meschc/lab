"""Приложения и игры: поиск по всему диску (Spotlight), Steam, CrossOver/Whisky, Epic."""
from __future__ import annotations

import glob
import logging
import re
import threading
import time
from pathlib import Path

from rapidfuzz import fuzz, process

from ..textutil import normalize, ru_to_lat
from . import osascript, registry, run

log = logging.getLogger(__name__)
HOME = Path.home()
STEAM = HOME / "Library/Application Support/Steam/steamapps"


class AppIndex:
    def __init__(self):
        self._entries: dict[str, tuple[str, str]] = {}  # ключ поиска -> (отображаемое имя, как запускать)
        self._built = 0.0
        self._lock = threading.Lock()

    def _add(self, name: str, target: str) -> None:
        key = normalize(name)
        if key and key not in self._entries:
            self._entries[key] = (name, target)

    def build(self) -> None:
        paths: list[str] = []
        try:
            out = run(["mdfind", "kMDItemContentType == 'com.apple.application-bundle'"], timeout=20)
            paths = [p for p in out.splitlines() if p.endswith(".app")]
        except Exception:
            pass
        for base in ("/Applications", "/System/Applications", "/System/Applications/Utilities",
                     str(HOME / "Applications"), "/Applications/Utilities"):
            paths += glob.glob(f"{base}/*.app") + glob.glob(f"{base}/*/*.app")
        with self._lock:
            # Steam: игры запускаем через steam:// — так работают и те, у кого нет .app
            for acf in glob.glob(str(STEAM / "appmanifest_*.acf")):
                try:
                    text = Path(acf).read_text(errors="ignore")
                    appid = re.search(r'"appid"\s+"(\d+)"', text).group(1)
                    name = re.search(r'"name"\s+"([^"]+)"', text).group(1)
                    self._add(name, f"steam://rungameid/{appid}")
                except Exception:
                    continue
            for p in sorted(set(paths), key=lambda x: (x.startswith("/System"), "/Library/" in x, len(x))):
                if "/Contents/" in p or "/Frameworks/" in p or "Uninstall" in p:
                    continue
                self._add(Path(p).stem, p)
            self._built = time.time()
        log.info("Индекс приложений: %d", len(self._entries))

    def ensure(self) -> None:
        if not self._entries or time.time() - self._built > 1800:
            self.build()

    def search(self, query: str, limit: int = 5) -> list[tuple[str, str, float]]:
        self.ensure()
        q = normalize(query)
        variants = {q, normalize(ru_to_lat(q))}
        best: dict[str, float] = {}
        keys = list(self._entries)
        for v in variants:
            for key, score, _ in process.extract(v, keys, scorer=fuzz.WRatio, limit=limit * 2):
                # точное совпадение начала имени весит больше
                if key.startswith(v) or v.startswith(key):
                    score += 8
                best[key] = max(best.get(key, 0), score)
        ranked = sorted(best.items(), key=lambda kv: -kv[1])[:limit]
        return [(self._entries[k][0], self._entries[k][1], s) for k, s in ranked]

    def resolve(self, name: str, aliases: dict) -> tuple[str, str] | None:
        alias = {normalize(k): v for k, v in (aliases or {}).items()}.get(normalize(name))
        if alias:
            name = alias
        found = self.search(name, 3)
        if not found or found[0][2] < 75:
            self.build()  # вдруг поставили что-то новое
            found = self.search(name, 3)
        if found and found[0][2] >= 75:
            return found[0][0], found[0][1]
        return None


index = AppIndex()


def is_game(target: str) -> bool:
    if target.startswith("steam://"):
        return True
    try:
        import plistlib
        info = plistlib.loads((Path(target) / "Contents/Info.plist").read_bytes())
        return "games" in str(info.get("LSApplicationCategoryType", ""))
    except Exception:
        return any(k in target for k in ("/Epic Games/", "/CrossOver/", "/Steam/", "/GOG"))


def _launch(target: str) -> str:
    if target.startswith("steam://"):
        return run(["open", target])
    return run(["open", "-a", target])


@registry.add("open_app", "Open/focus any app or game (Steam, Epic, CrossOver). Name as the user said it.",
              {"name": ("string", "")}, ["name"])
def open_app(ctx, name: str) -> str:
    hit = index.resolve(name, ctx.cfg.apps.get("aliases", {}))
    if not hit:
        close = ", ".join(n for n, _, _ in index.search(name, 5))
        return f"Не нашёл приложение «{name}». Похожие: {close or 'нет'}"
    display, target = hit
    res = _launch(target)
    if res == "OK" and is_game(target):
        ctx.game_launched = True
    return f"Запущено: {display}" if res == "OK" else f"Пробовал запустить {display}: {res}"


@registry.add("quit_app", "Quit an app.", {"name": ("string", "")}, ["name"])
def quit_app(ctx, name: str) -> str:
    hit = index.resolve(name, ctx.cfg.apps.get("aliases", {}))
    app = hit[0] if hit and not hit[1].startswith("steam://") else name
    res = osascript(f'tell application "{app}" to quit')
    return f"Закрыто: {app}" if res == "OK" else res


@registry.add("find_app", "Search installed apps and games by name.", {"query": ("string", "")}, ["query"])
def find_app(ctx, query: str) -> str:
    return "\n".join(f"{n} — {t}" for n, t, s in index.search(query, 8)) or "Ничего не найдено"


@registry.add("running_apps", "Running apps.")
def running_apps(ctx) -> str:
    return osascript('tell application "System Events" to get name of every process whose background only is false')
