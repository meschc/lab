"""Инструмент movies: своя база фильмов (coulson/movies.py)."""
from __future__ import annotations

from . import registry


@registry.add("movies", "The user's own movie base (imported from Kinopoisk): suggest (what to watch; query = genre/mood; "
              "returns a NUMBERED list), info (ref = number from the last list or a title — details), "
              "mark (ref + status watched/want/skip and/or rating 1-10), list (status), import (path to a file).",
              {"action": ("string", ""), "query": ("string", "genre, mood, country…"),
               "ref": ("string", "number from the last list («2») or title"),
               "status": ("string", ""), "rating": ("number", "1-10"), "count": ("integer", "default 3"),
               "path": ("string", "file to import")}, ["action"],
              enums={"action": ["suggest", "info", "mark", "list", "import"], "status": ["want", "watched", "skip"]})
def movies(ctx, action: str, query: str = "", ref: str = "", status: str = "", rating: float | None = None,
           count: int = 3, path: str = "") -> str:
    from .. import movies as mv

    if action == "suggest":
        return mv.suggest(ctx.memory, query, max(1, min(int(count or 3), 10)))
    if action == "info":
        m = mv.resolve(ctx.memory, ref or query)
        if not m:
            return f"В базе нет «{ref or query}» — найди через web search"
        text = mv.describe(m)
        if not m.get("about"):  # описания нет в дампе — пара фраз из поиска
            try:
                from .web import web_search
                text += "\nИз поиска:\n" + web_search(ctx, f"{m['title']} {m.get('year') or ''} фильм сюжет", 3)[:1200]
            except Exception:
                pass
        return text
    if action == "mark":
        return mv.mark(ctx.memory, ref or query, status, rating)
    if action == "list":
        return mv.listing(ctx.memory, status or "want")
    if action == "import":
        return mv.import_file(ctx.memory, path or query)
    return "Ошибка: action — suggest, info, mark, list или import"
