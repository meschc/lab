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


@registry.add("notes", "Coulson's own notes and tasks database. add: save a thought/idea/info (kind=task for to-dos); "
              "list: recent notes or open tasks; search: find notes by meaning; append: add text to note id; "
              "done: mark task id done; delete: remove note id.",
              {"action": ("string", ""), "text": ("string", "note text or search query"), "title": ("string", ""),
               "tags": ("string", "comma-separated"), "kind": ("string", ""), "id": ("integer", "")},
              ["action"], enums={"action": ["add", "list", "search", "append", "done", "delete"],
                                 "kind": ["note", "task"]},
              risk=_note_risk)
def notes(ctx, action: str, text: str = "", title: str = "", tags: str = "", kind: str = "", id: int | None = None) -> str:
    m = ctx.memory
    if action == "add":
        if not text.strip():
            return "Ошибка: нужен text"
        note_id = m.add_note(text, title=title, tags=tags, kind=kind or "note")
        return f"Записал ({'задача' if kind == 'task' else 'заметка'} {note_id})."
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
