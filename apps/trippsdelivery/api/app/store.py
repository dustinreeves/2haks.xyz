"""SQLite storage for Tripp's Delivery: the water stock and the order log."""

from __future__ import annotations

import sqlite3
import time
from contextlib import closing
from pathlib import Path

PRICES = {"water": 2, "dog": 95, "lawn": 39}
MAX_PER_ORDER = {"water": 24, "dog": 5, "lawn": 5}
START_WATER = 24


class OutOfStock(Exception):
    def __init__(self, available: int):
        super().__init__(f"Only {available} water left")
        self.available = available


def order_total(water: int, dog: int, lawn: int) -> int:
    return water * PRICES["water"] + dog * PRICES["dog"] + lawn * PRICES["lawn"]


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        with closing(self._connect()) as db, db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS stock (item TEXT PRIMARY KEY, qty INTEGER NOT NULL CHECK (qty >= 0));
                CREATE TABLE IF NOT EXISTS orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    water INTEGER NOT NULL,
                    dog INTEGER NOT NULL,
                    lawn INTEGER NOT NULL,
                    total INTEGER NOT NULL,
                    emailed INTEGER NOT NULL DEFAULT 0
                );
                """
            )
            db.execute("INSERT OR IGNORE INTO stock (item, qty) VALUES ('water', ?)", (START_WATER,))

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        return db

    def water(self) -> int:
        with closing(self._connect()) as db:
            return db.execute("SELECT qty FROM stock WHERE item = 'water'").fetchone()["qty"]

    def set_water(self, qty: int) -> None:
        with closing(self._connect()) as db:
            db.execute("UPDATE stock SET qty = ? WHERE item = 'water'", (qty,))

    def add_water(self, amount: int) -> int:
        with closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE stock SET qty = MAX(0, qty + ?) WHERE item = 'water'", (amount,))
            qty = db.execute("SELECT qty FROM stock WHERE item = 'water'").fetchone()["qty"]
            db.execute("COMMIT")
            return qty

    def place_order(self, name: str, water: int, dog: int, lawn: int) -> dict:
        """Take the water out of stock and log the order in one transaction."""
        total = order_total(water, dog, lawn)
        with closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                have = db.execute("SELECT qty FROM stock WHERE item = 'water'").fetchone()["qty"]
                if water > have:
                    raise OutOfStock(have)
                db.execute("UPDATE stock SET qty = qty - ? WHERE item = 'water'", (water,))
                cur = db.execute(
                    "INSERT INTO orders (created, name, water, dog, lawn, total) VALUES (?, ?, ?, ?, ?, ?)",
                    (int(time.time()), name, water, dog, lawn, total),
                )
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise
            return {"id": cur.lastrowid, "name": name, "water": water, "dog": dog, "lawn": lawn, "total": total}

    def mark_emailed(self, order_id: int) -> None:
        with closing(self._connect()) as db:
            db.execute("UPDATE orders SET emailed = 1 WHERE id = ?", (order_id,))

    def orders(self, limit: int = 50) -> list[dict]:
        with closing(self._connect()) as db:
            rows = db.execute("SELECT * FROM orders ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]
