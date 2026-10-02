"""Runs (one play-through of every test chamber) and the fastest-times leaderboard, in SQLite.

The server keeps the clock. A client can only say "I finished the next chamber";
it can't skip chambers or pick its own times.
"""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
from contextlib import closing
from pathlib import Path

RUN_TTL_SECONDS = 6 * 60 * 60
MAX_OPEN_RUNS = 5000
MIN_SECONDS_PER_CHAMBER = 3.0
LEADERBOARD_SIZE = 10
NAME_MAX_LEN = 12

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]*$")
# Kept short on purpose; matched against letters only, so "b-a-d" still counts.
BLOCKED_WORDS = (
    "fuck", "shit", "bitch", "cunt", "dick", "piss", "wank", "twat", "slut",
    "whore", "nigg", "fag", "rape", "nazi", "hitler", "penis", "vagina", "porn",
    "sex", "arse", "asshole", "bastard", "crap", "damn", "poop", "kill",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id          TEXT PRIMARY KEY,
    created     REAL NOT NULL,
    levels      TEXT NOT NULL,             -- JSON list of level ids, in order
    done        INTEGER NOT NULL DEFAULT 0, -- how many chambers are finished
    last_time   REAL NOT NULL,             -- when the current chamber started
    splits      TEXT NOT NULL DEFAULT '[]', -- JSON list of seconds per chamber
    finished_at REAL,
    on_board    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS leaderboard (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    seconds   REAL NOT NULL,
    chambers  INTEGER NOT NULL,
    created   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS leaderboard_time ON leaderboard (chambers DESC, seconds ASC, created ASC);
CREATE INDEX IF NOT EXISTS runs_created ON runs (created);
"""


class RunError(Exception):
    """A problem the player caused; `status` is the HTTP status to answer with."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def clean_name(raw: object) -> str:
    if not isinstance(raw, str):
        raise RunError(422, "name must be text")
    name = " ".join(unicodedata.normalize("NFKC", raw).split())
    if not 1 <= len(name) <= NAME_MAX_LEN:
        raise RunError(422, f"name must be 1-{NAME_MAX_LEN} characters")
    if not NAME_RE.fullmatch(name):
        raise RunError(422, "name can only use letters, numbers, spaces, - and _")
    letters = re.sub(r"[^a-z]", "", name.lower().replace("0", "o").replace("1", "i").replace("3", "e").replace("5", "s"))
    if any(word in letters for word in BLOCKED_WORDS):
        raise RunError(422, "please pick a different name")
    return name


class RunStore:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._lock = threading.Lock()
        with closing(self._connect()) as db:
            db.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=10000")
        return db

    def check(self) -> None:
        with closing(self._connect()) as db:
            db.execute("SELECT 1 FROM runs LIMIT 1").fetchall()

    def _get(self, db: sqlite3.Connection, run_id: str, now: float) -> sqlite3.Row:
        row = db.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if row is None or row["created"] < now - RUN_TTL_SECONDS:
            raise RunError(404, "run not found (it may have expired)")
        return row

    def new_run(self, level_ids: list[str], now: float | None = None) -> dict:
        now = time.time() if now is None else now
        if not level_ids:
            raise RunError(503, "no test chambers available")
        run_id = secrets.token_urlsafe(16)
        with self._lock, closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM runs WHERE created < ?", (now - RUN_TTL_SECONDS,))
            (open_runs,) = db.execute("SELECT COUNT(*) FROM runs").fetchone()
            if open_runs >= MAX_OPEN_RUNS:
                db.execute("ROLLBACK")
                raise RunError(503, "too many test subjects right now, try again soon")
            db.execute("INSERT INTO runs (id, created, levels, last_time) VALUES (?, ?, ?, ?)",
                       (run_id, now, json.dumps(level_ids), now))
            db.execute("COMMIT")
        return {"run_id": run_id, "levels": level_ids}

    def complete(self, run_id: str, level_id: str, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        with self._lock, closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                r = self._get(db, run_id, now)
                levels = json.loads(r["levels"])
                done = r["done"]
                if done >= len(levels):
                    raise RunError(409, "this run is already finished")
                if level_id != levels[done]:
                    raise RunError(409, f"the next chamber is '{levels[done]}', not '{level_id}'")
                took = now - r["last_time"]
                if took < MIN_SECONDS_PER_CHAMBER:
                    raise RunError(409, "that was impossibly fast")
                splits = json.loads(r["splits"]) + [round(took, 2)]
                done += 1
                finished = done >= len(levels)
                db.execute("UPDATE runs SET done = ?, last_time = ?, splits = ?, finished_at = ? WHERE id = ?",
                           (done, now, json.dumps(splits), now if finished else None, run_id))
                db.execute("COMMIT")
            except BaseException:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise
        return {
            "level": level_id,
            "seconds": round(took, 2),
            "total_seconds": round(now - r["created"], 2),
            "done": done,
            "next": None if finished else levels[done],
            "finished": finished,
        }

    def finish(self, run_id: str, name: object, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        name = clean_name(name)
        with self._lock, closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                r = self._get(db, run_id, now)
                levels = json.loads(r["levels"])
                if r["finished_at"] is None:
                    raise RunError(409, "finish every test chamber first")
                if r["on_board"]:
                    raise RunError(409, "this run is already on the leaderboard")
                seconds = round(r["finished_at"] - r["created"], 2)
                db.execute("UPDATE runs SET on_board = 1 WHERE id = ?", (run_id,))
                cur = db.execute("INSERT INTO leaderboard (name, seconds, chambers, created) VALUES (?, ?, ?, ?)",
                                 (name, seconds, len(levels), now))
                (rank,) = db.execute(
                    "SELECT COUNT(*) + 1 FROM leaderboard WHERE chambers > ? OR (chambers = ? AND seconds < ?)"
                    " OR (chambers = ? AND seconds = ? AND created < ?)",
                    (len(levels), len(levels), seconds, len(levels), seconds, now),
                ).fetchone()
                db.execute("COMMIT")
            except BaseException:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise
        return {"id": cur.lastrowid, "name": name, "seconds": seconds, "rank": rank}

    def leaderboard(self, limit: int = LEADERBOARD_SIZE) -> list[dict]:
        with closing(self._connect()) as db:
            rows = db.execute(
                "SELECT name, seconds, chambers, created FROM leaderboard"
                " ORDER BY chambers DESC, seconds ASC, created ASC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "rank": i + 1,
                "name": r["name"],
                "seconds": r["seconds"],
                "chambers": r["chambers"],
                "date": time.strftime("%Y-%m-%d", time.gmtime(r["created"])),
            }
            for i, r in enumerate(rows)
        ]
