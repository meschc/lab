"""Инструменты памяти."""
from __future__ import annotations

from . import registry


@registry.add("remember", "Save a durable fact about the user or their preferences to long-term memory "
              "(name, habits, favourite games, what 'моя игра' means, etc.). Write it as a short sentence in Russian.",
              {"fact": ("string", "The fact")}, ["fact"])
def remember(ctx, fact: str) -> str:
    return ctx.memory.add_fact(fact)


@registry.add("forget", "Remove a fact from long-term memory.",
              {"query": ("string", "What to forget")}, ["query"])
def forget(ctx, query: str) -> str:
    return ctx.memory.forget(query)


@registry.add("recall", "Search long-term memory and past conversations (what we talked about earlier).",
              {"query": ("string", "Keywords")}, ["query"])
def recall(ctx, query: str) -> str:
    return ctx.memory.recall(query)
