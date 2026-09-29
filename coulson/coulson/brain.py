"""Мозг: локальная LLM (Ollama) с вызовом инструментов, потоковой речью и памятью."""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from typing import Callable

from .textutil import pop_sentences
from .tools import Context, Registry

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """Ты — {name}, личный ИИ-ассистент в духе Джарвиса. Ты живёшь на Маке пользователя и управляешь им по голосовым командам.
Характер: британская выдержка — спокойный, собранный, с лёгкой иронией, говоришь по делу.
Никогда не используй обращения «сэр», «господин», «хозяин», «sir» — обращайся к пользователю просто на «вы», без титулов.

Твои ответы ОЗВУЧИВАЮТСЯ:
- Говори коротко: обычно 1–2 предложения. Подробнее — только если просят рассказать или объяснить.
- Никакого markdown, списков, эмодзи и ссылок.
- Отвечай на языке пользователя (русский или английский).
- В русской речи названия пиши кириллицей так, как они произносятся (Стим, Ютуб, Телеграм, Дискорд).
- Никогда не произноси своё имя.

Как действовать:
- Если просьбу можно выполнить инструментом — сразу вызывай его, не спрашивая разрешения. Многошаговые задачи выполняй по шагам.
- После действия кратко подтверди результат («Готово, Стим запущен.») и, если это уместно, одной фразой предложи логичный следующий шаг.
- Если команда неясна — задай один короткий уточняющий вопрос.
- Факты о мире, новости, цены, погода — только через web_search / read_webpage / weather, не выдумывай.
- Вопросы про то, что на экране, — через look_at_screen. «Посмотри на меня» — look_at_camera.
- Если пользователь рассказывает о себе что-то долговременное (предпочтения, привычки, имена, любимые игры) — вызови remember.
- Файлы создаёшь сам: таблицы — create_table (Excel, можно с диаграммой), страницы, документы и код — write_file
  с ПОЛНЫМ содержимым (HTML — сразу красивый и цельный, со стилями внутри). Данные для таблицы сначала собери
  инструментами (disk_usage, web_search, system_status…), не выдумывай. После создания коротко скажи, где лежит файл.
- Опасные действия система подтверждает у пользователя сама: просто вызывай инструмент.
- Речь распознаётся автоматически и может содержать ошибки — угадывай смысл по контексту.

Сейчас {now}. Компьютер: MacBook Pro M1 Pro, macOS. Браузер пользователя — Яндекс Браузер.
{facts}"""

VISION_PROMPT = ("Ты смотришь на изображение по просьбе голосового ассистента. Ответь кратко и по делу, на русском. "
                 "Если на изображении есть важный текст — процитируй его. Вопрос: {question}")

_TOOL_TEXT_MARKERS = ("<tool_call", "<function=", '{"name"')


def parse_text_tool_calls(text: str) -> list[dict]:
    """Запасной разбор, если модель напечатала вызов инструмента текстом (XML Qwen или JSON Hermes)."""
    calls = []
    for m in re.finditer(r"<function=([\w.-]+)>(.*?)</function>", text, re.S):
        args = {p.group(1): p.group(2).strip() for p in re.finditer(r"<parameter=([\w.-]+)>(.*?)</parameter>", m.group(2), re.S)}
        for k, v in args.items():
            try:
                args[k] = json.loads(v)
            except (json.JSONDecodeError, ValueError):
                pass
        calls.append({"name": m.group(1), "arguments": args})
    if calls:
        return calls
    for m in re.finditer(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", text, re.S):
        try:
            d = json.loads(m.group(1))
            calls.append({"name": d["name"], "arguments": d.get("arguments") or d.get("parameters") or {}})
        except (json.JSONDecodeError, KeyError):
            continue
    if not calls:
        m = re.fullmatch(r"\s*(\{\s*\"name\".*\})\s*", text, re.S)
        if m:
            try:
                d = json.loads(m.group(1))
                calls.append({"name": d["name"], "arguments": d.get("arguments") or {}})
            except (json.JSONDecodeError, KeyError):
                pass
    return calls


class Brain:
    def __init__(self, cfg, tools: Registry, memory):
        import ollama

        self.cfg = cfg
        self.llm = cfg.llm
        self.tools = tools
        self.memory = memory
        self.client = ollama.Client(host=self.llm.host)
        self.history: list[dict] = []
        self.last_active = 0.0
        self._lock = threading.Lock()

    # ------------------------------------------------------------ служебное
    def warmup(self) -> None:
        self.client.chat(model=self.llm.model, messages=[{"role": "user", "content": "привет"}],
                         think=self.llm.think, keep_alive=self.llm.keep_alive, options={"num_predict": 1})
        log.info("LLM загружена: %s", self.llm.model)

    def _system(self) -> dict:
        facts = self.memory.facts(int(self.cfg.get("memory", {}).get("max_facts", 40)))
        facts_text = ("Что ты знаешь о пользователе:\n" + "\n".join(f"- {t}" for _, t in facts)) if facts else ""
        now = time.strftime("%A, %d.%m.%Y, %H:%M")
        a = self.cfg.assistant
        return {"role": "system", "content": SYSTEM_PROMPT.format(name=a.name, now=now,
                                                                  facts=facts_text)}

    def _options(self) -> dict:
        return {"num_ctx": int(self.llm.num_ctx), "temperature": float(self.llm.temperature)}

    def vision(self, question: str, image_path: str) -> str:
        model = self.llm.vision_model or self.llm.model
        r = self.client.chat(model=model, think=False, keep_alive=self.llm.keep_alive, options=self._options(),
                             messages=[{"role": "user", "content": VISION_PROMPT.format(question=question),
                                        "images": [image_path]}])
        return r.message.content.strip() or "Ничего не разобрал на изображении."

    def reset_if_idle(self) -> None:
        idle = float(self.cfg.assistant.session_idle_minutes) * 60
        if self.history and time.time() - self.last_active > idle:
            self.history.clear()

    # ------------------------------------------------------------ основной цикл
    def respond(self, user_text: str, ctx: Context, on_sentence: Callable[[str], None],
                cancel: threading.Event | None = None, on_tool: Callable[[str], None] | None = None) -> str:
        with self._lock:
            self.reset_if_idle()
            self.last_active = time.time()
            self.memory.log("user", user_text)
            max_hist = int(self.llm.history_turns) * 2
            messages = [self._system()] + self.history[-max_hist:] + [{"role": "user", "content": user_text}]
            schemas = self.tools.schemas()
            spoken_all: list[str] = []
            final = ""

            for _round in range(int(self.llm.max_tool_rounds)):
                if cancel is not None and cancel.is_set():
                    break
                content, tool_calls = self._stream(messages, schemas, on_sentence, spoken_all, cancel)
                if cancel is not None and cancel.is_set():
                    final = content
                    break
                if not tool_calls:
                    tool_calls = parse_text_tool_calls(content)
                    if tool_calls:
                        content = re.split(r"<tool_call|<function=|\{\s*\"name\"", content)[0].strip()
                if not tool_calls:
                    final = content
                    break
                messages.append({"role": "assistant", "content": content,
                                 "tool_calls": [{"function": {"name": c["name"], "arguments": c["arguments"]}}
                                                for c in tool_calls]})
                for call in tool_calls:
                    log.info("→ %s(%s)", call["name"], json.dumps(call["arguments"], ensure_ascii=False)[:300])
                    if on_tool:
                        on_tool(call["name"])
                    result = self.tools.execute(call["name"], call["arguments"], ctx)
                    log.info("← %s", result[:300].replace("\n", " "))
                    messages.append({"role": "tool", "tool_name": call["name"], "content": result})
                    if cancel is not None and cancel.is_set():
                        break
            else:
                final = final or "Слишком много шагов, я остановился."
                on_sentence(final)

            final = final.strip()
            self.history += [{"role": "user", "content": user_text},
                             {"role": "assistant", "content": final or " ".join(spoken_all) or "Готово."}]
            self.memory.log("assistant", final or " ".join(spoken_all))
            self.last_active = time.time()
            return final

    def _stream(self, messages, schemas, on_sentence, spoken_all, cancel) -> tuple[str, list[dict]]:
        content, buf = "", ""
        tool_calls: list[dict] = []
        muted = False  # модель начала печатать вызов инструмента текстом — это не озвучиваем
        stream = self.client.chat(model=self.llm.model, messages=messages, tools=schemas, stream=True,
                                  think=self.llm.think, keep_alive=self.llm.keep_alive, options=self._options())
        for chunk in stream:
            if cancel is not None and cancel.is_set():
                break
            msg = chunk.message
            for tc in msg.tool_calls or []:
                args = tc.function.arguments
                tool_calls.append({"name": tc.function.name, "arguments": dict(args) if args else {}})
            piece = msg.content or ""
            if not piece:
                continue
            content += piece
            if muted:
                continue
            if any(mk in content for mk in _TOOL_TEXT_MARKERS):
                muted = True
                buf = re.split(r"<tool_call|<function=|\{\s*\"name\"", buf + piece)[0]
                if buf.strip():
                    on_sentence(buf.strip())
                    spoken_all.append(buf.strip())
                buf = ""
                continue
            buf += piece
            sentences, buf = pop_sentences(buf)
            for s in sentences:
                on_sentence(s)
                spoken_all.append(s)
        if buf.strip() and not muted and not (cancel is not None and cancel.is_set()):
            on_sentence(buf.strip())
            spoken_all.append(buf.strip())
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()
        return content, tool_calls
