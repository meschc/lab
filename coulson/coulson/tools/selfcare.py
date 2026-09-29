"""Самоанализ: Колсон разбирает журнал своих ошибок, выводит правила на будущее и может починить свой код
руками Claude Code (с тестами, откатом при провале и только после подтверждения пользователя)."""
from __future__ import annotations

import logging
import re
import subprocess
import threading
import time

from .. import config
from . import registry

log = logging.getLogger(__name__)

ANALYZE_PROMPT = """Это журнал твоих недавних ошибок и промахов (сбои инструментов, поправки пользователя, зависания):

{journal}

Проанализируй причины. Выведи до 5 кратких правил на будущее, каждое с новой строки, в виде «Когда …, …».
Правила должны быть конкретными и полезными (например: «Когда просят открыть игру, сначала ищи её через app find»).
Если причина — ошибка в программном коде ассистента, а не в твоём поведении, начни строку с «КОД:» и опиши баг.
Без нумерации, без вступления. Если выводов нет — ответь одним словом НЕТ. Инструменты не вызывай."""

FIX_PROMPT = """Ты работаешь в репозитории голосового ассистента «Колсон» (Python, папка coulson/). Он сам попросил
тебя исправить его ошибки. Журнал ошибок и хвост лога:

{report}

Задача: найди корневые причины и исправь их минимальными правками в коде. Правила:
- не меняй config.local.yaml и данные пользователя, не трогай git (коммит сделает Колсон);
- после правок обязательно запусти тесты: uv run --group dev pytest -q — и добейся, чтобы они проходили;
- если причина не в коде (сеть, разрешения macOS, модель) — ничего не меняй и объясни.
В конце: 1–2 предложения, что исправил (их озвучат), затем список изменённых файлов."""

FIX_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(uv run *)", "Bash(git status *)", "Bash(git diff *)",
             "Bash(git log *)", "Bash(tail *)", "Bash(ls *)"]


def journal_text(memory, limit: int = 30) -> tuple[str, list[int]]:
    rows = memory.incidents(limit=limit)
    lines = [f"- [{time.strftime('%d.%m %H:%M', time.localtime(ts))}, {kind}] {text}" for _, ts, kind, text in rows]
    return "\n".join(reversed(lines)), [r[0] for r in rows]


def analyze(memory, ask) -> str:
    """Разобрать журнал → правила (в память, попадают в промпт) и найденные баги кода (в журнал как code)."""
    journal, ids = journal_text(memory)
    if not ids:
        return "Журнал ошибок пуст — разбирать нечего."
    answer = ask(ANALYZE_PROMPT.format(journal=journal)) or ""
    lessons, bugs = [], []
    for line in answer.splitlines():
        line = re.sub(r"^\s*[-•*\d.)]+\s*", "", line).strip()
        if not line or line.upper().startswith("НЕТ"):
            continue
        if line.upper().startswith("КОД:"):
            bugs.append(line[4:].strip())
        elif len(line) > 10:
            lessons.append(line)
    for text in lessons:
        memory.add_lesson(text)
    memory.resolve_incidents(ids)
    for b in bugs:
        memory.add_incident("code", b)
    log.info("самоанализ: %d правил, %d багов кода из %d записей", len(lessons), len(bugs), len(ids))
    parts = [f"Разобрал {len(ids)} ошибок."]
    if lessons:
        parts.append(f"Новые правила: {'; '.join(lessons[:3])}.")
    if bugs:
        parts.append(f"Похоже на баги в коде ({len(bugs)}) — могу попросить Клода починить.")
    return " ".join(parts) if (lessons or bugs) else f"Разобрал {len(ids)} ошибок, новых выводов нет."


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=str(config.ROOT), capture_output=True, text=True, timeout=60)


def _tests() -> tuple[bool, str]:
    p = subprocess.run(["uv", "run", "--group", "dev", "pytest", "-q"], cwd=str(config.ROOT), capture_output=True,
                       text=True, timeout=600)
    tail = (p.stdout + p.stderr).strip().splitlines()[-3:]
    return p.returncode == 0, " ".join(tail)


def _fix_job(ctx) -> None:
    from .claude import headline, run_claude
    from .vpn import ensure_vpn

    ok, msg = ensure_vpn(ctx)
    if not ok:
        ctx.speak(f"Не могу починить себя: {msg}")
        return
    journal, ids = journal_text(ctx.memory, limit=40)
    if not ids:
        journal = "(журнал пуст — проверь лог на ошибки)"
    try:
        log_tail = "\n".join(config.LOG_FILE.read_text(encoding="utf-8", errors="ignore").splitlines()[-120:])
    except Exception:
        log_tail = "(лог недоступен)"
    report = f"Журнал:\n{journal}\n\nХвост лога ({config.LOG_FILE}):\n{log_tail}"
    res = run_claude(ctx, FIX_PROMPT.format(report=report), config.ROOT, allowed=FIX_TOOLS, timeout_min=40)
    changed = _git("status", "--porcelain", "--", ".").stdout.strip()
    if not res["ok"]:
        if changed:
            _git("stash", "push", "-u", "-m", f"coulson self-fix failed {time.strftime('%Y-%m-%d %H:%M')}", "--", ".")
        ctx.speak(f"Клод не смог меня починить: {headline(res['result'], 160)}")
        return
    if not changed:
        ctx.memory.resolve_incidents(ids)
        ctx.speak(f"Клод посмотрел: {headline(res['result'])} Код менять не пришлось.")
        return
    passed, summary = _tests()
    if not passed:
        _git("stash", "push", "-u", "-m", f"coulson self-fix tests failed {time.strftime('%Y-%m-%d %H:%M')}", "--", ".")
        ctx.memory.add_incident("code", f"Самопочинка откатена: тесты не прошли ({summary})")
        ctx.speak("Клод внёс правки, но тесты не прошли — я их откатил и сохранил в git stash.")
        return
    _git("add", "--", ".")
    # автор — сам Колсон: так видно, какие правки он сделал, и не нужна настройка git у пользователя
    _git("-c", "user.name=Колсон (самопочинка)", "-c", "user.email=coulson@localhost",
         "commit", "-m", f"self-fix: {headline(res['result'], 70)}\n\n{res['result'][:1500]}")
    ctx.memory.resolve_incidents(ids)
    ctx.memory.add_note(res["result"], title="Самопочинка", tags="claude,самопочинка")
    ctx.speak(f"Починил себя. {headline(res['result'])} Тесты прошли, перезапускаюсь.")
    time.sleep(1)
    ctx.restart()


def _fix_risk(ctx, action: str, text: str = "") -> str | None:
    return "дать Клоду изменить мой собственный код (с тестами и откатом при ошибке)" if action == "fix" else None


@registry.add("self", "Your own mistakes: analyze — review the error journal and derive rules for yourself; "
              "lessons — list your rules; forget_lesson — delete a rule (text); fix — ask Claude Code to fix bugs "
              "in your own code (tests + rollback). Use when the user is unhappy or says «разбери/почини себя».",
              {"action": ("string", ""), "text": ("string", "")}, ["action"],
              enums={"action": ["analyze", "lessons", "forget_lesson", "fix"]}, risk=_fix_risk)
def self_tool(ctx, action: str, text: str = "") -> str:
    m = ctx.memory
    if action == "lessons":
        rows = m.lessons()
        return "\n".join(f"- {t}" for _, t in rows) or "Правил пока нет."
    if action == "forget_lesson":
        return m.delete_lesson(text)
    if action == "analyze":
        if not ctx.ask_self:
            return "Ошибка: самоанализ недоступен без модели"
        return analyze(m, ctx.ask_self)
    dirty = _git("status", "--porcelain", "--", ".").stdout.strip()
    if dirty:
        return "Ошибка: в моём коде есть несохранённые изменения — сначала их нужно закоммитить или убрать"
    threading.Thread(target=_fix_job, args=(ctx,), daemon=True, name="self-fix").start()
    return "Передал Клоду журнал ошибок и логи. Он исправит код, я прогоню тесты и сообщу. Это займёт несколько минут."
