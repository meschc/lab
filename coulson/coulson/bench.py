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
    ru = best_russian_say_voice()
    if not ru:
        report("Распознавание ru", WARN, "нет русского голоса macOS для теста — установи «Юрий» или «Милена»: "
               "Настройки → Универсальный доступ → Устный контент → Системный голос → Управление голосами")
    cases = [(ru, "Колсон, открой Стим и включи музыку погромче."),
             (ru, "Сделай таблицу, чем занят мой диск, с диаграммой."),
             (cfg.tts.say_en_voice, "Coulson, what is the weather like in London today?")]
    for voice, phrase in cases:
        if not voice:
            continue
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


TOOL_CASES = [  # (команда, ожидаемый инструмент[, ожидаемое action])
    ("открой телеграм", "app", "open"), ("закрой дискорд", "app", "quit"),
    ("какая погода в Москве", "web", "weather"), ("найди в интернете курс доллара", "web", "search"),
    ("покажи на ютубе обзор айфона", "browser", "search"), ("открой сайт хабр", "browser", "open"),
    ("что у меня на экране", "look"), ("нажми кнопку войти", "click"), ("прокрути страницу вниз", "mouse"),
    ("напечатай привет как дела", "keyboard", "type"), ("нажми пробел", "keyboard", "keys"),
    ("сделай громче", "sound"), ("следующий трек", "sound"),
    ("заблокируй экран", "system"), ("сколько заряда батареи", "system", "status"),
    ("включи тёмную тему", "system"), ("поставь таймер на 10 минут", "set_timer"),
    ("напомни через час позвонить маме", "set_timer"),
    ("запомни, что я люблю кофе без сахара", "memory", "remember"),
    ("что я говорил про отпуск на прошлой неделе", "memory", "recall"),
    ("запиши идею: приложение для пробежек", "notes", "add"), ("добавь задачу купить подарок", "notes", "add"),
    ("какие у меня задачи", "notes", "list"),
    ("сделай таблицу расходов: еда 5000, транспорт 1500, кафе 3000", "create_table"),
    ("напиши html страницу-визитку для фотографа", "write_file"),
    ("что лежит в загрузках", "files", "list"), ("чем занят мой диск", "files", "disk_usage"),
    ("создай напоминание в приложении Напоминания купить молоко", "automation", "applescript"),
    ("выполни в терминале команду uptime", "run_shell"),
    ("подготовь всё к вечеру: открой стим, дискорд и сделай громче", "plan", "set"),
    ("попроси Клода написать скрипт, который переименует фото по дате", "claude", "ask"),
    ("разбери свои ошибки", "self", "analyze"),
    ("проверь, что впн работает и страна не Россия", "system", "vpn_status"),
]


def bench_tools(cfg) -> None:
    """Точность выбора инструмента: модели на 8B путаются, когда инструментов много (поэтому их 18)."""
    import ollama

    from .brain import Brain, now_context
    from .memory import Memory
    from .tools import load_all

    reg = load_all()
    with tempfile.TemporaryDirectory() as d:
        brain = Brain(cfg, reg, Memory(Path(d) / "b.db"))  # чистая память — чтобы не влияли твои факты
        client = ollama.Client(host=cfg.llm.host)
        kw = brain._kwargs()
        kw["options"]["num_predict"] = 1500
        kw["options"]["temperature"] = 0.0
        ok_tool = ok_action = 0
        misses = []
        t0 = time.monotonic()
        for case in TOOL_CASES:
            cmd, tool, action = case[0], case[1], (case[2] if len(case) > 2 else None)
            r = client.chat(model=cfg.llm.model, tools=reg.schemas(), **kw,
                            messages=brain._prefix() + [{"role": "user", "content": f"{now_context()} {cmd}"}])
            calls = [(c.function.name, dict(c.function.arguments or {})) for c in r.message.tool_calls or []]
            got = calls[0] if calls else (None, {})
            if got[0] == tool:
                ok_tool += 1
                if action is None or got[1].get("action") == action:
                    ok_action += 1
                else:
                    misses.append(f"«{cmd}» → {tool}.{got[1].get('action')} (ждал {action})")
            else:
                misses.append(f"«{cmd}» → {got[0] or 'без инструмента'} (ждал {tool})")
        n = len(TOOL_CASES)
    pct = ok_tool / n * 100
    report("Выбор инструмента", OK if pct >= 85 else (WARN if pct >= 70 else BAD),
           f"{ok_tool}/{n} ({pct:.0f}%), с правильным действием {ok_action}/{n}, "
           f"~{(time.monotonic() - t0) / n:.1f} с на команду")
    for m in misses:
        print(f"      {m}")


def bench_semantic(cfg) -> None:
    """Поиск по смыслу на русском: находит ли «куда я хотел в отпуск» запись про Грузию."""
    from .memory import Embedder, Memory

    model = (cfg.get("memory", {}) or {}).get("embed_model")
    if not model:
        report("Память: поиск по смыслу", WARN, "выключен (memory.embed_model: null)")
        return
    emb = Embedder(cfg.llm.host, model, cfg.llm.keep_alive)
    t = time.monotonic()
    if emb.embed(["проверка"]) is None:
        report("Память: поиск по смыслу", BAD, f"модель {model} недоступна — ollama pull {model}")
        return
    report("Память: модель эмбеддингов", OK, f"{model}, загрузка {time.monotonic() - t:.1f} с")
    with tempfile.TemporaryDirectory() as d:
        mem = Memory(Path(d) / "bench.db", emb)
        target = mem.add_note("Хочу в мае съездить в Грузию, посмотреть Тбилиси и горы")
        for text in ("Купить молоко и хлеб", "Созвон с Андреем по проекту в четверг",
                     "Идея: сделать бота для заметок", "Поменять масло в машине", "Прочитать книгу про стоицизм"):
            mem.add_note(text)
        mem.wait_embedded(60)
        t = time.monotonic()
        hits = mem.search("куда я хотел поехать в отпуск?", kinds=("notes",), limit=3)
        dt = time.monotonic() - t
    ok = bool(hits) and hits[0].id == target
    report("Память: поиск по смыслу", OK if ok and dt < 0.5 else (WARN if ok else BAD),
           f"{dt * 1000:.0f} мс, первым найдено: «{hits[0].text if hits else '—'}»"
           + (f" (сходство {hits[0].sim:.2f})" if hits else ""))


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
                     ("поиск в памяти", lambda: bench_semantic(cfg)),
                     ("выбор инструментов", lambda: bench_tools(cfg)),
                     ("голос", lambda: bench_tts(cfg)), ("память", bench_memory)):
        try:
            fn()
        except Exception as e:
            report(f"Сбой: {name}", BAD, f"{type(e).__name__}: {e}")
    bad = sum(r[0] == BAD for r in rows)
    warn = sum(r[0] == WARN for r in rows)
    print(f"\nИтого: {len(rows) - bad - warn} OK, {warn} предупреждений, {bad} проблем.")
    return 1 if bad else 0
