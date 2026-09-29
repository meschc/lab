"""Реестр инструментов, которые LLM может вызывать."""
from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger(__name__)

MAX_RESULT = 6000


@dataclass
class Tool:
    name: str
    description: str
    params: dict[str, tuple[str, str] | dict]  # имя -> (json-тип, описание) или готовая JSON-схема
    required: list[str]
    func: Callable[..., Any]
    risk: Callable[..., str | None] | None = None  # risk(ctx, **args) -> описание, если нужно подтверждение
    enums: dict[str, list[str]] = field(default_factory=dict)

    def schema(self) -> dict:
        props = {}
        for pname, spec in self.params.items():
            if isinstance(spec, dict):
                props[pname] = dict(spec)
            else:
                props[pname] = {"type": spec[0], **({"description": spec[1]} if spec[1] else {})}
            if pname in self.enums:
                props[pname]["enum"] = self.enums[pname]
        return {"type": "function", "function": {
            "name": self.name, "description": self.description,
            "parameters": {"type": "object", "properties": props, "required": self.required}}}


class Context:
    """То, что доступно инструментам: настройки, память, голос, зрение, подтверждение."""

    def __init__(self, cfg, memory=None, speak=None, confirm=None, vision=None, notify=None, attach_image=None):
        self.cfg = cfg
        self.memory = memory
        self.speak = speak or (lambda text: None)
        self.confirm = confirm or (lambda desc: False)
        self.vision = vision              # callable(question, image_path) -> str (отдельный запрос)
        self.attach_image = attach_image  # callable(path): приложить картинку к текущему диалогу
        self.notify = notify or (lambda text: None)
        self.game_launched = False        # open_app запустил игру → после ответа выгрузить модель


class Registry:
    def __init__(self):
        self.tools: dict[str, Tool] = {}

    def add(self, name: str, description: str, params: dict | None = None, required: list[str] | None = None,
            risk: Callable | None = None, enums: dict | None = None):
        def deco(func):
            self.tools[name] = Tool(name, description, params or {}, required or [], func, risk, enums or {})
            return func
        return deco

    def schemas(self) -> list[dict]:
        return [t.schema() for t in self.tools.values()]

    def execute(self, name: str, args: Any, ctx: Context) -> str:
        tool = self.tools.get(name)
        if tool is None:
            return f"Ошибка: инструмента {name} нет. Доступны: {', '.join(self.tools)}"
        if isinstance(args, str):
            try:
                args = json.loads(args) if args.strip() else {}
            except json.JSONDecodeError:
                return "Ошибка: аргументы должны быть JSON-объектом"
        args = {k: _coerce(v, tool.params[k]) for k, v in (args or {}).items() if k in tool.params}
        missing = [p for p in tool.required if p not in args]
        if missing:
            return f"Ошибка: не хватает параметров {missing}"
        try:
            if tool.risk and ctx.cfg.safety.confirm_risky:
                reason = tool.risk(ctx, **args)
                if reason and not ctx.confirm(reason):
                    return "Пользователь НЕ подтвердил действие. Не выполняй его и не пытайся обойти."
            result = tool.func(ctx, **args)
        except subprocess.TimeoutExpired:
            return "Ошибка: команда выполнялась слишком долго и была остановлена"
        except Exception as e:
            log.exception("tool %s failed", name)
            return f"Ошибка: {type(e).__name__}: {e}"
        text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
        return text if len(text) <= MAX_RESULT else text[:MAX_RESULT] + "\n…(обрезано)"


def _coerce(value: Any, spec) -> Any:
    """Модель иногда присылает "false", "40", "2.5" строками — приводим к типу из схемы."""
    kind = spec.get("type") if isinstance(spec, dict) else spec[0]
    if isinstance(value, str):
        v = value.strip()
        if kind == "boolean":
            return v.lower() not in ("false", "0", "no", "нет", "off", "")
        if kind in ("integer", "number"):
            try:
                num = float(v.replace(",", "."))
                return int(num) if kind == "integer" else num
            except ValueError:
                return value
    if kind == "integer" and isinstance(value, float):
        return int(value)
    return value


registry = Registry()


def run(cmd: list[str] | str, timeout: float = 30, shell: bool = False) -> str:
    """Запуск процесса с возвратом stdout+stderr одной строкой."""
    p = subprocess.run(cmd, shell=shell, capture_output=True, text=True, timeout=timeout,
                       executable="/bin/zsh" if shell else None)
    out = (p.stdout or "") + (("\n" + p.stderr) if p.stderr.strip() else "")
    out = out.strip()
    if p.returncode != 0:
        return f"[код {p.returncode}] {out}".strip()
    return out or "OK"


def osascript(script: str, timeout: float = 20) -> str:
    return run(["osascript", "-e", script], timeout=timeout)


def load_all() -> Registry:
    from . import apps, files, memory_tools, system, vision, web  # noqa: F401  регистрация через декораторы
    return registry
