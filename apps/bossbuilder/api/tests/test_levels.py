"""Run from the api/ folder:  python3 -m unittest discover -s tests"""

import re
import tempfile
import unittest
from pathlib import Path

from app import levels
from app.levels import LevelError, normalize_code, validate_level
from app.store import LevelStore, StoreFull

RULES_JS = Path(__file__).resolve().parents[2] / "web" / "public" / "js" / "rules.js"


def make_level(boss="slime_king", extra=()):
    rows = [list("." * levels.WIDTH) for _ in range(levels.HEIGHT)]
    for y in (16, 17):
        rows[y] = list("#" * levels.WIDTH)
    rows[15][2], rows[15][61], rows[15][55] = "S", "F", "K"
    for x, y, c in extra:
        rows[y][x] = c
    return {"version": 1, "boss": boss, "tiles": ["".join(r) for r in rows]}


class ValidateLevelTests(unittest.TestCase):
    def test_good_level(self):
        level = make_level(extra=[(10, 15, "^"), (20, 15, "s")])
        self.assertEqual(validate_level(level), level)

    def test_bad_levels(self):
        good = make_level()
        bad = {
            "not a dict": [],
            "extra key": {**good, "name": "x"},
            "version 2": {**good, "version": 2},
            "version true": {**good, "version": True},
            "unknown boss": {**good, "boss": "dragon"},
            "short row": {**good, "tiles": good["tiles"][:-1] + ["#" * 63]},
            "too few rows": {**good, "tiles": good["tiles"][1:]},
            "unknown tile": make_level(extra=[(5, 5, "X")]),
            "two flags": make_level(extra=[(30, 15, "F")]),
            "no door": {**good, "tiles": [r.replace("S", ".") for r in good["tiles"]]},
            "over budget": make_level(extra=[(x, 14, "c") for x in range(10, 25)]),  # 15 cannons = 75
        }
        for label, level in bad.items():
            with self.subTest(label), self.assertRaises(LevelError):
                validate_level(level)

    def test_codes(self):
        self.assertEqual(normalize_code(" k7m2qx "), "K7M2QX")
        for code in ("K7M2Q", "K7M2QXX", "K7M2Q0", "K7M2Q!"):
            self.assertIsNone(normalize_code(code))
        self.assertIsNotNone(normalize_code(levels.new_code()))


class MatchesGameRulesTests(unittest.TestCase):
    """The game (rules.js) and the API must agree on the level format."""

    def setUp(self):
        self.js = RULES_JS.read_text(encoding="utf-8")

    def test_size(self):
        self.assertIn(f"export const W = {levels.WIDTH};", self.js)
        self.assertIn(f"export const H = {levels.HEIGHT};", self.js)

    def test_tiles_and_costs(self):
        js_tiles = dict(re.findall(r'^\s+"(.)": \{ name: "[^"]+", cost: (\d+)', self.js, re.M))
        self.assertEqual({k: int(v) for k, v in js_tiles.items()}, levels.TILE_COSTS)

    def test_bosses(self):
        block = self.js.split("export const BOSSES", 1)[1].split("};", 1)[0]
        self.assertEqual(tuple(re.findall(r"^  (\w+): \{", block, re.M)), levels.BOSSES)

    def test_max_budget(self):
        base = int(re.search(r"BASE_BUDGET = (\d+)", self.js).group(1))
        step = int(re.search(r"BUDGET_STEP = (\d+)", self.js).group(1))
        prices = re.search(r"^\s+budget: \{.*?prices: \[([^\]]*)\]", self.js, re.M).group(1)
        self.assertEqual(base + step * len(prices.split(",")), levels.MAX_BUDGET)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.store = LevelStore(Path(self.dir.name) / "levels.db", max_levels=3)

    def tearDown(self):
        self.dir.cleanup()

    def test_add_get_recent(self):
        level = make_level()
        summary, created = self.store.add(level)
        self.assertTrue(created)
        got = self.store.get(summary["code"])
        self.assertEqual(got["level"], level)
        self.assertEqual(got["name"], summary["name"])
        self.assertEqual([r["code"] for r in self.store.recent(10)], [summary["code"]])
        self.assertIsNone(self.store.get("ZZZZZZ"))

    def test_same_level_same_code(self):
        a, created_a = self.store.add(make_level())
        b, created_b = self.store.add(make_level())
        self.assertTrue(created_a)
        self.assertFalse(created_b)
        self.assertEqual(a["code"], b["code"])
        self.assertEqual(self.store.count(), 1)

    def test_limit(self):
        for x in range(3):
            self.store.add(make_level(extra=[(10 + x, 15, "^")]))
        with self.assertRaises(StoreFull):
            self.store.add(make_level(extra=[(20, 15, "^")]))
        # an existing level can still be "shared" again when full
        self.store.add(make_level(extra=[(10, 15, "^")]))


if __name__ == "__main__":
    unittest.main()
