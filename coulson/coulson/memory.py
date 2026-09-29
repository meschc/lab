"""Долговременная память — «второй мозг»: факты, заметки/задачи и журнал всех разговоров (SQLite).

Поиск гибридный: по смыслу (векторы qwen3-embedding через Ollama) + по словам (FTS5), результаты
сливаются (RRF). Векторы считаются в фоне; если модели эмбеддингов нет — работает поиск по словам.
"""
from __future__ import annotations

import logging
import queue
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from rapidfuzz import fuzz

log = logging.getLogger(__name__)

QUERY_INSTRUCT = "Instruct: Найди записи, относящиеся к запросу пользователя\nQuery: "


@dataclass
class Hit:
    kind: str      # fact | note | task | user | assistant
    id: int
    text: str
    ts: float
    score: float = 0.0
    sim: float = 0.0
    title: str = ""
    tags: str = ""
    done: bool = False

    def line(self) -> str:
        when = time.strftime("%d.%m.%Y %H:%M", time.localtime(self.ts))
        if self.kind == "fact":
            return f"Факт: {self.text}"
        if self.kind in ("note", "task"):
            mark = ("✓ " if self.done else "☐ ") if self.kind == "task" else ""
            head = f"{self.title}: " if self.title else ""
            tags = f" #{self.tags.replace(',', ' #')}" if self.tags else ""
            return f"[{'задача' if self.kind == 'task' else 'заметка'} {self.id}, {when}] {mark}{head}{self.text}{tags}"
        who = "Пользователь" if self.kind == "user" else "Колсон"
        return f"[разговор {when}] {who}: {self.text[:300]}"


class Embedder:
    """Эмбеддинги через Ollama. Если модель недоступна — тихо выключается и пробует снова позже."""

    def __init__(self, host: str, model: str, keep_alive="60m"):
        import ollama

        self.model = model
        self.keep_alive = keep_alive
        self.client = ollama.Client(host=host, timeout=30)
        self._retry_at = 0.0

    @property
    def available(self) -> bool:
        return time.monotonic() >= self._retry_at

    def embed(self, texts: list[str], query: bool = False) -> np.ndarray | None:
        if not texts or not self.available:
            return None
        try:
            inp = [QUERY_INSTRUCT + t if query else t for t in texts]
            r = self.client.embed(model=self.model, input=inp, keep_alive=self.keep_alive)
            m = np.asarray(r.embeddings, dtype=np.float32)
            return m / np.maximum(np.linalg.norm(m, axis=1, keepdims=True), 1e-9)
        except Exception as e:
            log.warning("Эмбеддинги недоступны (%s) — пока ищу только по словам", e)
            self._retry_at = time.monotonic() + 60
            return None


_TABLES = {"facts": "text", "log": "text", "notes": "title || ' ' || text || ' ' || tags"}


class Memory:
    def __init__(self, path: Path, embedder: Embedder | None = None):
        self._lock = threading.RLock()
        self.embedder = embedder
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY, text TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, ts REAL NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY, created REAL NOT NULL, updated REAL NOT NULL,
                kind TEXT NOT NULL DEFAULT 'note', title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0);
            """
        )
        for table in _TABLES:  # миграция старых баз: колонка для вектора
            cols = [r[1] for r in self.db.execute(f"PRAGMA table_info({table})")]
            if "emb" not in cols:
                self.db.execute(f"ALTER TABLE {table} ADD COLUMN emb BLOB")
        self.fts = True
        try:
            self.db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS log_fts USING fts5(text, content='log', content_rowid='id')")
            self.db.execute("CREATE TRIGGER IF NOT EXISTS log_ai AFTER INSERT ON log BEGIN "
                            "INSERT INTO log_fts(rowid, text) VALUES (new.id, new.text); END")
            self.db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(body)")
        except sqlite3.OperationalError:
            self.fts = False
        self.db.commit()
        self._vec_cache: dict[str, tuple[np.ndarray, np.ndarray] | None] = {}
        self._jobs: queue.Queue[tuple[str, int, str]] = queue.Queue()
        if embedder is not None:
            threading.Thread(target=self._embed_worker, daemon=True, name="embed").start()
            threading.Thread(target=self.backfill, daemon=True, name="embed-backfill").start()

    # ------------------------------------------------------------ векторы
    def _enqueue(self, table: str, row_id: int, text: str) -> None:
        if self.embedder is not None and text.strip():
            self._jobs.put((table, row_id, text))

    def _embed_worker(self) -> None:
        while True:
            batch = [self._jobs.get()]
            while len(batch) < 32 and not self._jobs.empty():
                batch.append(self._jobs.get_nowait())
            vecs = self.embedder.embed([t for _, _, t in batch])
            if vecs is None:
                time.sleep(60)  # модель недоступна — вернём задания и подождём
                for job in batch:
                    self._jobs.put(job)
                continue
            with self._lock:
                for (table, row_id, _), v in zip(batch, vecs):
                    self.db.execute(f"UPDATE {table} SET emb=? WHERE id=?", (v.tobytes(), row_id))
                    cached = self._vec_cache.get(table)
                    if table == "log" and cached is not None and row_id not in set(cached[0][-64:]):
                        # журнал только растёт — дописываем в кэш, а не перечитываем тысячи строк из базы
                        self._vec_cache[table] = (np.append(cached[0], row_id), np.vstack([cached[1], v]))
                    else:
                        self._vec_cache.pop(table, None)
                self.db.commit()

    def backfill(self, limit: int = 20000) -> None:
        """Досчитать векторы для записей без них (после обновления или пока модель была недоступна)."""
        for table, expr in _TABLES.items():
            with self._lock:
                rows = self.db.execute(f"SELECT id, {expr} FROM {table} WHERE emb IS NULL ORDER BY id DESC LIMIT ?",
                                       (limit,)).fetchall()
            for row_id, text in rows:
                self._enqueue(table, row_id, text)

    def wait_embedded(self, timeout: float = 30) -> None:
        end = time.monotonic() + timeout
        while not self._jobs.empty() and time.monotonic() < end:
            time.sleep(0.05)
        time.sleep(0.1)

    def _vectors(self, table: str) -> tuple[np.ndarray, np.ndarray] | None:
        with self._lock:
            if table not in self._vec_cache:
                rows = self.db.execute(f"SELECT id, emb FROM {table} WHERE emb IS NOT NULL").fetchall()
                if rows:
                    ids = np.array([r[0] for r in rows])
                    mat = np.stack([np.frombuffer(r[1], dtype=np.float32) for r in rows])
                    self._vec_cache[table] = (ids, mat)
                else:
                    self._vec_cache[table] = None
            return self._vec_cache[table]

    # ------------------------------------------------------------ факты
    def add_fact(self, text: str, supersede_sim: float = 0.85) -> str:
        """Новый факт заменяет старый близкий по смыслу («любимая игра — Дота» → «…— CS2»), а не копится рядом."""
        text = text.strip()
        vec = self.embedder.embed([text]) if self.embedder else None
        if vec is not None and (vecs := self._vectors("facts")) is not None:
            ids, mat = vecs
            sims = mat @ vec[0]
            best = int(np.argmax(sims))
            if sims[best] >= supersede_sim:
                fid = int(ids[best])
                old = dict(self.facts()).get(fid, "")
                with self._lock:
                    self.db.execute("UPDATE facts SET text=?, created=?, emb=? WHERE id=?",
                                    (text, time.time(), vec[0].tobytes(), fid))
                    self.db.commit()
                    self._vec_cache.pop("facts", None)
                return f"Обновил в памяти (было: «{old}»)." if old and old != text else "Обновил в памяти."
        for fid, existing in self.facts():
            if fuzz.token_set_ratio(existing.lower(), text.lower()) >= 90:
                with self._lock:
                    self.db.execute("UPDATE facts SET text=?, created=?, emb=NULL WHERE id=?", (text, time.time(), fid))
                    self.db.commit()
                self._enqueue("facts", fid, text)
                return "Обновил в памяти."
        with self._lock:
            cur = self.db.execute("INSERT INTO facts(text, created, emb) VALUES (?, ?, ?)",
                                  (text, time.time(), vec[0].tobytes() if vec is not None else None))
            self.db.commit()
            self._vec_cache.pop("facts", None)
        if vec is None:
            self._enqueue("facts", cur.lastrowid, text)
        return "Запомнил."

    def facts_dated(self, limit: int = 200) -> list[tuple[int, str, float]]:
        with self._lock:
            return self.db.execute("SELECT id, text, created FROM facts ORDER BY created DESC LIMIT ?",
                                   (limit,)).fetchall()

    def facts(self, limit: int = 200) -> list[tuple[int, str]]:
        with self._lock:
            return self.db.execute("SELECT id, text FROM facts ORDER BY created DESC LIMIT ?", (limit,)).fetchall()

    def forget(self, query: str) -> str:
        scored = sorted(((fuzz.partial_ratio(query.lower(), t.lower()), fid, t) for fid, t in self.facts()), reverse=True)
        if not scored or scored[0][0] < 70:
            return "Такого в памяти не нашёл."
        _, fid, text = scored[0]
        with self._lock:
            self.db.execute("DELETE FROM facts WHERE id=?", (fid,))
            self.db.commit()
            self._vec_cache.pop("facts", None)
        return f"Забыл: {text}"

    # ------------------------------------------------------------ журнал
    def log(self, role: str, text: str) -> None:
        if not text.strip():
            return
        with self._lock:
            cur = self.db.execute("INSERT INTO log(ts, role, text) VALUES (?, ?, ?)", (time.time(), role, text))
            self.db.commit()
        self._enqueue("log", cur.lastrowid, text)

    # ------------------------------------------------------------ заметки и задачи
    def _index_note(self, note_id: int) -> None:
        with self._lock:
            row = self.db.execute("SELECT title || ' ' || text || ' ' || tags FROM notes WHERE id=?", (note_id,)).fetchone()
            if self.fts:
                self.db.execute("DELETE FROM notes_fts WHERE rowid=?", (note_id,))
                if row:
                    self.db.execute("INSERT INTO notes_fts(rowid, body) VALUES (?, ?)", (note_id, row[0]))
            self.db.execute("UPDATE notes SET emb=NULL WHERE id=?", (note_id,))
            self.db.commit()
            self._vec_cache.pop("notes", None)
        if row:
            self._enqueue("notes", note_id, row[0])

    def add_note(self, text: str, title: str = "", tags: str = "", kind: str = "note") -> int:
        now = time.time()
        tags = ",".join(t.strip().lstrip("#") for t in tags.split(",") if t.strip()) if tags else ""
        with self._lock:
            cur = self.db.execute("INSERT INTO notes(created, updated, kind, title, text, tags) VALUES (?,?,?,?,?,?)",
                                  (now, now, "task" if kind == "task" else "note", title.strip(), text.strip(), tags))
            self.db.commit()
        self._index_note(cur.lastrowid)
        return cur.lastrowid

    def get_note(self, note_id: int) -> Hit | None:
        with self._lock:
            r = self.db.execute("SELECT id, kind, title, text, tags, done, updated FROM notes WHERE id=?",
                                (note_id,)).fetchone()
        return Hit(r[1], r[0], r[3], r[6], title=r[2], tags=r[4], done=bool(r[5])) if r else None

    def update_note(self, note_id: int, text: str | None = None, tags: str | None = None,
                    done: bool | None = None, append: bool = False) -> bool:
        note = self.get_note(note_id)
        if note is None:
            return False
        new_text = (note.text + "\n" + text.strip()) if (append and text) else (text.strip() if text else note.text)
        with self._lock:
            self.db.execute("UPDATE notes SET text=?, tags=?, done=?, updated=? WHERE id=?",
                            (new_text, tags if tags is not None else note.tags,
                             int(done) if done is not None else int(note.done), time.time(), note_id))
            self.db.commit()
        self._index_note(note_id)
        return True

    def delete_note(self, note_id: int) -> bool:
        with self._lock:
            n = self.db.execute("DELETE FROM notes WHERE id=?", (note_id,)).rowcount
            if self.fts:
                self.db.execute("DELETE FROM notes_fts WHERE rowid=?", (note_id,))
            self.db.commit()
            self._vec_cache.pop("notes", None)
        return bool(n)

    def list_notes(self, kind: str | None = None, open_only: bool = False, tag: str = "", limit: int = 15) -> list[Hit]:
        sql = "SELECT id, kind, title, text, tags, done, updated FROM notes WHERE 1=1"
        args: list = []
        if kind:
            sql += " AND kind=?"
            args.append(kind)
        if open_only:
            sql += " AND done=0"
        if tag:
            sql += " AND (',' || tags || ',') LIKE ?"
            args.append(f"%,{tag.strip().lstrip('#')},%")
        sql += " ORDER BY done, updated DESC LIMIT ?"
        args.append(limit)
        with self._lock:
            rows = self.db.execute(sql, args).fetchall()
        return [Hit(r[1], r[0], r[3], r[6], title=r[2], tags=r[4], done=bool(r[5])) for r in rows]

    # ------------------------------------------------------------ поиск
    def _load(self, table: str, ids: list[int]) -> dict[int, Hit]:
        if not ids:
            return {}
        q = ",".join("?" * len(ids))
        with self._lock:
            if table == "facts":
                rows = self.db.execute(f"SELECT id, text, created FROM facts WHERE id IN ({q})", ids).fetchall()
                return {r[0]: Hit("fact", r[0], r[1], r[2]) for r in rows}
            if table == "log":
                rows = self.db.execute(f"SELECT id, role, text, ts FROM log WHERE id IN ({q})", ids).fetchall()
                return {r[0]: Hit("user" if r[1] == "user" else "assistant", r[0], r[2], r[3]) for r in rows}
            rows = self.db.execute(f"SELECT id, kind, title, text, tags, done, updated FROM notes WHERE id IN ({q})",
                                   ids).fetchall()
            return {r[0]: Hit(r[1], r[0], r[3], r[6], title=r[2], tags=r[4], done=bool(r[5])) for r in rows}

    def _keyword(self, table: str, query: str, limit: int) -> list[int]:
        words = [w for w in query.replace('"', " ").split() if len(w) > 2]
        with self._lock:
            if table == "facts":
                scored = sorted(((fuzz.partial_ratio(query.lower(), t.lower()), i) for i, t in self.facts()), reverse=True)
                return [i for s, i in scored[:limit] if s >= 60]
            if self.fts and words:
                terms = " OR ".join(f'"{w[:-1] if len(w) > 5 else w}"*' for w in words)  # грубая «основа» слова
                fts, col = ("log_fts", "log_fts") if table == "log" else ("notes_fts", "notes_fts")
                try:
                    return [r[0] for r in self.db.execute(
                        f"SELECT rowid FROM {fts} WHERE {col} MATCH ? ORDER BY rank LIMIT ?", (terms, limit))]
                except sqlite3.OperationalError:
                    pass
            col = "text" if table == "log" else "title || ' ' || text || ' ' || tags"
            return [r[0] for r in self.db.execute(
                f"SELECT id FROM {table} WHERE {col} LIKE ? ORDER BY id DESC LIMIT ?", (f"%{query}%", limit))]

    def search(self, query: str, kinds: tuple[str, ...] = ("facts", "notes", "log"), limit: int = 8,
               exclude_after: float | None = None) -> list[Hit]:
        """Гибридный поиск: по смыслу + по словам, слияние рангов (RRF)."""
        qv = self.embedder.embed([query], query=True) if self.embedder else None
        scores: dict[tuple[str, int], float] = {}
        sims: dict[tuple[str, int], float] = {}
        for table in kinds:
            if qv is not None and (vecs := self._vectors(table)) is not None:
                ids, mat = vecs
                s = mat @ qv[0]
                for rank, idx in enumerate(np.argsort(-s)[:limit * 3]):
                    key = (table, int(ids[idx]))
                    sims[key] = float(s[idx])
                    scores[key] = scores.get(key, 0) + 1 / (60 + rank)
            for rank, row_id in enumerate(self._keyword(table, query, limit * 3)):
                key = (table, row_id)
                scores[key] = scores.get(key, 0) + 1 / (60 + rank)
        by_table: dict[str, list[int]] = {}
        for table, row_id in scores:
            by_table.setdefault(table, []).append(row_id)
        loaded = {(t, i): h for t, ids in by_table.items() for i, h in self._load(t, ids).items()}
        hits = []
        for key, score in sorted(scores.items(), key=lambda kv: -kv[1]):
            h = loaded.get(key)
            if h is None or (exclude_after and key[0] == "log" and h.ts > exclude_after):
                continue
            h.score, h.sim = score, sims.get(key, 0.0)
            hits.append(h)
            if len(hits) >= limit:
                break
        return hits

    def relevant(self, query: str, k: int = 3, min_sim: float = 0.55, exclude_after: float | None = None) -> list[Hit]:
        """Только уверенные совпадения по смыслу — для автоподсказок к каждой команде."""
        if not self.embedder:
            return []
        return [h for h in self.search(query, limit=k * 2, exclude_after=exclude_after) if h.sim >= min_sim][:k]

    def recall(self, query: str) -> str:
        hits = self.search(query)
        return "\n".join(h.line() for h in hits) or "Ничего не нашёл в памяти."


def open_memory(cfg, data_dir: Path) -> Memory:
    m = cfg.get("memory", {}) or {}
    model = m.get("embed_model")
    embedder = Embedder(cfg.llm.host, model, cfg.llm.keep_alive) if model else None
    return Memory(data_dir / "memory.db", embedder)
