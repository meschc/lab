"""Оркестрация: слушаем → распознаём → слово-активатор → думаем/действуем → говорим."""
from __future__ import annotations

import logging
import queue
import re
import threading
import time
from dataclasses import dataclass

from . import config
from .memory import Memory
from .textutil import find_wake, is_stop_command, normalize, parse_yes_no, strip_honorifics
from .tools import Context, load_all

log = logging.getLogger(__name__)


@dataclass
class Utterance:
    text: str
    rest: str
    wake: bool
    during_tts: bool
    t: float


class NullUI:
    def set_state(self, state: str, detail: str = "") -> None: ...
    def set_level(self, level: float) -> None: ...
    def show_user(self, text: str, accepted: bool = True) -> None: ...
    def show_assistant(self, text: str) -> None: ...
    def set_mic(self, on: bool) -> None: ...


TOOL_LABELS = {
    "open_app": "запускаю", "quit_app": "закрываю", "find_app": "ищу приложение", "running_apps": "смотрю процессы",
    "open_url": "открываю сайт", "browser_search": "открываю поиск", "web_search": "ищу в интернете",
    "read_webpage": "читаю страницу", "browser_tab": "смотрю вкладку", "weather": "узнаю погоду",
    "look_at_screen": "смотрю на экран", "look_at_camera": "смотрю в камеру", "run_shell": "выполняю команду",
    "run_applescript": "управляю приложением", "run_shortcut": "запускаю команду", "volume": "громкость",
    "media": "медиа", "system_status": "проверяю систему", "system_action": "выполняю", "set_timer": "ставлю таймер",
    "clipboard": "буфер обмена", "type_text": "печатаю", "find_files": "ищу файлы", "open_path": "открываю",
    "remember": "запоминаю", "forget": "забываю", "recall": "вспоминаю", "vpn": "VPN",
}

_SLEEP_RE = re.compile(r"\b(не слушай|перестань слушать|режим сна|спи|отдыхай|stop listening|go to sleep)\b")
_WAKE_UP_RE = re.compile(r"\b(проснись|слушай|просыпайся|я здесь|wake up|start listening)\b")


class Assistant:
    def __init__(self, cfg: config.Config, ui=None):
        self.cfg = cfg
        self.ui = ui or NullUI()
        self.memory = Memory(config.DATA_DIR / "memory.db")
        self.tools = load_all()
        self.utterances: queue.Queue[Utterance] = queue.Queue()
        self.cancel = threading.Event()
        self.busy = False
        self.sleeping = False
        self.ready = threading.Event()
        self.awaiting_until = 0.0
        self.followup_until = 0.0

        from .brain import Brain
        from .tts import Speaker

        self.speaker = Speaker(cfg)
        self.speaker.on_speaking = lambda on: self.ui.set_state("speaking" if on else self._idle_state())
        self.brain = Brain(cfg, self.tools, self.memory)
        self.ctx = Context(cfg, memory=self.memory, speak=self.say, confirm=self.confirm,
                           vision=self.brain.vision, notify=self.ui.show_assistant)
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
            try:
                job()
            except Exception as e:
                log.exception("Не удалось загрузить %s", name)
                self.ui.show_assistant(f"Ошибка загрузки ({name}): {e}")
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

    # ------------------------------------------------------------ слух
    def _listen_loop(self) -> None:
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
            self.utterances.put(Utterance(text, rest, wake, during_tts, time.monotonic()))

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

        accepted = u.wake or now < self.awaiting_until or now < self.followup_until
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
        if _SLEEP_RE.search(normalize(command)) and len(command) < 40:
            self.sleeping = True
            self.say(f"Хорошо. Скажите «{a.name}, проснись», когда понадоблюсь.")
            self.ui.set_state("sleeping")
            return
        self.awaiting_until = 0
        self.handle(command)

    def _ack(self) -> None:
        a = self.cfg.assistant
        self.awaiting_until = time.monotonic() + float(a.listen_after_wake_seconds)
        self.ui.set_state("listening")
        if a.ack == "voice":
            self.say("Да?")
        else:
            from .audio import chime
            chime("wake")

    def handle(self, command: str) -> str:
        """Выполнить команду (голосовую или текстовую)."""
        self.cancel.clear()
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

        try:
            reply = self.brain.respond(command, self.ctx, on_sentence, cancel=self.cancel,
                                       on_tool=lambda name: self.ui.set_state("thinking", TOOL_LABELS.get(name, name)))
        except Exception as e:
            log.exception("LLM error")
            reply = ""
            on_sentence(f"Простите, мозг не отвечает: {type(e).__name__}.")
        finally:
            self.busy = False
        self.speaker.wait_idle()
        self.followup_until = time.monotonic() + float(self.cfg.assistant.followup_seconds)
        self.ui.set_state(self._idle_state())
        return reply or " ".join(spoken)

    def say(self, text: str) -> None:
        self.ui.show_assistant(text)
        self.speaker.say(text)

    # ------------------------------------------------------------ подтверждение опасных действий
    def confirm(self, description: str) -> bool:
        a = self.cfg.assistant
        if self.listener is None:  # текстовый режим
            ans = input(f"\n⚠️  Подтвердите: {description}? [да/нет] ")
            return bool(parse_yes_no(ans))
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
