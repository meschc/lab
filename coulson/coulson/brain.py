"""Мозг: локальная LLM (Ollama) с вызовом инструментов, потоковой речью и памятью.

Скорость на M1 Pro держится на кэше префикса Ollama: системный промпт + описания инструментов
(~3.5 тыс. токенов) обрабатываются один раз (~15 с), дальше — только новые реплики (~1 с).
Поэтому всё, что меняется (время, картинки), идёт в КОНЕЦ диалога, а начало остаётся неизменным.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from pathlib import Path
from typing import Callable

from .textutil import mood_of, pop_sentences
from .tools import Context, Registry

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """Ты — {name}, личный голосовой ИИ-ассистент в духе Джарвиса и «второй мозг» пользователя. Ты живёшь на его Маке (MacBook Pro M1 Pro, macOS, браузер — Яндекс Браузер) и управляешь им по голосу.
Характер: спокойный, собранный, с лёгкой иронией, по делу. Обращайся на «вы» и без титулов: никогда не говори «сэр», «господин», «sir».

Ответы озвучиваются:
- Коротко: 1–2 предложения. Подробнее — только если просят рассказать или объяснить.
- Без markdown, списков, эмодзи и ссылок.
- На языке пользователя (русский или английский). Названия — кириллицей, как произносятся (Стим, Ютуб, Телеграм).
- Своё имя не произноси.
- Каждый ответ начинай меткой настроения (её не озвучивают): [ok] — всё нормально; [warn] — предупреждение, риск, неприятная новость или что-то не вышло; [bad] — ошибка, серьёзная проблема, плохая новость или пользователь расстроен.

Как действовать:
- Если можно сделать инструментом — делай сразу, без лишних вопросов.
- Сложная задача (3 и больше действий) — сначала plan set: короткие конкретные шаги; затем выполняй по одному и после каждого plan done. Шаг не удался — попробуй другой способ, а если никак — скажи, что мешает.
- После действия кратко подтверди результат и, если уместно, одной фразой предложи следующий шаг.
- Если команда неясна — задай один короткий уточняющий вопрос.
- Факты, новости, цены, погода — только через web_search / read_webpage / weather, не выдумывай.
- Что на экране — look (screen); «посмотри на меня» — look (camera).
- Мышь: click — нажать элемент по описанию («кнопка Войти»); mouse — прокрутка, перетаскивание. Для полей ввода: click по полю, затем type_text.
- Узнал о пользователе что-то долговременное — memory remember. Вопросы о прошлом («что я говорил/думал про…») — memory recall: он ищет по смыслу в заметках, фактах и всех разговорах.
- Просят записать мысль, идею, информацию — notes add; дело на потом — notes add с kind task. «Что у меня в заметках/задачах» — notes list или search.
- Файлы: таблицы — create_table (можно с диаграммой); страницы, документы, код — write_file с полным содержимым (HTML сразу красивый, стили внутри). Данные сначала собери инструментами. Потом скажи, где файл.
- Опасные действия система подтверждает у пользователя сама: просто вызывай инструмент.
- Речь распознаётся автоматически и может содержать ошибки — угадывай смысл по контексту."""

LOCATE_PROMPT = ("Найди на этом снимке экрана элемент интерфейса: «{target}». Ответь ТОЛЬКО JSON "
                 '{{"bbox_2d": [x1, y1, x2, y2], "label": "что это"}} в относительных координатах 0–1000. '
                 'Если такого элемента нет — {{"bbox_2d": null}}. Инструменты не вызывай.')

VISION_PROMPT = ("Ты смотришь на изображение по просьбе голосового ассистента. Ответь кратко и по делу, на русском. "
                 "Если на изображении есть важный текст — процитируй его. Вопрос: {question}")

_TOOL_TEXT_MARKERS = ("<tool_call", "<function=", '{"name"')
_MOOD_RE = re.compile(r"\[(ok|warn|bad)\]\s*", re.I)
MOOD_LEVEL = {"ok": 0.0, "warn": 0.5, "bad": 1.0}
_WEEKDAYS = ("понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье")


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


def now_context() -> str:
    t = time.localtime()
    return f"(сейчас {time.strftime('%H:%M', t)}, {_WEEKDAYS[t.tm_wday]}, {time.strftime('%d.%m.%Y', t)})"


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
        self._images: list[str] = []
        self._live: list[dict] | None = None  # сообщения текущего ответа (для locate с тем же началом)
        self._session_start = time.time()      # записи журнала новее — уже есть в истории диалога

    # ------------------------------------------------------------ служебное
    def _kwargs(self) -> dict:
        kw = {"keep_alive": self.llm.keep_alive,
              "options": {"num_ctx": int(self.llm.num_ctx), "temperature": float(self.llm.temperature)}}
        if self.llm.get("think") is not None:
            kw["think"] = bool(self.llm.think)
        return kw

    def _prefix(self) -> list[dict]:
        """Неизменная часть диалога — её Ollama держит в кэше."""
        a = self.cfg.assistant
        msgs = [{"role": "system", "content": SYSTEM_PROMPT.format(name=a.name)}]
        facts = self.memory.facts(int(self.cfg.get("memory", {}).get("max_facts", 40)))
        if facts:
            # Парой реплик ПОСЛЕ системного промпта с инструментами (в любом шаблоне модели они идут дальше):
            # новый факт не сбрасывает кэш тяжёлой части промпта
            msgs += [{"role": "user", "content": "Что ты знаешь обо мне (память):\n" +
                      "\n".join(f"- {t}" for _, t in reversed(facts))},
                     {"role": "assistant", "content": "[ok] Помню и учитываю."}]
        return msgs

    def warmup(self) -> None:
        """Загрузить модель и заранее просчитать системный промпт с инструментами."""
        t = time.monotonic()
        kw = self._kwargs()
        kw["options"]["num_predict"] = 1
        self.client.chat(model=self.llm.model, messages=self._prefix() + [{"role": "user", "content": "привет"}],
                         tools=self.tools.schemas(), **kw)
        log.info("LLM готова: %s (прогрев %.1f с)", self.llm.model, time.monotonic() - t)

    def unload(self) -> None:
        """Выгрузить модель из памяти (например, чтобы отдать память игре)."""
        try:
            self.client.generate(model=self.llm.model, prompt="", keep_alive=0)
            log.info("LLM выгружена из памяти")
        except Exception as e:
            log.warning("Не удалось выгрузить модель: %s", e)

    def attach_image(self, path: str) -> None:
        self._images.append(path)

    def locate(self, target: str, image_path: str, size: tuple[int, int] | None = None) -> tuple[float, float] | None:
        """Найти элемент на снимке экрана (grounding Qwen3-VL) → точка в 0–1000.

        Запрос повторяет начало текущего диалога (системный промпт, инструменты, историю), поэтому Ollama
        берёт его из кэша и не «забывает» основной разговор — дописывается только снимок с вопросом.
        """
        from .tools.mouse import parse_point

        separate = bool(self.llm.vision_model and self.llm.vision_model != self.llm.model)
        ask = {"role": "user", "content": LOCATE_PROMPT.format(target=target), "images": [image_path]}
        kw = self._kwargs()
        kw["options"]["temperature"] = 0.0
        if separate:
            r = self.client.chat(model=self.llm.vision_model, messages=[ask], **kw)
        else:
            base = list(self._live) if self._live else self._prefix()
            r = self.client.chat(model=self.llm.model, messages=base + [ask], tools=self.tools.schemas(), **kw)
            if not (r.message.content or "").strip():  # модель попыталась вызвать инструмент — спросим без них
                r = self.client.chat(model=self.llm.model, messages=[ask], **kw)
        text = r.message.content or ""
        log.info("locate «%s» → %s", target, text.strip()[:200])
        return parse_point(text, size)

    def vision(self, question: str, image_path: str) -> str:
        """Отдельный запрос с картинкой — только если зрение вынесено в другую модель."""
        model = self.llm.vision_model or self.llm.model
        r = self.client.chat(model=model, messages=[{"role": "user", "content": VISION_PROMPT.format(question=question),
                                                     "images": [image_path]}], **self._kwargs())
        return r.message.content.strip() or "Ничего не разобрал на изображении."

    def reset_if_idle(self) -> None:
        idle = float(self.cfg.assistant.session_idle_minutes) * 60
        if self.history and time.time() - self.last_active > idle:
            self.history.clear()
        if not self.history:
            self._session_start = time.time()

    def _recall_block(self, user_text: str) -> str:
        """Связанные воспоминания к команде — в конец сообщения (начало промпта не трогаем, кэш живёт)."""
        m = self.cfg.get("memory", {}) or {}
        if not m.get("auto_recall", True) or len(user_text) < 6:
            return ""
        try:
            hits = self.memory.relevant(user_text, k=int(m.get("recall_top_k", 3)),
                                        min_sim=float(m.get("recall_min_similarity", 0.55)),
                                        exclude_after=self._session_start)
        except Exception as e:
            log.warning("автопоиск в памяти не удался: %s", e)
            return ""
        if not hits:
            return ""
        return ("\n\n(Система: возможно, связанные записи из памяти — используй, только если относятся к делу)\n"
                + "\n".join(f"- {h.line()}" for h in hits))

    def _trim_history(self) -> None:
        # Режем пачками, а не по одному сообщению: начало диалога реже меняется → кэш живёт дольше
        keep = int(self.llm.history_turns) * 2
        if len(self.history) > keep + 8:
            self.history = self.history[-keep:]

    # ------------------------------------------------------------ основной цикл
    def respond(self, user_text: str, ctx: Context, on_sentence: Callable[[str], None],
                cancel: threading.Event | None = None, on_tool: Callable[[str], None] | None = None,
                on_mood: Callable[[float], None] | None = None) -> str:
        with self._lock:
            self.reset_if_idle()
            self._trim_history()
            recall = self._recall_block(user_text)
            self.last_active = time.time()
            self.memory.log("user", user_text)
            ctx.plan = []
            nudged = False
            separate_vision = bool(self.llm.vision_model and self.llm.vision_model != self.llm.model)
            ctx.attach_image = None if separate_vision else self.attach_image
            ctx.locate = self.locate
            if separate_vision:
                ctx.vision = self.vision
            messages = self._prefix() + self.history + [
                {"role": "user", "content": f"{now_context()} {user_text}{recall}"}]
            self._live = messages
            schemas = self.tools.schemas()
            spoken_all: list[str] = []
            moods: list[float] = []
            trouble = [0.0]  # проблемы, замеченные по результатам инструментов
            final = ""
            used_images: list[str] = []

            def mood(level: float) -> None:
                moods.append(level)
                if on_mood:
                    on_mood(max(level, trouble[0]))

            try:
                for _round in range(int(self.llm.max_tool_rounds)):
                    if cancel is not None and cancel.is_set():
                        break
                    content, tool_calls = self._stream(messages, schemas, on_sentence, spoken_all, cancel, mood)
                    if cancel is not None and cancel.is_set():
                        final = content
                        break
                    if not tool_calls:
                        tool_calls = parse_text_tool_calls(content)
                        if tool_calls:
                            content = re.split(r"<tool_call|<function=|\{\s*\"name\"", content)[0].strip()
                    if not tool_calls:
                        left = [s["text"] for s in ctx.plan if not s["done"]]
                        if left and not nudged and "?" not in content:
                            # остановился посреди плана — один раз напоминаем довести дело до конца
                            nudged = True
                            messages += [{"role": "assistant", "content": content},
                                         {"role": "user", "content": "(Система: в плане остались шаги: "
                                          + "; ".join(left) + ". Выполни их инструментами или честно скажи, "
                                          "что мешает.)"}]
                            continue
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
                        if re.match(r"(Ошибка|\[код [1-9]|Не удалось|Не нашёл|Пользователь НЕ подтвердил)", result):
                            trouble[0] = max(trouble[0], MOOD_LEVEL["warn"])
                            if on_mood:
                                on_mood(trouble[0])
                        messages.append({"role": "tool", "tool_name": call["name"], "content": result})
                        if cancel is not None and cancel.is_set():
                            break
                    if self._images:
                        messages.append({"role": "user", "content": "Изображение от инструмента look:",
                                         "images": list(self._images)})
                        used_images += self._images
                        self._images.clear()
                else:
                    final = final or "[warn] Слишком много шагов, я остановился."
                    on_sentence(_MOOD_RE.sub("", final))
            finally:
                self._live = None
                for p in used_images + self._images:  # и те снимки, что не успели попасть в диалог
                    Path(p).unlink(missing_ok=True)
                self._images.clear()

            final = final.strip()
            clean = _MOOD_RE.sub("", final).strip()
            said = clean or " ".join(spoken_all)
            if not moods and on_mood:  # модель забыла метку — оцениваем по словам
                on_mood(max(mood_of(said), trouble[0]))
            m = _MOOD_RE.match(final)
            tag = f"[{m.group(1).lower()}]" if m else "[ok]"
            # В истории оставляем метку: так модель не забывает её ставить в следующих ответах
            self.history += [{"role": "user", "content": user_text},
                             {"role": "assistant", "content": f"{tag} {said or 'Готово.'}"}]
            self.memory.log("assistant", said)
            self.last_active = time.time()
            return clean

    def _stream(self, messages, schemas, on_sentence, spoken_all, cancel, on_mood) -> tuple[str, list[dict]]:
        content, buf = "", ""
        tool_calls: list[dict] = []
        muted = False  # модель начала печатать вызов инструмента текстом — это не озвучиваем

        def emit(text: str) -> None:
            text = text.strip()
            if text:
                on_sentence(text)
                spoken_all.append(text)

        def take_moods(text: str) -> str:
            for m in _MOOD_RE.finditer(text):
                on_mood(MOOD_LEVEL[m.group(1).lower()])
            return _MOOD_RE.sub("", text)

        stream = self.client.chat(model=self.llm.model, messages=messages, tools=schemas, stream=True, **self._kwargs())
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
                emit(take_moods(re.split(r"<tool_call|<function=|\{\s*\"name\"", buf + piece)[0]))
                buf = ""
                continue
            buf = take_moods(buf + piece)
            # незакрытая метка «[wa…» — ждём продолжения, не озвучиваем кусок
            hold = ""
            m = re.search(r"\[[a-zA-Z]{0,4}$", buf)
            if m:
                buf, hold = buf[:m.start()], buf[m.start():]
            sentences, buf = pop_sentences(buf)
            for s in sentences:
                emit(s)
            buf += hold
        if not muted and not (cancel is not None and cancel.is_set()):
            emit(take_moods(buf))
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()
        return content, tool_calls
