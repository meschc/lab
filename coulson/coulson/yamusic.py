"""Яндекс Музыка напрямую через API от имени аккаунта пользователя — без браузера и кликов.

- Вход: OAuth Device Flow («как на телевизоре»): Колсон показывает код, пользователь вводит его на странице
  Яндекса. Пароль программа не видит. Токен — в Связке ключей macOS (не в файле).
- Поиск и выбор трека по названию/исполнителю, «Моя волна», любимые треки, лайк/дизлайк.
- Играет mpv в фоне (управление через IPC-сокет: пауза, следующий, громкость, что играет). Очередь ведём сами,
  а прямую ссылку на поток берём прямо перед запуском трека — ссылки Яндекса быстро истекают.
Библиотека yandex-music — неофициальная обёртка над API Яндекс Музыки; полные треки — с подпиской Плюс.
"""
from __future__ import annotations

import json
import logging
import os
import random
import shutil
import socket
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from rapidfuzz import fuzz

from . import config

log = logging.getLogger(__name__)

KEYCHAIN_SERVICE = "coulson-yandex-music"


# ---------------------------------------------------------------- токен

def load_token() -> str | None:
    try:
        p = subprocess.run(["security", "find-generic-password", "-a", "coulson", "-s", KEYCHAIN_SERVICE, "-w"],
                           capture_output=True, text=True, timeout=10)
        if p.returncode == 0 and p.stdout.strip():
            return p.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    f = config.DATA_DIR / "yandex_music_token"  # запасной вариант вне macOS
    return f.read_text().strip() if f.exists() else None


def save_token(token: str) -> None:
    try:
        p = subprocess.run(["security", "add-generic-password", "-U", "-a", "coulson", "-s", KEYCHAIN_SERVICE,
                            "-w", token], capture_output=True, timeout=10)
        if p.returncode == 0:
            return
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    f = config.DATA_DIR / "yandex_music_token"
    f.write_text(token)
    os.chmod(f, 0o600)


# ---------------------------------------------------------------- плеер mpv

class Player:
    """mpv без окна, управляемый через JSON IPC. Переживает перезапуск Колсона (сокет остаётся)."""

    def __init__(self, sock: Path | None = None):
        self.sock = sock or (config.DATA_DIR / "mpv.sock")
        self._lock = threading.Lock()

    def _connect(self) -> socket.socket | None:
        if not self.sock.exists():
            return None
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(3)
        try:
            s.connect(str(self.sock))
            return s
        except OSError:
            s.close()
            return None

    def ensure(self) -> None:
        s = self._connect()
        if s:
            s.close()
            return
        exe = shutil.which("mpv") or next((p for p in ("/opt/homebrew/bin/mpv", "/usr/local/bin/mpv")
                                           if os.path.exists(p)), None)
        if not exe:
            raise RuntimeError("не установлен mpv (brew install mpv)")
        self.sock.unlink(missing_ok=True)
        subprocess.Popen([exe, "--no-video", "--idle=yes", "--no-terminal", f"--input-ipc-server={self.sock}",
                          "--input-media-keys=yes", "--volume=70", "--cache=yes"],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
        for _ in range(50):
            if self._connect():
                return
            time.sleep(0.1)
        raise RuntimeError("mpv не запустился")

    def command(self, *args) -> dict:
        with self._lock:
            s = self._connect()
            if s is None:
                return {"error": "not running"}
            try:
                s.sendall((json.dumps({"command": list(args)}) + "\n").encode())
                buf = b""
                while True:  # в поток могут прилетать события — ищем ответ на команду
                    chunk = s.recv(65536)
                    if not chunk:
                        return {"error": "closed"}
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        msg = json.loads(line or b"{}")
                        if "error" in msg and "event" not in msg:
                            return msg
            except (OSError, ValueError) as e:
                return {"error": str(e)}
            finally:
                s.close()

    def get(self, prop: str):
        return self.command("get_property", prop).get("data")

    def running(self) -> bool:
        s = self._connect()
        if s:
            s.close()
            return True
        return False


# ---------------------------------------------------------------- музыка

@dataclass
class Item:
    id: str
    title: str
    artists: str

    @property
    def name(self) -> str:
        return f"{self.artists} — {self.title}" if self.artists else self.title


def _item(track) -> Item:
    return Item(str(track.track_id if getattr(track, "track_id", None) else track.id), track.title or "",
                ", ".join(a.name for a in (track.artists or []) if a.name))


class YaMusic:
    def __init__(self, cfg, player: Player | None = None, client=None):
        self.cfg = cfg
        self.player = player or Player()
        self._client = client
        self.queue: list[Item] = []
        self.current: Item | None = None
        self.history: list[Item] = []
        self.wave = False
        self._watch: threading.Thread | None = None
        self._login_thread: threading.Thread | None = None

    # ---------------------------------------------- доступ к аккаунту
    @property
    def client(self):
        if self._client is None:
            token = load_token()
            if not token:
                raise PermissionError("Яндекс Музыка не подключена")
            from yandex_music import Client
            self._client = Client(token).init()
        return self._client

    def connected(self) -> bool:
        return self._client is not None or bool(load_token())

    def login(self, on_code, on_done) -> None:
        """Вход по коду в фоне: on_code(url, code) — показать/сказать пользователю; on_done(ok, text)."""
        from yandex_music import Client

        def job():
            try:
                c = Client()
                token = c.device_auth(on_code=lambda code: on_code(code.verification_url, code.user_code),
                                      timeout=600, device_name="Колсон")
                save_token(token.access_token)
                self._client = c.init()
                on_done(True, "Яндекс Музыка подключена")
            except Exception as e:
                log.exception("вход в Яндекс Музыку")
                on_done(False, f"Не получилось подключить Яндекс Музыку: {e}")

        self._login_thread = threading.Thread(target=job, daemon=True, name="yamusic-login")
        self._login_thread.start()

    # ---------------------------------------------- поиск
    def find(self, query: str) -> tuple[str, list[Item]]:
        """(что нашли, треки): лучший трек по совпадению названия/исполнителя, или топ исполнителя/альбома."""
        res = self.client.search(query, type_="all")
        if res is None:
            return "", []
        best = getattr(res, "best", None)
        kind = getattr(best, "type", None) if best else None
        if kind == "artist":
            artist = best.result
            tracks = self.client.artists_tracks(artist.id, page_size=30)
            items = [_item(t) for t in (tracks.tracks if tracks else [])]
            return f"исполнитель {artist.name}", items
        if kind == "album":
            album = self.client.albums_with_tracks(best.result.id)
            items = [_item(t) for vol in (album.volumes or []) for t in vol]
            return f"альбом «{album.title}»", items
        candidates = list(res.tracks.results) if res.tracks else []
        if kind == "track" and best.result not in candidates:
            candidates.insert(0, best.result)
        if not candidates:
            return "", []
        q = query.lower()
        scored = sorted(candidates, key=lambda t: -fuzz.token_set_ratio(q, f"{_item(t).name}".lower()))
        return "трек", [_item(scored[0])]

    def stream_url(self, item: Item) -> str:
        infos = self.client.tracks_download_info(item.id, get_direct_links=True)
        mp3 = [i for i in infos if i.codec == "mp3"] or infos
        best = max(mp3, key=lambda i: i.bitrate_in_kbps or 0)
        return best.direct_link

    # ---------------------------------------------- воспроизведение
    def _start(self, item: Item) -> None:
        self.player.ensure()
        url = self.stream_url(item)
        self.player.command("loadfile", url, "replace")
        self.player.command("set_property", "force-media-title", item.name)
        self.player.command("set_property", "pause", False)
        if self.current:
            self.history.append(self.current)
        self.current = item
        self._ensure_watch()

    def _ensure_watch(self) -> None:
        if self._watch is None or not self._watch.is_alive():
            self._watch = threading.Thread(target=self._watch_loop, daemon=True, name="yamusic-queue")
            self._watch.start()

    def _watch_loop(self) -> None:
        """Трек закончился → следующий из очереди (для «Моей волны» — подгружаем новые)."""
        while True:
            time.sleep(1.5)
            try:
                if self.current is None or not self.player.running():
                    continue
                if self.player.get("idle-active"):
                    self.next(auto=True)
            except Exception:
                log.exception("очередь музыки")

    def play(self, query: str) -> str:
        what, items = self.find(query)
        if not items:
            return f"Ошибка: в Яндекс Музыке не нашёл «{query}»"
        self.wave = False
        if len(items) > 1 and self.cfg.get("music", {}).get("shuffle_artist", False):
            random.shuffle(items)
        self.queue = items[1:]
        self._start(items[0])
        return f"Включаю {what}: {items[0].name}" if what != "трек" else f"Включаю {items[0].name}"

    def my_wave(self) -> str:
        self.wave = True
        self.queue = self._wave_batch()
        if not self.queue:
            return "Ошибка: «Моя волна» ничего не вернула"
        first = self.queue.pop(0)
        self._start(first)
        return f"Включаю «Мою волну»: {first.name}"

    def _wave_batch(self) -> list[Item]:
        res = self.client.rotor_station_tracks("user:onyourwave", queue=self.current.id if self.current else None)
        return [_item(s.track) for s in (res.sequence if res else []) if getattr(s, "track", None)]

    def liked(self) -> str:
        tl = self.client.users_likes_tracks()
        ids = [t.id for t in (tl.tracks if tl else [])][:200]
        if not ids:
            return "Ошибка: в «Мне нравится» пусто"
        random.shuffle(ids)
        items = [_item(t) for t in self.client.tracks(ids[:50])]
        self.wave = False
        self.queue = items[1:]
        self._start(items[0])
        return f"Включаю любимые треки: {items[0].name}"

    def next(self, auto: bool = False) -> str:
        if not self.queue and self.wave:
            self.queue = self._wave_batch()
        if not self.queue:
            self.player.command("stop")
            self.current = None
            return "Очередь закончилась" if auto else "Дальше в очереди ничего нет"
        self._start(self.queue.pop(0))
        return f"Следующий: {self.current.name}"

    def previous(self) -> str:
        if not self.history:
            self.player.command("seek", 0, "absolute")
            return "С начала"
        prev = self.history.pop()
        if self.current:
            self.queue.insert(0, self.current)
        self.current = None
        self._start(prev)
        return f"Предыдущий: {prev.name}"

    def pause(self, on: bool | None = None) -> str:
        if not self.player.running() or self.current is None:
            return "Ошибка: сейчас ничего не играет"
        if on is None:
            self.player.command("cycle", "pause")
        else:
            self.player.command("set_property", "pause", on)
        return "Пауза" if self.player.get("pause") else "Продолжаю"

    def now_playing(self) -> str:
        if self.current is None or not self.player.running():
            return "Сейчас ничего не играет"
        pos, dur = self.player.get("time-pos") or 0, self.player.get("duration") or 0
        state = "на паузе" if self.player.get("pause") else "играет"
        return f"{state.capitalize()}: {self.current.name} ({int(pos) // 60}:{int(pos) % 60:02d} из " \
               f"{int(dur) // 60}:{int(dur) % 60:02d})"

    def like(self, dislike: bool = False) -> str:
        if self.current is None:
            return "Ошибка: сейчас ничего не играет"
        if dislike:
            self.client.users_dislikes_tracks_add(self.current.id)
            name = self.current.name
            self.next()
            return f"Больше не буду предлагать «{name}»"
        self.client.users_likes_tracks_add(self.current.id)
        return f"Добавил в «Мне нравится»: {self.current.name}"

    def volume(self, level: int) -> str:
        self.player.command("set_property", "volume", max(0, min(100, int(level))))
        return f"Громкость музыки {int(level)}"

    def active(self) -> bool:
        return self.current is not None and self.player.running()


_music: YaMusic | None = None


def get(cfg) -> YaMusic:
    global _music
    if _music is None:
        _music = YaMusic(cfg)
    return _music
