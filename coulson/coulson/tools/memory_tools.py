"""Память, заметки и задачи — своя база Колсона (не Apple Notes)."""
from __future__ import annotations

from . import registry


@registry.add("memory", "Long-term memory. remember: save a durable fact about the user (short Russian sentence); "
              "recall: search BY MEANING in facts, notes and all past conversations ('что я говорил про…'); "
              "forget: delete a fact.",
              {"action": ("string", ""), "text": ("string", "Fact or search query")}, ["action", "text"],
              enums={"action": ["remember", "recall", "forget"]})
def memory(ctx, action: str, text: str) -> str:
    if action == "remember":
        return ctx.memory.add_fact(text)
    if action == "forget":
        return ctx.memory.forget(text)
    return ctx.memory.recall(text)


def _note_risk(ctx, action: str, text: str = "", id: int | None = None, **_) -> str | None:
    if action == "delete" and id is not None:
        note = ctx.memory.get_note(int(id))
        return f"удалить заметку «{(note.title or note.text)[:60]}»" if note else None
    return None


@registry.add("notes", "Coulson's own notes, tasks, events and birthdays. add: save a thought/idea (kind note), "
              "a to-do (task), a dated event (event + date) or someone's birthday (birthday + date; text = whose, "
              "e.g. «День рождения мамы»); Coulson will remind in advance. list: recent notes / open tasks / "
              "upcoming (kind event or birthday); search: by meaning; append: add text to id; done: task done; "
              "delete: remove id.",
              {"action": ("string", ""), "text": ("string", "note text or search query"), "title": ("string", ""),
               "tags": ("string", "comma-separated"), "kind": ("string", ""), "id": ("integer", ""),
               "date": ("string", "YYYY-MM-DD or DD.MM (birthday without year)")},
              ["action"], enums={"action": ["add", "list", "search", "append", "done", "delete"],
                                 "kind": ["note", "task", "event", "birthday"]},
              risk=_note_risk)
def notes(ctx, action: str, text: str = "", title: str = "", tags: str = "", kind: str = "", id: int | None = None,
          date: str = "") -> str:
    m = ctx.memory
    if action == "add":
        if not text.strip():
            return "Ошибка: нужен text"
        iso = ""
        if kind in ("event", "birthday"):
            from ..proactive import parse_date
            iso = parse_date(date, yearly=kind == "birthday")
            if not iso:
                return "Ошибка: для события/дня рождения нужна дата (YYYY-MM-DD или ДД.ММ)"
        note_id = m.add_note(text, title=title, tags=tags, kind=kind or "note", date=iso)
        label = {"task": "задача", "event": "событие", "birthday": "день рождения"}.get(kind, "заметка")
        return f"Записал ({label} {note_id}" + (f", {iso.replace('0000-', '')}" if iso else "") + ")."
    if action == "list" and kind in ("event", "birthday"):
        from ..proactive import upcoming
        items = upcoming(ctx, days=60)
        return "\n".join(f"{u.when_text()}: {u.title}" for u in items) or "Ближайших событий нет."
    if action == "list":
        hits = m.list_notes(kind=kind or None, open_only=(kind == "task"), tag=tags)
        return "\n".join(h.line() for h in hits) or "Пусто."
    if action == "search":
        hits = m.search(text or title or tags, kinds=("notes",), limit=8)
        return "\n".join(h.line() for h in hits) or "Ничего не нашёл в заметках."
    if id is None:
        return "Ошибка: нужен id заметки (узнай через list или search)"
    if action == "append":
        return "Дописал." if m.update_note(int(id), text=text, append=True) else f"Заметки {id} нет."
    if action == "done":
        return "Отметил выполненной." if m.update_note(int(id), done=True) else f"Задачи {id} нет."
    if action == "delete":
        return "Удалил." if m.delete_note(int(id)) else f"Заметки {id} нет."
    return f"Неизвестное действие {action}"
