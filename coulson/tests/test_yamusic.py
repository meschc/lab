"""Яндекс Музыка через API: поддельный аккаунт + поддельный mpv, который по-настоящему слушает IPC-сокет."""
import json
import socket
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from coulson import yamusic as Y
from coulson.config import load


class FakeMpv:
    """Минимальный mpv: принимает JSON-команды через unix-сокет и хранит состояние."""

    def __init__(self, path: Path):
        self.path, self.state, self.log = path, {"pause": False, "idle-active": True, "volume": 70,
                                                 "time-pos": 42.0, "duration": 180.0}, []
        self.srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.srv.bind(str(path))
        self.srv.listen(8)
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            conn, _ = self.srv.accept()
            with conn:
                data = b""
                while not data.endswith(b"\n"):
                    chunk = conn.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                if not data:
                    continue
                cmd = json.loads(data)["command"]
                self.log.append(cmd)
                reply = {"error": "success"}
                if cmd[0] == "get_property":
                    reply["data"] = self.state.get(cmd[1])
                elif cmd[0] == "set_property":
                    self.state[cmd[1]] = cmd[2]
                elif cmd[0] == "loadfile":
                    self.state.update({"idle-active": False, "path": cmd[1]})
                elif cmd[0] == "cycle":
                    self.state["pause"] = not self.state["pause"]
                elif cmd[0] == "stop":
                    self.state["idle-active"] = True
                conn.sendall((json.dumps({"event": "property-change"}) + "\n" + json.dumps(reply) + "\n").encode())


def tr(i, title, artist, album=1):
    return NS(id=i, track_id=f"{i}:{album}", title=title, artists=[NS(name=artist)])


class FakeClient:
    def __init__(self):
        self.liked, self.disliked = [], []
        self.tracks_by_id = {"1:1": tr(1, "Беспечный ангел", "Ария"), "2:1": tr(2, "Группа крови", "Кино"),
                             "3:1": tr(3, "Кукушка", "Кино")}

    def search(self, text, type_="all"):
        if "кино" in text.lower() and "групп" not in text.lower():
            return NS(best=NS(type="artist", result=NS(id=77, name="Кино")), tracks=None)
        results = [tr(1, "Беспечный ангел", "Ария"), tr(2, "Группа крови", "Кино")]
        return NS(best=NS(type="track", result=results[0]), tracks=NS(results=results))

    def artists_tracks(self, artist_id, page_size=20):
        return NS(tracks=[tr(2, "Группа крови", "Кино"), tr(3, "Кукушка", "Кино")])

    def tracks_download_info(self, track_id, get_direct_links=False):
        return [NS(codec="aac", bitrate_in_kbps=256, direct_link=f"https://x/{track_id}.aac"),
                NS(codec="mp3", bitrate_in_kbps=320, direct_link=f"https://x/{track_id}.mp3"),
                NS(codec="mp3", bitrate_in_kbps=192, direct_link=f"https://x/{track_id}-192.mp3")]

    def rotor_station_tracks(self, station, queue=None):
        return NS(sequence=[NS(track=tr(10 + i, f"Волна {i}", "Разные")) for i in range(3)])

    def users_likes_tracks_add(self, track_id):
        self.liked.append(track_id)
        return True

    def users_dislikes_tracks_add(self, track_id):
        self.disliked.append(track_id)
        return True


@pytest.fixture
def ym(monkeypatch):
    d = Path(tempfile.mkdtemp(dir="/tmp"))  # короткий путь: у unix-сокета ограничение длины
    mpv = FakeMpv(d / "mpv.sock")
    monkeypatch.setattr("coulson.config.DATA_DIR", d)
    m = Y.YaMusic(load(), player=Y.Player(d / "mpv.sock"), client=FakeClient())
    m._ensure_watch = lambda: None  # фоновый переход к следующему треку проверяем отдельно
    return m, mpv


def test_play_exact_song_not_first_result(ym):
    m, mpv = ym
    assert m.play("Кино Группа крови") == "Включаю Кино — Группа крови"
    assert mpv.state["path"] == "https://x/2:1.mp3"  # лучший mp3 320, а не первый результат (Ария)
    assert ["set_property", "force-media-title", "Кино — Группа крови"] in mpv.log


def test_play_artist_queues_top_tracks(ym):
    m, mpv = ym
    assert m.play("включи Кино").startswith("Включаю исполнитель Кино")
    assert [i.title for i in m.queue] == ["Кукушка"]
    assert m.next() == "Следующий: Кино — Кукушка" and mpv.state["path"].endswith("3:1.mp3")
    assert m.previous().startswith("Предыдущий: Кино — Группа крови")


def test_pause_now_playing_like_dislike_volume(ym):
    m, mpv = ym
    m.play("Кино Группа крови")
    assert m.pause() == "Пауза" and m.pause() == "Продолжаю"
    assert m.now_playing() == "Играет: Кино — Группа крови (0:42 из 3:00)"
    assert "Мне нравится" in m.like() and m.client.liked == ["2:1"]
    assert m.volume(40) == "Громкость музыки 40" and mpv.state["volume"] == 40


def test_my_wave_refills_queue(ym):
    m, mpv = ym
    assert m.my_wave() == "Включаю «Мою волну»: Разные — Волна 0"
    m.next()
    m.next()
    assert m.next().startswith("Следующий: Разные — Волна")  # очередь кончилась — подгрузил новую порцию


def test_track_end_advances_queue(ym):
    m, mpv = ym
    m.play("включи Кино")
    mpv.state["idle-active"] = True  # трек доиграл
    m.next(auto=True) if m.player.get("idle-active") else None
    assert m.current.title == "Кукушка"


def test_tool_not_connected_explains(monkeypatch, tmp_path):
    from coulson.memory import Memory
    from coulson.tools import Context, load_all

    monkeypatch.setattr("coulson.config.DATA_DIR", tmp_path)
    monkeypatch.setattr(Y, "_music", None)
    monkeypatch.setattr(Y, "load_token", lambda: None)
    ctx = Context(load(), memory=Memory(tmp_path / "m.db"))
    assert "подключи Яндекс Музыку" in load_all().execute("music", {"action": "like"}, ctx)


def test_media_keys_route_to_our_player(ym, monkeypatch, tmp_path):
    from coulson.memory import Memory
    from coulson.tools import Context, load_all

    m, mpv = ym
    m.play("Кино Группа крови")
    monkeypatch.setattr(Y, "_music", m)
    ctx = Context(load(), memory=Memory(tmp_path / "m.db"))
    assert load_all().execute("sound", {"action": "play_pause"}, ctx) == "Пауза"


def test_token_file_fallback(monkeypatch, tmp_path):
    monkeypatch.setattr("coulson.config.DATA_DIR", tmp_path)
    monkeypatch.setattr(Y.subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(FileNotFoundError()))
    Y.save_token("secret")
    assert Y.load_token() == "secret" and oct((tmp_path / "yandex_music_token").stat().st_mode)[-3:] == "600"
