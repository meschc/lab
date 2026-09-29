"""Долговременная память: факты о пользователе и журнал всех разговоров (SQLite + FTS5)."""
from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

from rapidfuzz import fuzz


class Memory:
    def __init__(self, path: Path):
        self._lock = threading.Lock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY, text TEXT NOT NULL, created REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY, ts REAL NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL);
            """
        )
        try:
            self.db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS log_fts USING fts5(text, content='log', content_rowid='id')")
            self.db.execute(
                "CREATE TRIGGER IF NOT EXISTS log_ai AFTER INSERT ON log BEGIN "
                "INSERT INTO log_fts(rowid, text) VALUES (new.id, new.text); END"
            )
            self.fts = True
        except sqlite3.OperationalError:
            self.fts = False
        self.db.commit()

    # ------------------------------------------------------------ факты
    def add_fact(self, text: str) -> str:
        text = text.strip()
        for fid, existing in self.facts():
            if fuzz.token_set_ratio(existing.lower(), text.lower()) >= 90:
                with self._lock:
                    self.db.execute("UPDATE facts SET text=?, created=? WHERE id=?", (text, time.time(), fid))
                    self.db.commit()
                return "Обновил в памяти."
        with self._lock:
            self.db.execute("INSERT INTO facts(text, created) VALUES (?, ?)", (text, time.time()))
            self.db.commit()
        return "Запомнил."

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
        return f"Забыл: {text}"

    # ------------------------------------------------------------ журнал
    def log(self, role: str, text: str) -> None:
        with self._lock:
            self.db.execute("INSERT INTO log(ts, role, text) VALUES (?, ?, ?)", (time.time(), role, text))
            self.db.commit()

    def search(self, query: str, limit: int = 8) -> list[tuple[float, str, str]]:
        with self._lock:
            if self.fts:
                terms = " OR ".join(f'"{w}"*' for w in query.replace('"', " ").split() if len(w) > 2)
                if terms:
                    try:
                        return self.db.execute(
                            "SELECT log.ts, log.role, log.text FROM log_fts JOIN log ON log.id = log_fts.rowid "
                            "WHERE log_fts MATCH ? ORDER BY rank LIMIT ?", (terms, limit)).fetchall()
                    except sqlite3.OperationalError:
                        pass
            return self.db.execute("SELECT ts, role, text FROM log WHERE text LIKE ? ORDER BY ts DESC LIMIT ?",
                                   (f"%{query}%", limit)).fetchall()

    def recall(self, query: str) -> str:
        facts = [t for _, t in self.facts() if fuzz.partial_ratio(query.lower(), t.lower()) >= 60]
        lines = [f"Факт: {t}" for t in facts[:10]]
        for ts, role, text in self.search(query):
            when = time.strftime("%d.%m %H:%M", time.localtime(ts))
            lines.append(f"[{when}] {'Пользователь' if role == 'user' else 'Колсон'}: {text[:300]}")
        return "\n".join(lines) or "Ничего не нашёл в памяти."
