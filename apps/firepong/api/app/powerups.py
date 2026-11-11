"""Loading and validating power-up files (content/powerups/*.json).

Standard library only, so the CLI can import it on the host without FastAPI.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

# The effects the game knows how to play (web/public/pong.js, `applyPowerup`).
KNOWN_EFFECTS = {
    "big_paddle",   # your paddle grows
    "tiny_foe",     # the other paddle shrinks
    "slow_mo",      # every ball slows down
    "fireball",     # balls speed up
    "multiball",    # two extra balls appear
    "shield",       # a wall behind you blocks one goal
    "magnet",       # your paddle catches the ball, then lets go
    "portals",      # two portals teleport the ball
}
ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,23}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
ALLOWED_KEYS = {"id", "name", "description", "effect", "color", "duration", "weight", "amount"}


class PowerupError(ValueError):
    pass


def _number(raw: dict, key: str, where: str, lo: float, hi: float, default: float | None = None) -> float:
    value = raw.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise PowerupError(f"{where}.{key}: must be a number")
    if not lo <= value <= hi:
        raise PowerupError(f"{where}.{key}: must be between {lo:g} and {hi:g}")
    return float(value)


def _text(raw: dict, key: str, where: str, max_len: int) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise PowerupError(f"{where}.{key}: must be non-empty text")
    if len(value) > max_len:
        raise PowerupError(f"{where}.{key}: longer than {max_len} characters")
    return value.strip()


def validate_powerup(raw: object, where: str = "power-up") -> dict:
    if not isinstance(raw, dict):
        raise PowerupError(f"{where}: must be an object")
    extra = set(raw) - ALLOWED_KEYS
    if extra:
        raise PowerupError(f"{where}: unknown field(s) {sorted(extra)}")

    pid = raw.get("id")
    if not isinstance(pid, str) or not ID_RE.fullmatch(pid):
        raise PowerupError(f"{where}.id: must look like 'big_paddle' (lowercase letters, digits, _)")
    where = f"power-up '{pid}'"

    effect = raw.get("effect")
    if effect not in KNOWN_EFFECTS:
        raise PowerupError(f"{where}.effect: must be one of {sorted(KNOWN_EFFECTS)}")

    color = raw.get("color")
    if not isinstance(color, str) or not COLOR_RE.fullmatch(color):
        raise PowerupError(f"{where}.color: must look like '#ff8800'")

    weight = _number(raw, "weight", where, 1, 10, default=3)
    if weight != int(weight):
        raise PowerupError(f"{where}.weight: must be a whole number 1-10")

    return {
        "id": pid,
        "name": _text(raw, "name", where, 24),
        "description": _text(raw, "description", where, 120),
        "effect": effect,
        "color": color.lower(),
        "duration": _number(raw, "duration", where, 0, 30, default=8),
        "weight": int(weight),
        "amount": _number(raw, "amount", where, 0, 10, default=1),
    }


def load_powerups(folder: Path) -> list[dict]:
    files = sorted(folder.glob("*.json"))
    if not files:
        raise PowerupError(f"{folder}: no power-up files")
    found: list[dict] = []
    for f in files:
        try:
            raw = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise PowerupError(f"{f.name}: can't read it as JSON ({e})") from e
        p = validate_powerup(raw, f.name)
        if f.stem != p["id"]:
            raise PowerupError(f"{f.name}: file name must match the id '{p['id']}'")
        found.append(p)
    return found


class PowerupCache:
    """Re-reads the folder when a file changes. A broken edit keeps the last good set."""

    def __init__(self, folder: Path) -> None:
        self.folder = folder
        self._signature: tuple | None = None
        self._items: list[dict] = []
        self.error: str | None = None

    def _sign(self) -> tuple:
        try:
            return tuple((f.name, f.stat().st_mtime_ns, f.stat().st_size) for f in sorted(self.folder.glob("*.json")))
        except OSError:
            return ()

    def get(self) -> list[dict]:
        sig = self._sign()
        if sig != self._signature:
            self._signature = sig
            try:
                self._items = load_powerups(self.folder)
                self.error = None
            except PowerupError as e:
                self.error = str(e)
        return self._items
