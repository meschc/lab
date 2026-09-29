"""MCP-сервер «Яндекс Музыка» — тот же модуль, что у Колсона, но для Claude Code / Claude Desktop.

Запуск (stdio): python -m coulson.mcp_music. Регистрация в Claude Code делается в setup.sh:
  claude mcp add yandex-music -s user -- <путь к .venv/bin/python> -m coulson.mcp_music
Использует тот же токен (Связка ключей) и тот же плеер mpv, что и Колсон.
"""
from __future__ import annotations

from . import config, yamusic

try:  # MCP SDK 2.x
    from mcp.server.mcpserver import MCPServer as _Server
except ImportError:  # MCP SDK 1.x
    from mcp.server.fastmcp import FastMCP as _Server

server = _Server("yandex-music", instructions="Управление Яндекс Музыкой пользователя: поиск, воспроизведение, "
                                              "«Моя волна», лайки. Играет локальный плеер на Маке.")
_music: yamusic.YaMusic | None = None


def _m() -> yamusic.YaMusic:
    global _music
    if _music is None:
        _music = yamusic.YaMusic(config.load())
    return _music


def _safe(fn, *args) -> str:
    try:
        return fn(*args)
    except PermissionError:
        return "Яндекс Музыка не подключена: скажите Колсону «подключи Яндекс Музыку» (вход по коду)."
    except Exception as e:  # noqa: BLE001 — отдаём текст ошибки модели
        return f"Ошибка: {e}"


@server.tool()
def search(query: str) -> str:
    """Найти в Яндекс Музыке трек, исполнителя или альбом (без воспроизведения)."""
    def run():
        what, items = _m().find(query)
        return f"{what}:\n" + "\n".join(i.name for i in items[:10]) if items else "Ничего не найдено"
    return _safe(run)


@server.tool()
def play(query: str) -> str:
    """Включить трек, исполнителя или альбом по названию."""
    return _safe(_m().play, query)


@server.tool()
def my_wave() -> str:
    """Включить персональную «Мою волну»."""
    return _safe(_m().my_wave)


@server.tool()
def liked() -> str:
    """Включить треки из «Мне нравится» вперемешку."""
    return _safe(_m().liked)


@server.tool()
def pause() -> str:
    """Пауза."""
    return _safe(_m().pause, True)


@server.tool()
def resume() -> str:
    """Продолжить воспроизведение."""
    return _safe(_m().pause, False)


@server.tool()
def next_track() -> str:
    """Следующий трек."""
    return _safe(_m().next)


@server.tool()
def previous_track() -> str:
    """Предыдущий трек."""
    return _safe(_m().previous)


@server.tool()
def now_playing() -> str:
    """Что сейчас играет."""
    return _safe(_m().now_playing)


@server.tool()
def like() -> str:
    """Добавить текущий трек в «Мне нравится»."""
    return _safe(_m().like)


@server.tool()
def dislike() -> str:
    """Дизлайк текущему треку и перейти к следующему."""
    return _safe(_m().like, True)


@server.tool()
def volume(level: int) -> str:
    """Громкость музыки 0–100."""
    return _safe(_m().volume, level)


if __name__ == "__main__":
    server.run()
