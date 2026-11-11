"""Finished matches and the leaderboard (SQLite).

The browser plays the match, so the server can't watch it. It only checks that the numbers
make sense (see `main.py`), limits how fast scores can arrive, and keeps the table small.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from collections import deque
from pathlib import Path

TARGET_SCORE = 7
LEADERBOARD_SIZE = 10
MAX_ROWS = 500
MAX_PER_MINUTE = 20
DIFFICULTY_RANK = {"easy": 0, "normal": 1, "hard": 2}


class MatchError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


class MatchStore:
    def __init__(self, path: Path) -> None:
        self._lock = threading.Lock()
        self._recent: deque[float] = deque()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS matches (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 name TEXT NOT NULL,
                 difficulty TEXT NOT NULL,
                 player_score INTEGER NOT NULL,
                 ai_score INTEGER NOT NULL,
                 seconds REAL NOT NULL,
                 powerups INTEGER NOT NULL,
                 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
               )"""
        )
        self._db.commit()

    def check(self) -> None:
        with self._lock:
            self._db.execute("SELECT 1 FROM matches LIMIT 1").fetchall()

    def add(self, name: str, difficulty: str, player_score: int, ai_score: int, seconds: float,
            powerups: bool) -> dict:
        with self._lock:
            now = time.monotonic()
            while self._recent and now - self._recent[0] > 60:
                self._recent.popleft()
            if len(self._recent) >= MAX_PER_MINUTE:
                raise MatchError("too many scores at once, try again in a minute", 429)
            self._recent.append(now)
            cur = self._db.execute(
                "INSERT INTO matches (name, difficulty, player_score, ai_score, seconds, powerups)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (name, difficulty, player_score, ai_score, round(seconds, 1), int(powerups)),
            )
            self._db.execute(
                "DELETE FROM matches WHERE id NOT IN (SELECT id FROM matches ORDER BY id DESC LIMIT ?)",
                (MAX_ROWS,),
            )
            self._db.commit()
            return {"id": cur.lastrowid, "rank": self._rank(cur.lastrowid)}

    def _rows(self) -> list[sqlite3.Row]:
        rows = self._db.execute("SELECT * FROM matches").fetchall()
        # Best first: harder computer, then a bigger winning margin, then a faster win.
        return sorted(
            rows,
            key=lambda r: (-DIFFICULTY_RANK[r["difficulty"]], -(r["player_score"] - r["ai_score"]),
                           r["seconds"], r["id"]),
        )

    def _rank(self, match_id: int) -> int:
        for i, row in enumerate(self._rows(), start=1):
            if row["id"] == match_id:
                return i
        return 0

    def leaderboard(self, limit: int) -> list[dict]:
        with self._lock:
            rows = self._rows()[:limit]
        return [
            {
                "rank": i,
                "name": r["name"],
                "difficulty": r["difficulty"],
                "score": f"{r['player_score']}-{r['ai_score']}",
                "seconds": r["seconds"],
                "powerups": bool(r["powerups"]),
                "date": r["created_at"][:10],
            }
            for i, r in enumerate(rows, start=1)
        ]
