"""python -m coulson --bench — замер скорости и качества на этом Маке.

Проверяет то, от чего зависит, будет ли Колсон «вторым мозгом» или тормозом:
распознавание речи, кэш промпта в Ollama, задержку до первого слова, скорость генерации,
вызов инструментов, синтез речи и расход памяти.
"""
from __future__ import annotations

import subprocess
import tempfile
import time
import wave
from pathlib import Path

import numpy as np

OK, WARN, BAD = "✅", "⚠️ ", "❌"
rows: list[tuple[str, str, str]] = []


def report(name: str, status: str, info: str) -> None:
    rows.append((status, name, info))
    print(f"{status} {name}: {info}", flush=True)


def _say_to_array(text: str, voice: str) -> np.ndarray:
    tmp = Path(tempfile.gettempdir()) / f"coulson_bench_{time.time_ns()}.wav"
    subprocess.run(["say", "-v", voice, "-o", str(tmp), "--file-format=WAVE", "--data-format=LEI16@16000", text],
                   check=True, capture_output=True)
    with wave.open(str(tmp)) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    tmp.unlink(missing_ok=True)
    return data


def bench_stt(cfg) -> None:
    from .stt import STT
    from .textutil import find_wake
    from .tts import best_russian_say_voice

    stt = STT(cfg)
    t = time.monotonic()
    stt.warmup()
    report("Распознавание: загрузка", OK, f"{stt.engine}, {time.monotonic() - t:.1f} с")
    cases = [(best_russian_say_voice(), "Колсон, открой Стим и включи музыку погромче."),
             (best_russian_say_voice(), "Сделай таблицу, чем занят мой диск, с диаграммой."),
             (cfg.tts.say_en_voice, "Coulson, what is the weather like in London today?")]
    for voice, phrase in cases:
        audio = _say_to_array(phrase, voice)
        t = time.monotonic()
        text, lang = stt.transcribe(audio)
        dt = time.monotonic() - t
        wake, _ = find_wake(text, list(cfg.assistant.wake_words), int(cfg.assistant.wake_threshold))
        need_wake = phrase.lower().startswith(("колсон", "coulson"))
        status = OK if dt < 0.6 and text and (wake or not need_wake) else (WARN if text else BAD)
        extra = "" if not need_wake else (" · «Колсон» распознан" if wake else " · «Колсон» НЕ распознан — добавь вариант в wake_words")
        report(f"Распознавание {lang}", status, f"{dt * 1000:.0f} мс на {len(audio) / 16000:.1f} с речи → «{text}»{extra}")


def bench_llm(cfg) -> None:
    import ollama

    from .brain import Brain
    from .memory import Memory
    from .tools import load_all
    from . import config

    reg = load_all()
    brain = Brain(cfg, reg, Memory(config.DATA_DIR / "memory.db"))
    client = ollama.Client(host=cfg.llm.host)
    t = time.monotonic()
    brain.warmup()
    dt = time.monotonic() - t
    report("Мозг: загрузка + прогрев промпта", OK if dt < 25 else WARN, f"{cfg.llm.model}, {dt:.1f} с (один раз после загрузки)")

    def ask(text: str, history: list[dict]) -> tuple[object, float, list[dict], list[str]]:
        from .brain import now_context
        msgs = brain._prefix() + history + [{"role": "user", "content": f"{now_context()} {text}"}]
        first, t0 = None, time.monotonic()
        last = None
        content = ""
        calls = []
        for chunk in client.chat(model=cfg.llm.model, messages=msgs, tools=reg.schemas(), stream=True, **brain._kwargs()):
            if first is None and (chunk.message.content or chunk.message.tool_calls):
                first = time.monotonic() - t0
            content += chunk.message.content or ""
            calls += [c.function.name for c in chunk.message.tool_calls or []]
            last = chunk
        return last, first or 0.0, [{"role": "user", "content": text},
                                     {"role": "assistant", "content": content}], calls

    last, ttft, hist, _ = ask("Привет! Как дела? Ответь одной фразой.", [])
    pe = getattr(last, "prompt_eval_count", 0) or 0
    report("Мозг: первое слово (ответ без инструментов)", OK if ttft < 2.5 else (WARN if ttft < 6 else BAD),
           f"{ttft:.2f} с, обработано новых токенов промпта: {pe}")
    tps = (last.eval_count or 0) / max((last.eval_duration or 1) / 1e9, 1e-6)
    report("Мозг: скорость генерации", OK if tps >= 15 else WARN, f"{tps:.1f} токенов/с (~{tps / 3:.0f} слов/с)")

    last2, ttft2, _, _ = ask("А какой сегодня день недели?", hist)
    pe2 = getattr(last2, "prompt_eval_count", 0) or 0
    cached = pe2 < 600
    report("Мозг: кэш промпта между репликами", OK if cached else BAD,
           f"вторая реплика: {pe2} новых токенов, первое слово за {ttft2:.2f} с"
           + ("" if cached else " — кэш НЕ работает: каждая реплика будет медленной (см. CLAUDE.md)"))

    _, ttft3, _, calls = ask("Открой калькулятор.", [])
    report("Мозг: вызов инструмента", OK if "open_app" in calls else BAD,
           f"вызвал {calls or 'ничего'} за {ttft3:.2f} с")


def bench_tts(cfg) -> None:
    from .tts import Speaker

    s = Speaker(cfg)
    s.warmup()
    if s._silero is None:
        report("Голос", WARN, "Silero не загрузился — используется голос macOS")
        return
    t = time.monotonic()
    audio, sr = s._synth_silero("Готово, Стим запущен. Запустить вашу игру?")
    dt = time.monotonic() - t
    report("Голос: синтез фразы", OK if dt < 0.5 else WARN, f"{dt * 1000:.0f} мс на {len(audio) / sr:.1f} с речи")


def bench_memory() -> None:
    out = subprocess.run(["ollama", "ps"], capture_output=True, text=True).stdout.strip().splitlines()
    if len(out) > 1:
        report("Память: модель в Ollama", OK, " · ".join(out[1].split()[2:5]))
    import resource
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 / 1024 / 1024  # macOS: байты
    report("Память: процесс Колсона (слух+голос)", OK if rss < 3 else WARN, f"{rss:.1f} ГБ")


def run(cfg) -> int:
    print("Замер скорости Колсона на этом Маке…\n", flush=True)
    for name, fn in (("распознавание", lambda: bench_stt(cfg)), ("мозг", lambda: bench_llm(cfg)),
                     ("голос", lambda: bench_tts(cfg)), ("память", bench_memory)):
        try:
            fn()
        except Exception as e:
            report(f"Сбой: {name}", BAD, f"{type(e).__name__}: {e}")
    bad = sum(r[0] == BAD for r in rows)
    warn = sum(r[0] == WARN for r in rows)
    print(f"\nИтого: {len(rows) - bad - warn} OK, {warn} предупреждений, {bad} проблем.")
    return 1 if bad else 0
