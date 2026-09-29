"""Своя база фильмов: импорт (Кинопоиск и любые таблицы), подборки «что посмотреть», контекст «фильм 9».

Хранится в memory.db (таблица movies). Статусы: want (хочу посмотреть), watched (посмотрел), skip (не смотреть).
Импорт понимает CSV/TSV, JSON (список или {items|films|docs: […]}, как у API Кинопоиска), XLSX/XLS и SQLite:
заголовки сопоставляются по синонимам (nameRu/«Название», year/«Год», ratingKinopoisk/«Рейтинг КП», «Моя оценка»…).
Незнакомый формат — пусть Claude Code на Маке допишет синонимы в FIELDS.
"""
from __future__ import annotations

import csv
import json
import random
import re
import sqlite3
import threading
from pathlib import Path

from .textutil import normalize

FIELDS = {  # поле → варианты заголовков (сравнение без регистра, пробелов и подчёркиваний)
    "title": ["title", "name", "nameru", "русскоеназвание", "русскоязычноеназвание", "название", "фильм", "film",
              "movie", "namerus"],
    "orig": ["nameoriginal", "nameen", "originaltitle", "alternativename", "оригинальноеназвание", "original",
             "englishname", "enname"],
    "year": ["year", "год", "годвыпуска", "releaseyear"],
    "kp": ["ratingkinopoisk", "ratingkp", "kprating", "рейтингкинопоиска", "рейтингкп", "кп", "rating", "рейтинг"],
    "imdb": ["ratingimdb", "imdb", "imdbrating", "рейтингimdb"],
    "mine": ["myrating", "userrating", "моя оценка".replace(" ", ""), "оценка", "vote", "myvote", "myscore"],
    "status": ["status", "статус", "list", "folder", "папка", "список", "watched", "просмотрен", "category"],
    "genres": ["genres", "genre", "жанры", "жанр"],
    "kp_id": ["kinopoiskid", "filmid", "kpid", "idkinopoisk", "id"],
    "about": ["description", "shortdescription", "описание", "plot", "overview", "annotation", "slogan"],
    "kind": ["type", "тип", "kind"],
    "country": ["countries", "country", "страна", "страны"],
    "length": ["filmlength", "length", "movielength", "продолжительность", "длительность", "runtime"],
}
_LOOKUP = {syn: field for field, syns in FIELDS.items() for syn in syns}

_WANT = re.compile(r"(буду смотреть|хочу|посмотреть|want|watchlist|to ?watch|planned|отложен)", re.I)
_SKIP = re.compile(r"(не смотреть|не буду|skip|не интересно|dropped|брошен|blacklist|не нравится)", re.I)
_SEEN = re.compile(r"(просмотрен|смотрел|посмотрел|watched|seen|completed|done|true|^1$|^да$)", re.I)

_last: list[int] = []   # номера из последней подборки → id фильмов («расскажи про девятый»)
_lock = threading.Lock()


def _key(h: str) -> str:
    return re.sub(r"[\s_\-.()№#:]+", "", str(h).strip().lower())


def _flat(v) -> str:
    """[{'genre': 'драма'}, …] / {'kp': 8.1} / ['драма'] → текст."""
    if v is None:
        return ""
    if isinstance(v, list):
        return ", ".join(filter(None, (_flat(x) for x in v)))
    if isinstance(v, dict):
        for k in ("genre", "country", "name", "value", "kp", "ru"):
            if k in v:
                return _flat(v[k])
        return ""
    return str(v).strip()


def _num(v) -> float | None:
    if isinstance(v, dict):
        v = v.get("kp", v.get("value"))
    try:
        return float(str(v).replace(",", ".").split("/")[0])
    except (TypeError, ValueError):
        return None


def ensure_table(memory) -> None:
    with memory._lock:
        memory.db.executescript("""
            CREATE TABLE IF NOT EXISTS movies (
                id INTEGER PRIMARY KEY, title TEXT NOT NULL, orig TEXT DEFAULT '', year INTEGER,
                kp REAL, imdb REAL, mine REAL, status TEXT NOT NULL DEFAULT 'want', genres TEXT DEFAULT '',
                kp_id TEXT DEFAULT '', about TEXT DEFAULT '', kind TEXT DEFAULT '', country TEXT DEFAULT '',
                length TEXT DEFAULT '', note TEXT DEFAULT '', UNIQUE(title, year));
        """)
        memory.db.commit()


def normalize_row(raw: dict, default_status: str = "want") -> dict | None:
    row: dict = {}
    for h, v in raw.items():
        field = _LOOKUP.get(_key(h))
        if field and field not in row and v not in (None, ""):
            row[field] = v
    # вложенные поля API Кинопоиска: rating: {kp, imdb}, names…
    if isinstance(raw.get("rating"), dict):
        row["kp"], row["imdb"] = raw["rating"].get("kp"), raw["rating"].get("imdb")
    title = _flat(row.get("title")) or _flat(row.get("orig"))
    if not title:
        return None
    mine = _num(row.get("mine"))
    status_raw = _flat(row.get("status"))
    if _SKIP.search(status_raw):
        status = "skip"
    elif _WANT.search(status_raw):
        status = "want"
    elif _SEEN.search(status_raw) or mine:
        status = "watched"
    else:
        status = default_status
    year = _num(row.get("year"))
    return {"title": title, "orig": _flat(row.get("orig")), "year": int(year) if year else None,
            "kp": _num(row.get("kp")), "imdb": _num(row.get("imdb")), "mine": mine, "status": status,
            "genres": _flat(row.get("genres")).lower(), "kp_id": _flat(row.get("kp_id")),
            "about": _flat(row.get("about"))[:1500], "kind": _flat(row.get("kind")),
            "country": _flat(row.get("country")), "length": _flat(row.get("length"))}


def read_rows(path: Path) -> list[dict]:
    ext = path.suffix.lower()
    if ext in (".json", ".jsonl"):
        text = path.read_text(encoding="utf-8-sig")
        if ext == ".jsonl":
            return [json.loads(line) for line in text.splitlines() if line.strip()]
        data = json.loads(text)
        if isinstance(data, dict):
            data = next((data[k] for k in ("items", "films", "docs", "movies", "data", "results") if k in data),
                        list(data.values()))
        return [x for x in data if isinstance(x, dict)]
    if ext in (".xlsx", ".xlsm"):
        import openpyxl
        ws = openpyxl.load_workbook(path, read_only=True, data_only=True).active
        rows = list(ws.iter_rows(values_only=True))
        return _rows_with_header(rows)
    if ext == ".xls":  # старый экспорт Кинопоиска — часто на деле HTML-таблица
        raw = path.read_bytes()
        if b"<table" in raw[:5000].lower() or b"<html" in raw[:5000].lower():
            return _html_table(raw.decode("utf-8", "ignore") if b"utf-8" in raw[:2000].lower()
                               else raw.decode("cp1251", "ignore"))
        raise ValueError("бинарный .xls: сохраните как .xlsx или .csv")
    if ext in (".db", ".sqlite", ".sqlite3"):
        return _sqlite_rows(path)
    if ext in (".html", ".htm"):
        return _html_table(path.read_text(encoding="utf-8", errors="ignore"))
    text = path.read_text(encoding="utf-8-sig", errors="ignore")
    dialect = csv.Sniffer().sniff(text[:5000], delimiters=",;\t|")
    return list(csv.DictReader(text.splitlines(), dialect=dialect))


def _rows_with_header(rows: list) -> list[dict]:
    for i, r in enumerate(rows[:20]):  # заголовок может быть не в первой строке
        if sum(1 for c in r if c is not None and _key(c) in _LOOKUP) >= 2:
            head = [str(c) if c is not None else f"col{j}" for j, c in enumerate(r)]
            return [dict(zip(head, row)) for row in rows[i + 1:] if any(c not in (None, "") for c in row)]
    raise ValueError("не нашёл строку заголовков (Название, Год…)")


def _html_table(html: str) -> list[dict]:
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)]
        rows.append(cells)
    return _rows_with_header(rows)


def _sqlite_rows(path: Path) -> list[dict]:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    best, best_score = None, 0
    for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type='table'"):
        cols = [r[1] for r in con.execute(f'PRAGMA table_info("{name}")')]
        score = sum(1 for c in cols if _key(c) in _LOOKUP)
        if score > best_score:
            best, best_score = name, score
    if not best:
        raise ValueError("в базе нет таблицы с фильмами")
    return [dict(r) for r in con.execute(f'SELECT * FROM "{best}"')]


def import_file(memory, path: str, default_status: str = "want") -> str:
    p = Path(path).expanduser()
    if not p.exists():
        return f"Ошибка: файла {p} нет"
    ensure_table(memory)
    try:
        raw = read_rows(p)
    except Exception as e:
        return f"Ошибка: не разобрал файл ({e}). Покажи его Claude Code — он добавит формат в coulson/movies.py"
    added = updated = 0
    counts = {"want": 0, "watched": 0, "skip": 0}
    with memory._lock:
        for r in raw:
            m = normalize_row(r, default_status)
            if not m:
                continue
            counts[m["status"]] += 1
            cur = memory.db.execute("SELECT id FROM movies WHERE title=? AND year IS ?", (m["title"], m["year"]))
            old = cur.fetchone()
            if old:
                sets = ", ".join(f"{k}=COALESCE(NULLIF(?, ''), {k})" for k in m)
                memory.db.execute(f"UPDATE movies SET {sets} WHERE id=?", (*m.values(), old[0]))
                updated += 1
            else:
                memory.db.execute(f"INSERT INTO movies({', '.join(m)}) VALUES ({', '.join('?' * len(m))})",
                                  tuple(m.values()))
                added += 1
        memory.db.commit()
    return (f"Импорт из {p.name}: новых {added}, обновлено {updated}. Хочу посмотреть — {counts['want']}, "
            f"посмотрено — {counts['watched']}, не смотреть — {counts['skip']}.")


# ---------------------------------------------------------------- запросы

_COLS = "id, title, orig, year, kp, imdb, mine, status, genres, about, kind, country, length, note"


def _rows(memory, sql: str, args=()) -> list[dict]:
    ensure_table(memory)
    with memory._lock:
        cur = memory.db.execute(sql, args)
        names = [d[0] for d in cur.description]
        return [dict(zip(names, r)) for r in cur.fetchall()]


def short(m: dict) -> str:
    bits = [str(m["year"])] if m.get("year") else []
    if m.get("genres"):
        bits.append(m["genres"].split(",")[0].strip())
    if m.get("kp"):
        bits.append(f"КП {m['kp']:.1f}")
    return f"{m['title']} ({', '.join(bits)})" if bits else m["title"]


def suggest(memory, query: str = "", count: int = 3, include_watched: bool = False) -> str:
    rows = _rows(memory, f"SELECT {_COLS} FROM movies WHERE status IN ({'?,?' if include_watched else '?'})",
                 ("want", "watched") if include_watched else ("want",))
    if not rows:
        return "База фильмов пуста или в «хочу посмотреть» ничего нет. Загрузить: python -m coulson --import-movies файл"
    words = [w for w in normalize(query).split() if len(w) > 2 and w not in ("фильм", "фильмы", "что", "посмотреть",
                                                                               "какой", "нибудь", "вечер", "сегодня")]
    if words:
        def score(m: dict) -> int:
            hay = normalize(f"{m['genres']} {m['title']} {m['orig']} {m['about']} {m['country']} {m['kind']}")
            return sum(1 for w in words if w[:5] in hay)
        matched = [m for m in rows if score(m)]
        if matched:
            rows = sorted(matched, key=lambda m: -score(m))
    # лучшие по рейтингу, но с разнообразием: случайные из верхней трети
    rows.sort(key=lambda m: -(m["kp"] or m["imdb"] or 6.5))
    pool = rows[:max(count * 4, len(rows) // 3)]
    pick = random.sample(pool, min(count, len(pool)))
    with _lock:
        _last[:] = [m["id"] for m in pick]
    return "Подборка (номера запомнил — можно спросить «расскажи про второй»):\n" + "\n".join(
        f"{i}. {short(m)}" for i, m in enumerate(pick, 1))


_ORDINALS = {"перв": 1, "втор": 2, "трет": 3, "четв": 4, "пят": 5, "шест": 6, "седьм": 7, "восьм": 8, "девят": 9,
             "десят": 10}


def resolve(memory, ref: str) -> dict | None:
    """«2», «второй», «номер 2» — из последней подборки; иначе поиск по названию («Легенда №17»)."""
    t = normalize(ref)
    m = re.fullmatch(r"(?:номер |фильм |под номером |№ ?)?(\d{1,2})(?:[- ]?(?:й|ой|ий|ая|ый))?", t)
    n = int(m.group(1)) if m else next((v for k, v in _ORDINALS.items() if re.fullmatch(rf"(номер )?{k}\w*", t)), 0)
    with _lock:
        last = list(_last)
    if n and 1 <= n <= len(last):
        rows = _rows(memory, f"SELECT {_COLS} FROM movies WHERE id=?", (last[n - 1],))
        return rows[0] if rows else None
    from rapidfuzz import fuzz, process
    rows = _rows(memory, f"SELECT {_COLS} FROM movies")
    if not rows:
        return None
    names = [normalize(f"{r['title']}") for r in rows]
    best = process.extractOne(t, names, scorer=fuzz.WRatio)
    if best and best[1] >= 80:
        return rows[best[2]]
    names = [normalize(r["orig"] or "") for r in rows]
    best = process.extractOne(t, names, scorer=fuzz.WRatio)
    return rows[best[2]] if best and best[1] >= 85 else None


def describe(m: dict) -> str:
    status = {"want": "в списке «хочу посмотреть»", "watched": "уже посмотрен", "skip": "в списке «не смотреть»"}
    parts = [short(m), status.get(m["status"], "")]
    if m.get("mine"):
        parts.append(f"ваша оценка {m['mine']:g}")
    for k, label in (("orig", "оригинал"), ("country", "страна"), ("genres", "жанры"), ("length", "длительность")):
        if m.get(k):
            parts.append(f"{label}: {m[k]}")
    if m.get("about"):
        parts.append(f"описание: {m['about']}")
    if m.get("note"):
        parts.append(f"заметка: {m['note']}")
    return "; ".join(p for p in parts if p)


def mark(memory, ref: str, status: str = "", rating: float | None = None, note: str = "") -> str:
    m = resolve(memory, ref)
    if not m:
        if status in ("want", "watched", "skip"):
            with memory._lock:
                memory.db.execute("INSERT OR IGNORE INTO movies(title, status, mine) VALUES (?, ?, ?)",
                                  (ref.strip(), status, rating))
                memory.db.commit()
            return f"Добавил «{ref.strip()}» в базу ({status})."
        return f"Не нашёл «{ref}» в базе"
    sets, args = [], []
    if status in ("want", "watched", "skip"):
        sets.append("status=?")
        args.append(status)
    if rating is not None:
        sets += ["mine=?", "status='watched'"]
        args.append(rating)
    if note:
        sets.append("note=?")
        args.append(note)
    if not sets:
        return "Что отметить: status (watched/want/skip), rating или note"
    with memory._lock:
        memory.db.execute(f"UPDATE movies SET {', '.join(sets)} WHERE id=?", (*args, m["id"]))
        memory.db.commit()
    return f"Отметил: {m['title']}."


def listing(memory, status: str = "want", limit: int = 10) -> str:
    rows = _rows(memory, f"SELECT {_COLS} FROM movies WHERE status=? ORDER BY COALESCE(mine, kp, 0) DESC LIMIT ?",
                 (status, limit))
    total = _rows(memory, "SELECT COUNT(*) AS n FROM movies WHERE status=?", (status,))[0]["n"]
    with _lock:
        _last[:] = [m["id"] for m in rows]
    return f"Всего {total}. " + "; ".join(f"{i}. {short(m)}" for i, m in enumerate(rows, 1)) if rows else "Пусто."
