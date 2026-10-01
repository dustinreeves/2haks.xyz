"""SQLite storage for shared levels. Standard library only."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from .levels import canonical_json, new_code, random_name

SCHEMA = """
CREATE TABLE IF NOT EXISTS levels (
    code       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    boss       TEXT NOT NULL,
    data       TEXT NOT NULL,
    digest     TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS levels_created ON levels (created_at);
"""


class StoreFull(Exception):
    """The level limit has been reached."""


def _summary(row: sqlite3.Row) -> dict:
    return {"code": row["code"], "name": row["name"], "boss": row["boss"], "created_at": row["created_at"]}


class LevelStore:
    def __init__(self, path: str | Path, max_levels: int) -> None:
        self.path = str(path)
        self.max_levels = max_levels
        with closing(self._connect()) as db, db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def add(self, level: dict) -> tuple[dict, bool]:
        """Store a validated level. Returns (summary, created); identical levels share one code."""
        data = canonical_json(level)
        digest = hashlib.sha256(data.encode()).hexdigest()
        with closing(self._connect()) as db, db:
            row = db.execute("SELECT * FROM levels WHERE digest = ?", (digest,)).fetchone()
            if row:
                return _summary(row), False
            (count,) = db.execute("SELECT COUNT(*) FROM levels").fetchone()
            if count >= self.max_levels:
                raise StoreFull()
            created_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
            for _ in range(10):
                code = new_code()
                try:
                    db.execute(
                        "INSERT INTO levels (code, name, boss, data, digest, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                        (code, random_name(), level["boss"], data, digest, created_at),
                    )
                except sqlite3.IntegrityError as e:
                    if "digest" in str(e):  # someone shared the same level at the same moment
                        row = db.execute("SELECT * FROM levels WHERE digest = ?", (digest,)).fetchone()
                        return _summary(row), False
                    continue  # code already taken, try another
                row = db.execute("SELECT * FROM levels WHERE code = ?", (code,)).fetchone()
                return _summary(row), True
        raise RuntimeError("could not find a free level code")

    def get(self, code: str) -> dict | None:
        with closing(self._connect()) as db:
            row = db.execute("SELECT * FROM levels WHERE code = ?", (code,)).fetchone()
        if not row:
            return None
        return {**_summary(row), "level": json.loads(row["data"])}

    def recent(self, limit: int) -> list[dict]:
        with closing(self._connect()) as db:
            rows = db.execute("SELECT * FROM levels ORDER BY created_at DESC, rowid DESC LIMIT ?", (limit,)).fetchall()
        return [_summary(r) for r in rows]

    def count(self) -> int:
        with closing(self._connect()) as db:
            return db.execute("SELECT COUNT(*) FROM levels").fetchone()[0]
