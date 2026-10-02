"""A small SQLite cache of JSON (charts, lookups, parsed feeds). No audio, no visitor data."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

MAX_ROWS = 3000


class Cache:
    def __init__(self, db_file: Path):
        db_file.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_file, check_same_thread=False)
        self.lock = threading.Lock()
        with self.lock, self.db:
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute(
                "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched REAL NOT NULL)"
            )
            self.db.execute("CREATE INDEX IF NOT EXISTS cache_fetched ON cache(fetched)")
        self.writes = 0

    def get(self, key: str) -> tuple[object, float] | None:
        """(value, fetched time) or None."""
        with self.lock:
            row = self.db.execute("SELECT value, fetched FROM cache WHERE key = ?", (key,)).fetchone()
        return (json.loads(row[0]), row[1]) if row else None

    def put(self, key: str, value: object, fetched: float | None = None) -> float:
        fetched = time.time() if fetched is None else fetched
        blob = json.dumps(value, separators=(",", ":"))
        with self.lock, self.db:
            self.db.execute(
                "INSERT INTO cache (key, value, fetched) VALUES (?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched = excluded.fetched",
                (key, blob, fetched),
            )
            self.writes += 1
            if self.writes % 100 == 0:
                self.db.execute(
                    "DELETE FROM cache WHERE key NOT IN (SELECT key FROM cache ORDER BY fetched DESC LIMIT ?)",
                    (MAX_ROWS,),
                )
        return fetched

    def count(self) -> int:
        with self.lock:
            return self.db.execute("SELECT COUNT(*) FROM cache").fetchone()[0]
