"""Game sessions and the leaderboard, stored in SQLite.

The server keeps the right answers. A client only ever learns whether a choice
was right, so peeking at the browser's network traffic doesn't give answers away.
"""

from __future__ import annotations

import json
import random
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from .questions import NUM_CHOICES, Question

ROUNDS_PER_GAME = 10
GAME_TTL_SECONDS = 2 * 60 * 60
MAX_OPEN_GAMES = 5000
LEADERBOARD_SIZE = 10
NAME_MAX_LEN = 12

# Points for a right answer after 0, 1, 2 or 3 wrong tries in the same round.
BASE_POINTS = (100, 50, 25, 0)
# First-try speed bonus: 50 points, minus 2.5 per second (gone after 20 s).
SPEED_BONUS_MAX = 50
SPEED_BONUS_PER_SECOND = 2.5

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]*$")
# Kept short on purpose; matched against letters only, so "b-a-d" still counts.
BLOCKED_WORDS = (
    "fuck", "shit", "bitch", "cunt", "dick", "piss", "wank", "twat", "slut",
    "whore", "nigg", "fag", "rape", "nazi", "hitler", "penis", "vagina", "porn",
    "sex", "arse", "asshole", "bastard", "crap", "damn", "poop", "kill",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    id            TEXT PRIMARY KEY,
    created       REAL NOT NULL,
    category      TEXT,
    rounds        TEXT NOT NULL,   -- JSON list of {id, category, question, choices, answer}
    current       INTEGER NOT NULL DEFAULT 0,
    tried         INTEGER NOT NULL DEFAULT 0,  -- bitmask of wrong choices this round
    round_started REAL NOT NULL,
    score         INTEGER NOT NULL DEFAULT 0,
    correct_first INTEGER NOT NULL DEFAULT 0,
    finished      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS leaderboard (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    score     INTEGER NOT NULL,
    rounds    INTEGER NOT NULL,
    category  TEXT,
    created   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS leaderboard_score ON leaderboard (score DESC, created ASC);
CREATE INDEX IF NOT EXISTS games_created ON games (created);
"""


class GameError(Exception):
    """A problem the player caused; `status` is the HTTP status to answer with."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class AnswerResult:
    correct: bool
    points: int
    score: int
    round: int          # the round that was answered (0-based)
    finished: bool
    correct_first: int


def clean_name(raw: object) -> str:
    if not isinstance(raw, str):
        raise GameError(422, "name must be text")
    name = " ".join(unicodedata.normalize("NFKC", raw).split())
    if not 1 <= len(name) <= NAME_MAX_LEN:
        raise GameError(422, f"name must be 1-{NAME_MAX_LEN} characters")
    if not NAME_RE.fullmatch(name):
        raise GameError(422, "name can only use letters, numbers, spaces, - and _")
    letters = re.sub(r"[^a-z]", "", name.lower().replace("0", "o").replace("1", "i").replace("3", "e").replace("5", "s"))
    if any(word in letters for word in BLOCKED_WORDS):
        raise GameError(422, "please pick a different name")
    return name


def points_for(wrong_tries: int, seconds: float) -> int:
    points = BASE_POINTS[min(wrong_tries, len(BASE_POINTS) - 1)]
    if wrong_tries == 0:
        points += max(0, int(SPEED_BONUS_MAX - SPEED_BONUS_PER_SECOND * max(0.0, seconds)))
    return points


def public_round(r: dict) -> dict:
    """A round without its answer, safe to send to the player."""
    return {"id": r["id"], "category": r["category"], "question": r["question"], "choices": r["choices"]}


class GameStore:
    def __init__(self, db_path: Path, rng: random.Random | None = None):
        self.db_path = db_path
        self.rng = rng or random.SystemRandom()
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
            db.execute("SELECT 1 FROM games LIMIT 1").fetchall()

    # ----- games -----

    def new_game(self, bank: list[Question], category: str | None, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        pool = [q for q in bank if category is None or q.category.casefold() == category.casefold()]
        if not pool:
            raise GameError(404, f"no questions in category '{category}'")
        picked = self.rng.sample(pool, min(ROUNDS_PER_GAME, len(pool)))
        rounds = []
        for q in picked:
            order = list(range(NUM_CHOICES))
            self.rng.shuffle(order)
            rounds.append({
                "id": q.id,
                "category": q.category,
                "question": q.question,
                "choices": [q.choices[i] for i in order],
                "answer": order.index(q.answer),
            })
        game_id = secrets.token_urlsafe(16)
        with self._lock, closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM games WHERE created < ?", (now - GAME_TTL_SECONDS,))
            (open_games,) = db.execute("SELECT COUNT(*) FROM games").fetchone()
            if open_games >= MAX_OPEN_GAMES:
                db.execute("ROLLBACK")
                raise GameError(503, "too many games running right now, try again soon")
            db.execute(
                "INSERT INTO games (id, created, category, rounds, round_started) VALUES (?, ?, ?, ?, ?)",
                (game_id, now, category, json.dumps(rounds), now),
            )
            db.execute("COMMIT")
        return {"game_id": game_id, "rounds": [public_round(r) for r in rounds]}

    def _get(self, db: sqlite3.Connection, game_id: str, now: float) -> sqlite3.Row:
        row = db.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
        if row is None or row["created"] < now - GAME_TTL_SECONDS:
            raise GameError(404, "game not found (it may have expired)")
        return row

    def answer(self, game_id: str, round_index: int, choice: int, now: float | None = None) -> AnswerResult:
        now = time.time() if now is None else now
        if isinstance(choice, bool) or not isinstance(choice, int) or not 0 <= choice < NUM_CHOICES:
            raise GameError(422, f"choice must be 0-{NUM_CHOICES - 1}")
        with self._lock, closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                g = self._get(db, game_id, now)
                rounds = json.loads(g["rounds"])
                if g["current"] >= len(rounds):
                    raise GameError(409, "this game is already over")
                if round_index != g["current"]:
                    raise GameError(409, f"you're on round {g['current']}, not {round_index}")
                r = rounds[g["current"]]
                tried = g["tried"]
                if choice != r["answer"]:
                    # A repeated wrong choice doesn't cost extra.
                    db.execute("UPDATE games SET tried = ? WHERE id = ?", (tried | (1 << choice), game_id))
                    db.execute("COMMIT")
                    return AnswerResult(False, 0, g["score"], g["current"], False, g["correct_first"])

                wrong = bin(tried).count("1")
                pts = points_for(wrong, now - g["round_started"])
                score = g["score"] + pts
                first = g["correct_first"] + (1 if wrong == 0 else 0)
                nxt = g["current"] + 1
                db.execute(
                    "UPDATE games SET current = ?, tried = 0, round_started = ?, score = ?, correct_first = ? WHERE id = ?",
                    (nxt, now, score, first, game_id),
                )
                db.execute("COMMIT")
                return AnswerResult(True, pts, score, g["current"], nxt >= len(rounds), first)
            except BaseException:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise

    def finish(self, game_id: str, name: object, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        name = clean_name(name)
        with self._lock, closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                g = self._get(db, game_id, now)
                rounds = json.loads(g["rounds"])
                if g["current"] < len(rounds):
                    raise GameError(409, "finish all the questions first")
                if g["finished"]:
                    raise GameError(409, "this score is already on the leaderboard")
                db.execute("UPDATE games SET finished = 1 WHERE id = ?", (game_id,))
                cur = db.execute(
                    "INSERT INTO leaderboard (name, score, rounds, category, created) VALUES (?, ?, ?, ?, ?)",
                    (name, g["score"], len(rounds), g["category"], now),
                )
                (rank,) = db.execute(
                    "SELECT COUNT(*) + 1 FROM leaderboard WHERE score > ? OR (score = ? AND created < ?)",
                    (g["score"], g["score"], now),
                ).fetchone()
                db.execute("COMMIT")
            except BaseException:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise
        return {"id": cur.lastrowid, "name": name, "score": g["score"], "rank": rank}

    def leaderboard(self, limit: int = LEADERBOARD_SIZE) -> list[dict]:
        with closing(self._connect()) as db:
            rows = db.execute(
                "SELECT name, score, rounds, category, created FROM leaderboard ORDER BY score DESC, created ASC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "rank": i + 1,
                "name": r["name"],
                "score": r["score"],
                "rounds": r["rounds"],
                "category": r["category"],
                "date": time.strftime("%Y-%m-%d", time.gmtime(r["created"])),
            }
            for i, r in enumerate(rows)
        ]
