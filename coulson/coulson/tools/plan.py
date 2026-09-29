"""План: сложную задачу Колсон разбивает на шаги и идёт по ним, отмечая выполненные."""
from __future__ import annotations

from . import registry


def _render(steps: list[dict]) -> str:
    return "\n".join(f"{i}. [{'x' if s['done'] else ' '}] {s['text']}" for i, s in enumerate(steps, 1))


@registry.add("plan", "For tasks needing 3+ actions: set = split into short concrete steps BEFORE acting; after "
              "finishing each step call done (step number). Returns what is next.",
              {"action": ("string", ""), "steps": {"type": "array", "items": {"type": "string"}},
               "step": ("integer", "number of the finished step")}, ["action"],
              enums={"action": ["set", "done", "show"]})
def plan(ctx, action: str, steps: list | None = None, step: int | None = None) -> str:
    if action == "set":
        items = [str(s).strip() for s in (steps or []) if str(s).strip()][:15]
        if not items:
            return "Ошибка: нужен список steps"
        ctx.plan = [{"text": s, "done": False} for s in items]
    elif action == "done":
        if not ctx.plan:
            return "Плана нет — сначала plan set"
        idx = (int(step) - 1) if step else next((i for i, s in enumerate(ctx.plan) if not s["done"]), None)
        if idx is None or not (0 <= idx < len(ctx.plan)):
            return f"Нет шага {step}. План:\n{_render(ctx.plan)}"
        ctx.plan[idx]["done"] = True
    elif not ctx.plan:
        return "Плана нет."
    left = [(i, s) for i, s in enumerate(ctx.plan, 1) if not s["done"]]
    total = len(ctx.plan)
    ctx.progress(f"шаг {total - len(left) + (1 if left else 0)} из {total}" if left else f"готово {total} из {total}")
    if not left:
        return f"Все шаги выполнены:\n{_render(ctx.plan)}\nКоротко отчитайся пользователю."
    n, nxt = left[0]
    return f"План:\n{_render(ctx.plan)}\nСейчас шаг {n}: {nxt['text']}"
