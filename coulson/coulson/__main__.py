"""Точка входа.

  python -m coulson               голос + окно (обычный режим)
  python -m coulson --no-ui       голос без окна
  python -m coulson --text        текстовый чат в терминале (без микрофона) — удобно для отладки
  python -m coulson --say "…"     проверить голос
  python -m coulson --tool open_app '{"name": "Steam"}'   вызвать инструмент напрямую
  python -m coulson --check       диагностика
  python -m coulson --bench       замер скорости: распознавание, кэш промпта, задержка, токены/с, память
  python -m coulson --prefetch    заранее скачать модели распознавания и голоса
"""
from __future__ import annotations

import argparse
import json
import logging
import logging.handlers
import os
import sys
import threading

# Дочерние процессы (pbcopy, osascript, say) без UTF-8-локали портят кириллицу —
# а у приложения, запущенного из Finder/автозапуска, LANG не задан
os.environ.setdefault("LANG", "en_US.UTF-8")
os.environ.setdefault("LC_ALL", "en_US.UTF-8")

from . import config  # noqa: E402

_lock_file = None  # держим открытым всё время работы


def single_instance() -> bool:
    """Не даём запустить второго Колсона (иначе оба будут слушать и отвечать)."""
    import fcntl

    global _lock_file
    _lock_file = open(config.DATA_DIR / "coulson.lock", "w")
    try:
        fcntl.flock(_lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return False
    _lock_file.write(str(os.getpid()))
    _lock_file.flush()
    return True


def setup_logging(verbose: bool) -> None:
    config.LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    handlers = [logging.StreamHandler(sys.stderr),
                logging.handlers.RotatingFileHandler(config.LOG_FILE, maxBytes=5_000_000, backupCount=3,
                                                     encoding="utf-8")]
    logging.basicConfig(level=logging.DEBUG if verbose else logging.INFO, handlers=handlers,
                        format="%(asctime)s %(levelname).1s %(name)s: %(message)s", datefmt="%H:%M:%S")
    for noisy in ("httpx", "httpcore", "urllib3", "primp", "ddgs", "trafilatura", "PIL"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def cmd_check(cfg) -> int:
    ok = True

    def row(name, good, info=""):
        nonlocal ok
        ok &= bool(good)
        print(f"{'✅' if good else '❌'} {name}{(' — ' + info) if info else ''}")

    import platform
    row("Apple Silicon", platform.machine() == "arm64", platform.machine())
    try:
        import ollama
        models = [m.model for m in ollama.Client(host=cfg.llm.host).list().models]
        row("Ollama запущен", True, cfg.llm.host)
        row(f"Модель {cfg.llm.model}", any(m.startswith(cfg.llm.model) for m in models),
            f"есть: {', '.join(models) or 'нет'}")
        emb = (cfg.get("memory") or {}).get("embed_model")
        if emb:
            row(f"Модель поиска по смыслу {emb}", any(m.startswith(emb) for m in models),
                "" if any(m.startswith(emb) for m in models) else f"ollama pull {emb}")
    except Exception as e:
        row("Ollama запущен", False, f"{e} (brew services start ollama)")
    try:
        import sounddevice as sd
        dev = sd.query_devices(kind="input")
        row("Микрофон", True, dev["name"])
        print("   входные устройства:", "; ".join(f"{i}: {d['name']}" for i, d in enumerate(sd.query_devices())
                                                 if d["max_input_channels"] > 0))
    except Exception as e:
        row("Микрофон", False, str(e))
    for mod in ("parakeet_mlx", "mlx_whisper", "silero_vad", "torch", "webview", "ddgs", "trafilatura", "cv2", "Quartz"):
        try:
            __import__(mod)
            row(f"python: {mod}", True)
        except Exception as e:
            row(f"python: {mod}", False, str(e))
    import subprocess
    voices = subprocess.run(["say", "-v", "?"], capture_output=True, text=True).stdout
    row(f"Голос macOS {cfg.tts.say_en_voice}", cfg.tts.say_en_voice in voices)
    from .tts import best_russian_say_voice
    ru_voice = best_russian_say_voice()
    row("Русский голос macOS (запасной)", True, ru_voice or "не установлен (не обязателен, основной — Silero)")
    print(f"\nДанные: {config.DATA_DIR}\nЛог: {config.LOG_FILE}")
    return 0 if ok else 1


def cmd_prefetch(cfg) -> None:
    print(f"Распознавание речи ({cfg.stt.engine})…")
    from .stt import STT
    STT(cfg).warmup()
    print("Silero VAD…")
    from silero_vad import load_silero_vad
    load_silero_vad()
    print("Голос…")
    from .tts import Speaker
    Speaker(cfg).warmup()
    print("Готово.")


def cmd_text(cfg, mute: bool) -> None:
    from .assistant import Assistant

    a = Assistant(cfg)
    if mute:
        a.speaker.say = lambda text: None
    a.warmup(with_audio=False)
    print(f"\n{cfg.assistant.name} слушает (текстовый режим). Пустая строка или Ctrl+D — выход.\n")
    while True:
        try:
            line = input("вы › ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not line:
            break
        reply = a.handle(line)
        print(f"{cfg.assistant.name} › {reply}\n")


def main() -> None:
    p = argparse.ArgumentParser(prog="coulson", description="Колсон — локальный голосовой ассистент")
    p.add_argument("--config", help="путь к дополнительному yaml")
    p.add_argument("--no-ui", action="store_true")
    p.add_argument("--text", action="store_true")
    p.add_argument("--mute", action="store_true", help="в --text режиме не озвучивать")
    p.add_argument("--say")
    p.add_argument("--tool", nargs="+", metavar=("NAME", "JSON"))
    p.add_argument("--check", action="store_true")
    p.add_argument("--bench", action="store_true")
    p.add_argument("--prefetch", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    cfg = config.load(args.config)
    setup_logging(args.verbose)

    if args.check:
        sys.exit(cmd_check(cfg))
    if args.bench:
        from .bench import run as bench
        sys.exit(bench(cfg))
    if args.prefetch:
        return cmd_prefetch(cfg)
    if args.say:
        from .tts import Speaker
        s = Speaker(cfg)
        s.warmup()
        s.say(args.say)
        s.wait_idle()
        return
    if args.tool:
        from .memory import open_memory
        from .tools import Context, load_all
        reg = load_all()
        ctx = Context(cfg, memory=open_memory(cfg, config.DATA_DIR),
                      confirm=lambda d: input(f"Подтвердить «{d}»? [y/N] ").lower().startswith(("y", "д")))
        if args.tool[0] in ("look", "click"):
            from .brain import Brain
            brain = Brain(cfg, reg, ctx.memory)
            ctx.vision, ctx.locate = brain.vision, brain.locate
        print(reg.execute(args.tool[0], json.loads(args.tool[1]) if len(args.tool) > 1 else {}, ctx))
        return
    if args.text:
        return cmd_text(cfg, args.mute)

    if not single_instance():
        logging.getLogger("coulson").warning("Колсон уже запущен — вторая копия не нужна")
        sys.exit(0)  # код 0: лаунчер Coulson.app не будет перезапускать

    from .assistant import Assistant

    if args.no_ui or not cfg.ui.enabled:
        a = Assistant(cfg)
        a.start()
        threading.Event().wait()
        return

    from .ui.window import WindowUI

    ui = WindowUI(cfg)
    a = Assistant(cfg, ui=ui)
    ui.assistant = a
    ui.create()
    ui.run(on_start=a.start)


if __name__ == "__main__":
    main()
