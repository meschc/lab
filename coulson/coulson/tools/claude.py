"""Связка с Claude Code: Колсон передаёт ему сложные задачи (код, анализ, тексты, исследование).

Claude Code недоступен из России, поэтому перед каждым обращением ensure_vpn() гарантирует выход
через другую страну. Задача выполняется в фоне (`claude -p … --output-format json`), по готовности
Колсон озвучивает суть, а полный ответ сохраняет в заметки. Сессия продолжается через --resume.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from .. import config
from . import osascript, registry
from .vpn import ensure_vpn

log = logging.getLogger(__name__)

APPEND_PROMPT = ("Тебя вызывает голосовой ассистент Колсон по просьбе пользователя (он говорит по-русски). "
                 "Итог пиши на русском: первые 1–2 предложения — суть результата простыми словами (их озвучат "
                 "голосом), затем детали. Работай самостоятельно, вопросов не задавай — их некому передать.")


@dataclass
class Job:
    id: int
    task: str
    project: str
    status: str = "running"  # running | done | failed
    result: str = ""
    session_id: str | None = None
    started: float = field(default_factory=time.time)
    cost: float = 0.0


JOBS: dict[int, Job] = {}


def _state_file() -> Path:
    return config.DATA_DIR / "claude_session.json"


def last_session() -> str | None:
    try:
        return json.loads(_state_file().read_text()).get("session_id")
    except Exception:
        return None


def _save_session(session_id: str | None) -> None:
    if session_id:
        try:
            _state_file().write_text(json.dumps({"session_id": session_id}))
        except OSError:
            log.warning("не удалось сохранить сессию Claude")


def claude_bin(cfg) -> str | None:
    name = (cfg.get("claude") or {}).get("binary", "claude")
    found = shutil.which(name)
    if found:
        return found
    for p in ("~/.local/bin/claude", "~/.claude/local/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"):
        p = os.path.expanduser(p)
        if os.path.exists(p):
            return p
    return None


def resolve_project(ctx, project: str = "") -> Path:
    c = ctx.cfg.get("claude") or {}
    aliases = {k.lower(): v for k, v in (c.get("projects") or {}).items()}
    key = (project or "").strip().lower()
    target = aliases.get(key, project) if key else c.get("default_project", "~/Documents/Колсон")
    if target == "@self":
        return config.ROOT
    from .files import resolve
    path = resolve(ctx, target)
    path.mkdir(parents=True, exist_ok=True)
    return path


def run_claude(ctx, task: str, cwd: Path, resume: str | None = None, allowed: list[str] | None = None,
               extra_prompt: str = "", timeout_min: float | None = None) -> dict:
    """Синхронный вызов Claude Code. Возвращает {ok, result, session_id, cost}."""
    c = ctx.cfg.get("claude") or {}
    exe = claude_bin(ctx.cfg)
    if not exe:
        return {"ok": False, "result": "Claude Code не установлен (brew install --cask claude-code) или не найден"}
    cmd = [exe, "-p", task, "--output-format", "json", "--permission-mode", c.get("permission_mode", "acceptEdits"),
           "--max-turns", str(int(c.get("max_turns", 40))), "--append-system-prompt", APPEND_PROMPT + extra_prompt]
    tools = allowed if allowed is not None else list(c.get("allowed_tools") or [])
    if tools:
        cmd += ["--allowedTools", ",".join(tools)]
    if resume:
        cmd += ["--resume", resume]
    timeout = float(timeout_min or c.get("timeout_minutes", 30)) * 60
    log.info("Claude Code ← %s (в %s)", task[:200], cwd)
    try:
        p = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout,
                           stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return {"ok": False, "result": f"Claude не уложился в {timeout / 60:.0f} минут — остановил"}
    try:
        data = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        return {"ok": False, "result": (p.stdout or p.stderr or f"код выхода {p.returncode}").strip()[:2000]}
    ok = p.returncode == 0 and not data.get("is_error") and data.get("subtype", "success") == "success"
    return {"ok": ok, "result": (data.get("result") or "").strip(), "session_id": data.get("session_id"),
            "cost": float(data.get("total_cost_usd") or 0)}


def headline(text: str, limit: int = 280) -> str:
    """Первые 1–2 предложения — для озвучки."""
    import re
    parts = re.split(r"(?<=[.!?])\s+", text.strip().replace("\n", " "))
    out = ""
    for s in parts[:2]:
        if len(out) + len(s) > limit:
            break
        out += (" " if out else "") + s
    return out or text[:limit]


def _run_job(ctx, job: Job, resume: str | None) -> None:
    res = run_claude(ctx, job.task, Path(job.project), resume=resume)
    job.status = "done" if res["ok"] else "failed"
    job.result, job.session_id, job.cost = res["result"], res.get("session_id"), res.get("cost", 0.0)
    _save_session(job.session_id)
    try:
        ctx.memory.add_note(job.result or "(пусто)", title=f"Claude: {job.task[:60]}", tags="claude")
    except Exception:
        log.exception("не удалось сохранить ответ Claude в заметки")
    if res["ok"]:
        ctx.speak(f"Клод закончил. {headline(job.result)}")
    else:
        ctx.memory.add_incident("tool", f"Claude Code не справился с «{job.task[:200]}»: {job.result[:300]}")
        ctx.speak(f"У Клода не получилось: {headline(job.result, 160)}")
    ctx.notify(f"Claude: {headline(job.result, 200)}")


def _start(ctx, task: str, project: str, resume: str | None) -> str:
    ok, msg = ensure_vpn(ctx)
    if not ok:
        return f"Ошибка: не могу связаться с Клодом — {msg}"
    cwd = resolve_project(ctx, project)
    job = Job(len(JOBS) + 1, task, str(cwd))
    JOBS[job.id] = job
    threading.Thread(target=_run_job, args=(ctx, job, resume), daemon=True, name=f"claude-{job.id}").start()
    return f"{msg}. Передал задачу Клоду (№{job.id}, папка {cwd.name}) — скажу, когда закончит."


def open_terminal(ctx, project: str = "") -> str:
    ok, msg = ensure_vpn(ctx)
    if not ok:
        return f"Ошибка: {msg}"
    exe = claude_bin(ctx.cfg)
    if not exe:
        return "Ошибка: Claude Code не установлен (brew install --cask claude-code)"
    cwd = resolve_project(ctx, project)
    term = (ctx.cfg.get("claude") or {}).get("terminal", "Terminal")
    cmd = f"cd {json.dumps(str(cwd))} && {json.dumps(exe)}"
    res = osascript(f'tell application "{term}"\nactivate\ndo script {json.dumps(cmd)}\nend tell')
    return f"{msg}. Открыл Claude Code в папке {cwd.name}" if res in ("OK", "") or res.startswith("tab") else res


@registry.add("claude", "Claude Code — much smarter than you. ask: hand over a hard task (coding, fixing code, "
              "deep analysis, long texts, research) — runs in background, result is spoken and saved to notes; "
              "continue: follow-up in the same Claude session; open: open Claude Code in Terminal for the user; "
              "status: running tasks. VPN is ensured automatically.",
              {"action": ("string", ""), "task": ("string", "full task description"),
               "project": ("string", "folder or project name; default ~/Documents/Колсон")}, ["action"],
              enums={"action": ["ask", "continue", "open", "status"]})
def claude(ctx, action: str, task: str = "", project: str = "") -> str:
    if action == "open":
        return open_terminal(ctx, project)
    if action == "status":
        if not JOBS:
            return "Клоду ничего не передавал."
        return "\n".join(f"№{j.id} [{j.status}] {j.task[:80]}" + (f" → {headline(j.result, 150)}" if j.result else "")
                         for j in list(JOBS.values())[-5:])
    if not task.strip():
        return "Ошибка: нужно task — что именно сделать"
    return _start(ctx, task, project, last_session() if action == "continue" else None)
