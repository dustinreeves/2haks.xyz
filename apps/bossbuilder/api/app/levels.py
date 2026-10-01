"""Shared-level rules. Standard library only (used by the API and the CLI).

Must match web/public/js/rules.js (sizes, tiles, costs, bosses, MAX_BUDGET).
tests/test_levels.py checks that they agree.
"""

from __future__ import annotations

import json
import secrets
from typing import Any

WIDTH = 64
HEIGHT = 18

# tile -> trap point cost
TILE_COSTS = {".": 0, "#": 0, "^": 1, "~": 2, "s": 3, "b": 4, "c": 5, "S": 0, "F": 0, "K": 0}
UNIQUE_TILES = {"S": "Hero Door", "F": "Flag", "K": "Boss Spot"}
BOSSES = ("slime_king", "fire_golem", "shadow_dragon")
MAX_BUDGET = 70

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I
CODE_LENGTH = 6

_ADJECTIVES = (
    "Spooky", "Sneaky", "Fiery", "Frozen", "Wobbly", "Gloomy", "Bouncy", "Tricky", "Rumbling",
    "Shadowy", "Slimy", "Crumbly", "Twisty", "Prickly", "Mighty", "Haunted", "Bubbling", "Stormy",
)
_PLACES = (
    "Castle", "Cavern", "Tower", "Bridge", "Swamp", "Fortress", "Dungeon", "Volcano", "Maze",
    "Canyon", "Lair", "Ruins", "Peak", "Pit", "Keep", "Gauntlet", "Hollow", "Citadel",
)


class LevelError(ValueError):
    """A shared level breaks the rules."""


def validate_level(level: Any) -> dict:
    """Return a clean copy of the level, or raise LevelError."""
    if not isinstance(level, dict):
        raise LevelError("A level must be a JSON object.")
    if set(level) != {"version", "boss", "tiles"}:
        raise LevelError("A level must have exactly: version, boss, tiles.")
    if type(level["version"]) is not int or level["version"] != 1:
        raise LevelError("Unsupported level version.")
    if level["boss"] not in BOSSES:
        raise LevelError("Unknown boss.")

    tiles = level["tiles"]
    if not isinstance(tiles, list) or len(tiles) != HEIGHT:
        raise LevelError(f"A level must have {HEIGHT} rows.")
    counts: dict[str, int] = {}
    for row in tiles:
        if not isinstance(row, str) or len(row) != WIDTH:
            raise LevelError(f"Every row must be {WIDTH} tiles wide.")
        for c in row:
            if c not in TILE_COSTS:
                raise LevelError("The level contains an unknown tile.")
            counts[c] = counts.get(c, 0) + 1

    for c, name in UNIQUE_TILES.items():
        if counts.get(c, 0) != 1:
            raise LevelError(f"A level needs exactly one {name}.")
    cost = sum(TILE_COSTS[c] * n for c, n in counts.items())
    if cost > MAX_BUDGET:
        raise LevelError(f"A level can use at most {MAX_BUDGET} trap points.")

    return {"version": 1, "boss": level["boss"], "tiles": list(tiles)}


def canonical_json(level: dict) -> str:
    return json.dumps(level, separators=(",", ":"), sort_keys=True)


def new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def normalize_code(code: str) -> str | None:
    code = code.strip().upper()
    if len(code) == CODE_LENGTH and all(c in CODE_ALPHABET for c in code):
        return code
    return None


def random_name() -> str:
    return f"{secrets.choice(_ADJECTIVES)} {secrets.choice(_PLACES)}"
