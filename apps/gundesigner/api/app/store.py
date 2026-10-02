"""Saved designs in SQLite. Each design gets a short share code.

No user-written text is stored: names are generated from the parts, so the
public gallery can't fill up with rude words. Identical designs share one code.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"  # no 0/o, 1/l/i
CODE_LENGTH = 6
MAX_DESIGNS = 20000
SAVES_PER_HOUR = 30


class StoreError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class DesignStore:
    def __init__(self, db_file: Path):
        db_file.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_file, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        self.recent: dict[str, deque] = defaultdict(deque)  # in memory only, never written
        with self.lock, self.db:
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute(
                """CREATE TABLE IF NOT EXISTS designs (
                    code TEXT PRIMARY KEY,
                    hash TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    design TEXT NOT NULL,
                    created REAL NOT NULL
                )"""
            )
            self.db.execute("CREATE INDEX IF NOT EXISTS designs_created ON designs(created)")

    def check(self) -> int:
        with self.lock:
            return self.db.execute("SELECT COUNT(*) FROM designs").fetchone()[0]

    def _rate_limit(self, client: str) -> None:
        now = time.monotonic()
        q = self.recent[client]
        while q and now - q[0] > 3600:
            q.popleft()
        if len(q) >= SAVES_PER_HOUR:
            raise StoreError(429, "That's a lot of guns! Try again in a little while.")
        q.append(now)

    def save(self, design: dict, name: str, client: str) -> tuple[dict, bool]:
        """Save a checked design. Returns (row, created)."""
        blob = json.dumps(design, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(blob.encode()).hexdigest()
        with self.lock:
            row = self.db.execute("SELECT * FROM designs WHERE hash = ?", (digest,)).fetchone()
            if row:
                return self._out(row), False
            self._rate_limit(client)
            if self.db.execute("SELECT COUNT(*) FROM designs").fetchone()[0] >= MAX_DESIGNS:
                raise StoreError(507, "The gallery is full.")
            with self.db:
                for _ in range(10):
                    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
                    try:
                        self.db.execute(
                            "INSERT INTO designs (code, hash, name, design, created) VALUES (?, ?, ?, ?, ?)",
                            (code, digest, name, blob, time.time()),
                        )
                        break
                    except sqlite3.IntegrityError:
                        continue
                else:
                    raise StoreError(503, "couldn't pick a share code, try again")
            row = self.db.execute("SELECT * FROM designs WHERE code = ?", (code,)).fetchone()
            return self._out(row), True

    def get(self, code: str) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT * FROM designs WHERE code = ?", (code,)).fetchone()
        return self._out(row) if row else None

    def recent_designs(self, limit: int, base: str | None = None) -> list[dict]:
        sql, args = "SELECT * FROM designs", []
        if base:
            sql += " WHERE json_extract(design, '$.base') = ?"
            args.append(base)
        sql += " ORDER BY created DESC LIMIT ?"
        args.append(limit)
        with self.lock:
            rows = self.db.execute(sql, args).fetchall()
        return [self._out(r) for r in rows]

    @staticmethod
    def _out(row: sqlite3.Row) -> dict:
        return {
            "code": row["code"],
            "name": row["name"],
            "design": json.loads(row["design"]),
            "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row["created"])),
        }
