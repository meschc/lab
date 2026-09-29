"""Оркестрация: слушаем → распознаём → слово-активатор → думаем/действуем → говорим."""
from __future__ import annotations

import logging
import os
import queue
import random
import re
import threading
import time
from dataclasses import dataclass

from . import config
from .memory import open_memory
from .textutil import find_wake, is_stop_command, normalize, parse_yes_no, strip_honorifics
from .intents import try_fast
from .tools import Context, load_all

log = logging.getLogger(__name__)


@dataclass
class Utterance:
    text: str
    rest: str
    wake: bool
    during_tts: bool
    t: float  # monotonic-время ЗАПИСИ конца фразы


def _is_connection_error(e: Exception) -> bool:
    text = f"{type(e).__name__} {e}".lower()
    return any(k in text for k in ("connect", "refused", "timed out", "timeout", "unavailable"))


class NullUI:
    def set_state(self, state: str, detail: str = "") -> None: ...
    def set_level(self, level: float) -> None: ...
    def show_user(self, text: str, accepted: bool = True) -> None: ...
    def show_assistant(self, text: str) -> None: ...
    def set_mic(self, on: bool) -> None: ...
    def set_mood(self, level: float) -> None: ...


TOOL_LABELS = {
    "open_app": "запускаю", "quit_app": "закрываю", "find_app": "ищу приложение", "running_apps": "смотрю процессы",
    "open_url": "открываю сайт", "browser_search": "открываю поиск", "web_search": "ищу в интернете",
    "read_webpage": "читаю страницу", "browser_tab": "смотрю вкладку", "weather": "узнаю погоду",
    "look": "смотрю", "run_shell": "выполняю команду", "run_applescript": "управляю приложением",
    "run_shortcut": "запускаю команду", "sound": "звук", "system_status": "проверяю систему",
    "system_action": "выполняю", "set_timer": "ставлю таймер", "clipboard": "буфер обмена", "type_text": "печатаю",
    "press_keys": "нажимаю клавиши", "find_files": "ищу файлы", "open_path": "открываю", "memory": "память",
    "vpn": "VPN", "write_file": "создаю файл", "create_table": "делаю таблицу", "read_file": "читаю файл",
    "list_dir": "смотрю папку", "disk_usage": "считаю место на диске", "click": "кликаю", "mouse": "мышь",
    "notes": "заметки", "plan": "планирую", "app": "приложения", "browser": "браузер", "web": "ищу в интернете",
    "keyboard": "клавиатура", "system": "система", "automation": "автоматизация", "files": "файлы",
    "claude": "работаю с Клодом", "self": "разбираю свои ошибки", "vpn": "VPN",
}

_FILLERS = ("Минутку, работаю.", "Секунду, делаю.", "Сейчас, это займёт немного времени.", "Работаю над этим.")

_GAME_MODE_RE = re.compile(r"\b(игровой режим|освободи память|выгрузи модель|game mode|free memory)\b")

# Только команда целиком: «закрой Стим» / «quit Steam» не должны выключать самого Колсона
_QUIT_RE = re.compile(r"^(пожалуйста )?(выключись|отключись|заверши работу|завершай работу|закройся|"
                      r"turn yourself off|shut yourself down)( пожалуйста)?$")

_SLEEP_RE = re.compile(r"\b(не слушай|перестань слушать|режим сна|спи|отдыхай|stop listening|go to sleep)\b")
_WAKE_UP_RE = re.compile(r"\b(проснись|слушай|просыпайся|я здесь|wake up|start listening)\b")


class Assistant:
    def __init__(self, cfg: config.Config, ui=None):
        self.cfg = cfg
        self.ui = ui or NullUI()
        self.memory = open_memory(cfg, config.DATA_DIR)
        self.tools = load_all()
        self.utterances: queue.Queue[Utterance] = queue.Queue()
        self.cancel = threading.Event()
        self.busy = False
        self.sleeping = False
        self.ready = threading.Event()
        self.awaiting_until = 0.0
        self.awaiting_from = 0.0   # после «Колсон» принимаем только фразы, сказанные ПОСЛЕ сигнала
        self.followup_until = 0.0
        self.followup_from = 0.0   # продолжение без имени — только для фраз, сказанных после ответа
        self.followups_in_row = 0  # подряд без «Колсон» — не больше followup_max (иначе ТВ может зациклить)
        self.confirming = False

        from .brain import Brain
        from .tts import Speaker

        self.speaker = Speaker(cfg)
        self.speaker.on_speaking = lambda on: self.ui.set_state("speaking" if on else self._idle_state())
        self.brain = Brain(cfg, self.tools, self.memory)
        self.ctx = Context(cfg, memory=self.memory, speak=self.say, confirm=self.confirm,
                           vision=self.brain.vision, notify=self.ui.show_assistant,
                           attach_image=self.brain.attach_image, locate=self.brain.locate,
                           progress=lambda text: self.ui.set_state("thinking", text),
                           ask_self=self.brain.side_query, restart=self.restart)
        self._mood_timer: threading.Timer | None = None
        self.listener = None
        self.stt = None

    # ------------------------------------------------------------ запуск
    def warmup(self, with_audio: bool = True) -> None:
        from .tools.apps import index

        self.ui.set_state("loading", "загрузка моделей…")
        threading.Thread(target=index.build, daemon=True, name="app-index").start()
        jobs = [("голос", self.speaker.warmup), ("мозг", self.brain.warmup)]
        if with_audio:
            from .stt import STT
            self.stt = STT(self.cfg)
            jobs.insert(0, ("слух", self.stt.warmup))
        for name, job in jobs:
            self.ui.set_state("loading", f"загружаю {name}…")
            # При входе в систему Ollama может подниматься дольше Колсона — даём ей до минуты
            attempts = 12 if name == "мозг" else 1
            for attempt in range(attempts):
                try:
                    job()
                    break
                except Exception as e:
                    if attempt < attempts - 1 and _is_connection_error(e):
                        time.sleep(5)
                        continue
                    log.exception("Не удалось загрузить %s", name)
                    self.ui.show_assistant(f"Ошибка загрузки ({name}): {e}")
                    self.set_mood(1.0, hold_seconds=30)
                    break
        self.ready.set()
        self.ui.set_state("idle")

    def start(self) -> None:
        """Полный голосовой режим (вызывается в фоновом потоке)."""
        from .audio import Listener

        self.warmup(with_audio=True)
        self.listener = Listener(self.cfg, on_level=self.ui.set_level)
        self.listener.start()
        threading.Thread(target=self._listen_loop, daemon=True, name="listen").start()
        threading.Thread(target=self._agent_loop, daemon=True, name="agent").start()
        threading.Thread(target=self._self_review_loop, daemon=True, name="self-review").start()
        name = self.cfg.assistant.name
        log.info("%s готов и слушает", name)
        self.say(f"{name} на связи.")

    def set_mic(self, on: bool) -> None:
        if self.listener:
            self.listener.set_enabled(on)
        self.ui.set_mic(on)
        self.ui.set_state(self._idle_state())

    def _idle_state(self) -> str:
        if self.listener and not self.listener.enabled.is_set():
            return "muted"
        if self.sleeping:
            return "sleeping"
        if time.monotonic() < self.awaiting_until:
            return "listening"
        return "thinking" if self.busy else "idle"

    def restart(self) -> None:
        """Перезапуск с новым кодом: ненулевой код — лаунчер Coulson.app поднимет Колсона заново."""
        log.info("Перезапуск (после самопочинки)")
        self.speaker.wait_idle(timeout=15)
        os._exit(75)

    def _self_review_loop(self) -> None:
        """В простое разбирает журнал ошибок — пока модель ещё в памяти (не будим её ради этого)."""
        c = self.cfg.get("self_review") or {}
        if not c.get("auto", True):
            return
        from .tools.selfcare import analyze
        while True:
            time.sleep(60)
            try:
                idle = time.time() - self.brain.last_active
                if (self.busy or not self.brain.last_active or idle < float(c.get("idle_minutes", 5)) * 60
                        or len(self.memory.incidents()) < int(c.get("min_incidents", 3))):
                    continue
                loaded = [m.model for m in self.brain.client.ps().models]
                if not any(m.startswith(self.cfg.llm.model) for m in loaded):
                    continue
                if not self.brain._lock.acquire(blocking=False):
                    continue
                try:
                    log.info("🧠 самоанализ в простое: %s", analyze(self.memory, self.brain.side_query))
                finally:
                    self.brain._lock.release()
            except Exception:
                log.exception("самоанализ в простое не удался")

    def quit(self) -> None:
        """Корректно завершить работу (лаунчер Coulson.app не перезапускает при коде 0)."""
        log.info("Завершение работы по команде")
        self.speaker.interrupt()
        self.say("До связи.")
        self.speaker.wait_idle(timeout=5)
        os._exit(0)

    # ------------------------------------------------------------ слух
    def _listen_loop(self) -> None:
        while True:  # сбой в распознавании не должен оставить Колсона глухим
            try:
                self._listen_once()
            except Exception:
                log.exception("Поток прослушивания упал — перезапускаю")
                time.sleep(1)

    def _listen_once(self) -> None:
        a = self.cfg.assistant
        for seg in self.listener.segments():
            try:
                text, _lang = self.stt.transcribe(seg.audio)
            except Exception:
                log.exception("STT error")
                continue
            if not text:
                continue
            wake, rest = find_wake(text, list(a.wake_words), int(a.wake_threshold))
            during_tts = self.speaker.overlaps(seg.t_start, seg.t_end)
            log.info("🎙 %s%s%s", text, " [wake]" if wake else "", " [во время речи]" if during_tts else "")
            if during_tts and not wake:
                continue  # скорее всего, мы слышим сами себя
            if wake and (self.speaker.is_speaking or self.busy) and self.cfg.audio.barge_in:
                self.cancel.set()
                self.speaker.interrupt()
            self.utterances.put(Utterance(text, rest, wake, during_tts, seg.t_end))

    # ------------------------------------------------------------ диалог
    def _agent_loop(self) -> None:
        while True:
            u = self.utterances.get()
            try:
                self._handle_utterance(u)
            except Exception:
                log.exception("agent error")
                self.ui.set_state("idle")

    def _handle_utterance(self, u: Utterance) -> None:
        now = time.monotonic()
        a = self.cfg.assistant
        if self.sleeping:
            if u.wake and _WAKE_UP_RE.search(normalize(u.rest or "")):
                self.sleeping = False
                self.say("Я снова слушаю.")
            return

        via_followup = (not u.wake and not (now < self.awaiting_until and u.t >= self.awaiting_from)
                        and now < self.followup_until and u.t >= self.followup_from
                        and self.followups_in_row < int(a.get("followup_max", 2)))
        accepted = u.wake or (now < self.awaiting_until and u.t >= self.awaiting_from) or via_followup
        if accepted:
            self.followups_in_row = self.followups_in_row + 1 if via_followup else 0
        self.ui.show_user(u.rest if u.wake else u.text, accepted)
        if not accepted:
            return
        command = (u.rest if u.wake else u.text).strip()

        if u.wake and not command:
            self._ack()
            return
        if is_stop_command(command):
            self.speaker.interrupt()
            self.followup_until = 0
            self.ui.set_state("idle")
            return
        if _QUIT_RE.search(normalize(command)) and len(command) < 40:
            self.quit()
            return
        if _GAME_MODE_RE.search(normalize(command)) and len(command) < 40:
            self.brain.unload()
            self.say("Игровой режим: освободил память. Модель загрузится снова при следующей просьбе.")
            return
        if _SLEEP_RE.search(normalize(command)) and len(command) < 40:
            self.sleeping = True
            self.say(f"Хорошо. Скажите «{a.name}, проснись», когда понадоблюсь.")
            self.ui.set_state("sleeping")
            return
        self.awaiting_until = 0
        self.handle(command)

    def _ack(self) -> None:
        a = self.cfg.assistant
        self.awaiting_from = time.monotonic() - 0.3
        self.awaiting_until = time.monotonic() + float(a.listen_after_wake_seconds)
        self.ui.set_state("listening")
        if a.ack == "voice":
            self.say("Да?")
        else:
            from .audio import chime
            chime("wake")

    # ------------------------------------------------------------ настроение → цвет шара
    def set_mood(self, level: float, hold_seconds: float | None = None) -> None:
        """0 — голубой, 0.5 — заметно краснее, 1 — красный. Через время плавно возвращается к голубому."""
        self.ui.set_mood(level)
        if self._mood_timer:
            self._mood_timer.cancel()
            self._mood_timer = None
        if level > 0 and hold_seconds:
            self._mood_timer = threading.Timer(hold_seconds, lambda: self.ui.set_mood(0.0))
            self._mood_timer.daemon = True
            self._mood_timer.start()

    def handle(self, command: str) -> str:
        """Выполнить команду (голосовую или текстовую)."""
        self.cancel.clear()
        self.set_mood(0.0)
        mood_level = [0.0]
        self.busy = True
        self.ui.set_state("thinking")
        spoken: list[str] = []

        def on_sentence(s: str) -> None:
            if self.cancel.is_set():  # перебили — остаток ответа не озвучиваем
                return
            s = strip_honorifics(s)
            if not s:
                return
            spoken.append(s)
            self.ui.show_assistant(" ".join(spoken))
            self.speaker.say(s)

        def filler() -> None:
            # Модель долго пишет (страница, таблица, поиск) — даём знать, что не зависли
            if self.busy and not spoken and not self.cancel.is_set() and not self.confirming:
                self.speaker.say(random.choice(_FILLERS))

        played_from = len(self.speaker.played)
        fast = None
        if self.cfg.assistant.get("fast_commands", True):
            try:
                fast = try_fast(command, self.tools, self.ctx)
            except Exception:
                log.exception("быстрый путь не сработал — передаю модели")
        timer = None
        if fast is not None:  # простая команда — без нейросети, мгновенно
            log.info("⚡ %s → %s", command, fast.reply)
            mood_level[0] = fast.mood
            self.set_mood(fast.mood)
            on_sentence(fast.reply)
            self.brain.note_exchange(command, fast.reply, fast.mood)
            reply = fast.reply
            self.busy = False
        else:
            delay = float(self.cfg.assistant.get("filler_after_seconds", 6) or 0)
            timer = threading.Timer(delay, filler) if delay > 0 else None
            if timer:
                timer.daemon = True
                timer.start()
            try:
                def on_mood(level: float) -> None:
                    mood_level[0] = level
                    self.set_mood(level)

                reply = self.brain.respond(command, self.ctx, on_sentence, cancel=self.cancel, on_mood=on_mood,
                                           on_tool=lambda name: self.ui.set_state("thinking", TOOL_LABELS.get(name, name)))
            except Exception as e:
                log.exception("LLM error")
                self.memory.add_incident("crash", f"«{command[:200]}»: {type(e).__name__}: {e}")
                reply = ""
                mood_level[0] = 1.0
                self.set_mood(1.0)
                on_sentence(f"Простите, мозг не отвечает: {type(e).__name__}.")
            finally:
                self.busy = False
                if timer:
                    timer.cancel()
        self.speaker.wait_idle()
        if self.cancel.is_set():  # перебили — в истории только то, что реально прозвучало
            self.brain.mark_interrupted(" ".join(self.speaker.played[played_from:]))
        self.followup_from = time.monotonic() - 0.3
        self.followup_until = time.monotonic() + float(self.cfg.assistant.followup_seconds)
        self.ui.set_state(self._idle_state())
        if mood_level[0] > 0:  # красноватый цвет держится немного после ответа и уходит
            self.set_mood(mood_level[0], hold_seconds=float(self.cfg.ui.get("mood_hold_seconds", 10)))
        if self.ctx.game_launched:
            self.ctx.game_launched = False
            if self.cfg.llm.get("unload_on_game", True):
                self.brain.unload()
        self._maybe_suggest_review()
        return reply or " ".join(spoken)

    def _maybe_suggest_review(self) -> None:
        """Накопились ошибки — один раз предложить отдать их Клоду на разбор (не чинит сам, без спроса)."""
        limit = int((self.cfg.get("self_review") or {}).get("suggest_after", 5) or 0)
        if not limit or self.cancel.is_set():
            return
        count = len(self.memory.incidents(limit=100))
        if count < limit or count <= getattr(self, "_suggested_at", 0):
            return
        self._suggested_at = count + limit  # следующее напоминание — ещё через столько же ошибок
        text = (f"Кстати, в журнале накопилось {count} моих ошибок. Отдать их Клоду на разбор и починку?")
        self.brain.append_to_last(text)  # чтобы на «да» модель поняла, о чём речь
        self.say(text)
        self.speaker.wait_idle()
        self.followup_from = time.monotonic() - 0.3
        self.followup_until = time.monotonic() + float(self.cfg.assistant.followup_seconds)

    def say(self, text: str) -> None:
        self.ui.show_assistant(text)
        self.speaker.say(text)

    # ------------------------------------------------------------ подтверждение опасных действий
    def confirm(self, description: str) -> bool:
        a = self.cfg.assistant
        if self.listener is None:  # текстовый режим
            ans = input(f"\n⚠️  Подтвердите: {description}? [да/нет] ")
            return bool(parse_yes_no(ans))
        self.confirming = True
        self.set_mood(0.5)  # опасное действие — шар краснеет, пока ждём ответа
        try:
            while not self.utterances.empty():
                self.utterances.get_nowait()
            self.speaker.say(f"Нужно подтверждение: {description}. Выполнить?")
            self.speaker.wait_idle()
            self.ui.set_state("listening", "жду подтверждения")
            deadline = time.monotonic() + float(a.confirm_timeout_seconds)
            while time.monotonic() < deadline:
                try:
                    u = self.utterances.get(timeout=0.2)
                except queue.Empty:
                    continue
                self.ui.show_user(u.text)
                answer = parse_yes_no(u.rest if u.wake else u.text)
                if answer is not None:
                    self.ui.set_state("thinking")
                    return answer
            self.speaker.say("Не услышал ответа, отменяю.")
            return False
        finally:
            self.awaiting_until = 0
            self.confirming = False
