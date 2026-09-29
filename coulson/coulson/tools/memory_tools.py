"""Инструмент памяти."""
from __future__ import annotations

from . import registry


@registry.add("memory", "Long-term memory. remember: save a durable fact about the user (short Russian sentence); "
              "recall: search facts and past conversations; forget: delete a fact.",
              {"action": ("string", ""), "text": ("string", "Fact or search query")}, ["action", "text"],
              enums={"action": ["remember", "recall", "forget"]})
def memory(ctx, action: str, text: str) -> str:
    if action == "remember":
        return ctx.memory.add_fact(text)
    if action == "forget":
        return ctx.memory.forget(text)
    return ctx.memory.recall(text)
