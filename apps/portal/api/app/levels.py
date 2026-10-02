"""Loading and validating test chamber files (content/levels/*.json).

Standard library only, so the CLI can import it on the host without FastAPI.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

ID_RE = re.compile(r"^[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$")
BOX_TYPES = {"white", "metal", "glass"}
WORLD_LIMIT = 200.0
MAX_BOXES = 300
MAX_THINGS = 20


class LevelError(ValueError):
    pass


def _vec(raw: object, where: str) -> list[float]:
    if (not isinstance(raw, list) or len(raw) != 3
            or not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in raw)):
        raise LevelError(f"{where}: must be [x, y, z] numbers")
    if not all(math.isfinite(v) and abs(v) <= WORLD_LIMIT for v in raw):
        raise LevelError(f"{where}: numbers must be between -{WORLD_LIMIT:g} and {WORLD_LIMIT:g}")
    return [float(v) for v in raw]


def _box(raw: object, where: str, types: set[str] | None = None) -> dict:
    if not isinstance(raw, dict):
        raise LevelError(f"{where}: must be an object")
    lo = _vec(raw.get("min"), f"{where}.min")
    hi = _vec(raw.get("max"), f"{where}.max")
    if not all(a < b for a, b in zip(lo, hi)):
        raise LevelError(f"{where}: every 'min' number must be smaller than the matching 'max' number")
    out = {"min": lo, "max": hi}
    if types is not None:
        t = raw.get("type")
        if t not in types:
            raise LevelError(f"{where}.type: must be one of {sorted(types)}")
        out["type"] = t
    return out


def _list(raw: dict, key: str, where: str, limit: int) -> list:
    value = raw.get(key, [])
    if not isinstance(value, list):
        raise LevelError(f"{where}.{key}: must be a list")
    if len(value) > limit:
        raise LevelError(f"{where}.{key}: at most {limit} allowed")
    return value


def _text(raw: dict, key: str, where: str, max_len: int, required: bool = True) -> str:
    value = raw.get(key, "" if not required else None)
    if not isinstance(value, str) or (required and not value.strip()):
        raise LevelError(f"{where}.{key}: must be {'non-empty ' if required else ''}text")
    if len(value) > max_len:
        raise LevelError(f"{where}.{key}: longer than {max_len} characters")
    return value.strip()


def _inside(point: list[float], box: dict) -> bool:
    return all(lo <= p <= hi for p, lo, hi in zip(point, box["min"], box["max"]))


ALLOWED_KEYS = {
    "id", "order", "name", "intro", "hint", "gun", "start", "room", "boxes", "fixed_portals",
    "doors", "buttons", "cubes", "goo", "fizzlers", "exit",
}


def validate_level(raw: object, where: str = "level") -> dict:
    if not isinstance(raw, dict):
        raise LevelError(f"{where}: must be an object")
    extra = set(raw) - ALLOWED_KEYS
    if extra:
        raise LevelError(f"{where}: unknown field(s) {sorted(extra)}")

    lid = raw.get("id")
    if not isinstance(lid, str) or not ID_RE.fullmatch(lid) or len(lid) > 48:
        raise LevelError(f"{where}.id: must look like '01-through-the-wall'")
    where = f"level '{lid}'"

    order = raw.get("order")
    if isinstance(order, bool) or not isinstance(order, int) or not 1 <= order <= 99:
        raise LevelError(f"{where}.order: must be a whole number 1-99")

    gun = raw.get("gun")
    if gun not in {"blue", "both"}:
        raise LevelError(f"{where}.gun: must be 'blue' or 'both'")

    start = raw.get("start")
    if not isinstance(start, dict):
        raise LevelError(f"{where}.start: must be an object")
    yaw = start.get("yaw", 0)
    if isinstance(yaw, bool) or not isinstance(yaw, (int, float)) or not -360 <= yaw <= 360:
        raise LevelError(f"{where}.start.yaw: must be degrees (-360 to 360)")

    room = raw.get("room")
    if not isinstance(room, dict):
        raise LevelError(f"{where}.room: must be an object")
    room_box = _box(room, f"{where}.room", {"white", "metal"})
    floor = room.get("floor", True)
    if not isinstance(floor, bool):
        raise LevelError(f"{where}.room.floor: must be true or false")

    level = {
        "id": lid,
        "order": order,
        "name": _text(raw, "name", where, 40),
        "intro": _text(raw, "intro", where, 400),
        "hint": _text(raw, "hint", where, 200, required=False),
        "gun": gun,
        "start": {"pos": _vec(start.get("pos"), f"{where}.start.pos"), "yaw": float(yaw)},
        "room": {**room_box, "floor": floor},
        "boxes": [_box(b, f"{where}.boxes[{i}]", BOX_TYPES)
                  for i, b in enumerate(_list(raw, "boxes", where, MAX_BOXES))],
        "goo": [_box(b, f"{where}.goo[{i}]") for i, b in enumerate(_list(raw, "goo", where, MAX_THINGS))],
        "fizzlers": [_box(b, f"{where}.fizzlers[{i}]")
                     for i, b in enumerate(_list(raw, "fizzlers", where, MAX_THINGS))],
        "exit": _box(raw.get("exit"), f"{where}.exit"),
    }

    if not _inside(level["start"]["pos"], room_box):
        raise LevelError(f"{where}.start.pos: must be inside the room")
    if not _inside(level["exit"]["min"], room_box) or not _inside(level["exit"]["max"], room_box):
        raise LevelError(f"{where}.exit: must be inside the room")

    doors = []
    for i, d in enumerate(_list(raw, "doors", where, MAX_THINGS)):
        box = _box(d, f"{where}.doors[{i}]")
        did = d.get("id")
        if not isinstance(did, str) or not re.fullmatch(r"[a-z0-9]{1,12}", did):
            raise LevelError(f"{where}.doors[{i}].id: must be short lowercase text like 'd1'")
        if any(x["id"] == did for x in doors):
            raise LevelError(f"{where}.doors[{i}].id: '{did}' is used twice")
        doors.append({"id": did, **box})
    level["doors"] = doors
    door_ids = {d["id"] for d in doors}

    buttons = []
    for i, b in enumerate(_list(raw, "buttons", where, MAX_THINGS)):
        if not isinstance(b, dict):
            raise LevelError(f"{where}.buttons[{i}]: must be an object")
        opens = b.get("opens")
        if not isinstance(opens, list) or not opens or not all(isinstance(o, str) for o in opens):
            raise LevelError(f"{where}.buttons[{i}].opens: must list door ids")
        missing = set(opens) - door_ids
        if missing:
            raise LevelError(f"{where}.buttons[{i}].opens: no door called {sorted(missing)}")
        buttons.append({"pos": _vec(b.get("pos"), f"{where}.buttons[{i}].pos"), "opens": opens})
    level["buttons"] = buttons
    for d in doors:
        if not any(d["id"] in b["opens"] for b in buttons):
            raise LevelError(f"{where}: door '{d['id']}' has no button, so it can never open")

    cubes = []
    for i, c in enumerate(_list(raw, "cubes", where, MAX_THINGS)):
        if not isinstance(c, dict):
            raise LevelError(f"{where}.cubes[{i}]: must be an object")
        cubes.append({"pos": _vec(c.get("pos"), f"{where}.cubes[{i}].pos")})
    level["cubes"] = cubes

    fixed = []
    for i, p in enumerate(_list(raw, "fixed_portals", where, 2)):
        if not isinstance(p, dict) or p.get("color") not in {"blue", "orange"}:
            raise LevelError(f"{where}.fixed_portals[{i}].color: must be 'blue' or 'orange'")
        normal = _vec(p.get("normal"), f"{where}.fixed_portals[{i}].normal")
        if sorted(abs(v) for v in normal) != [0.0, 0.0, 1.0]:
            raise LevelError(f"{where}.fixed_portals[{i}].normal: must point straight along one axis, like [0, 0, -1]")
        if any(x["color"] == p["color"] for x in fixed):
            raise LevelError(f"{where}.fixed_portals: only one {p['color']} portal allowed")
        fixed.append({"color": p["color"], "pos": _vec(p.get("pos"), f"{where}.fixed_portals[{i}].pos"),
                      "normal": normal})
    level["fixed_portals"] = fixed
    if gun == "blue" and not any(p["color"] == "orange" for p in fixed):
        raise LevelError(f"{where}: a 'blue'-only gun needs a fixed orange portal")
    if gun == "both" and fixed:
        raise LevelError(f"{where}: fixed portals only make sense with gun 'blue'")

    return level


def load_levels(folder: Path) -> list[dict]:
    files = sorted(folder.glob("*.json"))
    if not files:
        raise LevelError(f"{folder}: no level files")
    levels = []
    for f in files:
        try:
            raw = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise LevelError(f"{f.name}: not valid JSON (line {e.lineno}: {e.msg})") from e
        level = validate_level(raw, f.name)
        if f.stem != level["id"]:
            raise LevelError(f"{f.name}: file name must match its id '{level['id']}'")
        levels.append(level)
    orders = [lv["order"] for lv in levels]
    if len(set(orders)) != len(orders):
        raise LevelError("two levels have the same 'order' number")
    return sorted(levels, key=lambda lv: lv["order"])


class LevelCache:
    """Re-reads the level folder when any file changes; keeps the last good set if one breaks."""

    def __init__(self, folder: Path):
        self.folder = folder
        self._stamp: tuple | None = None
        self._levels: list[dict] = []
        self.error: str | None = None

    def get(self) -> list[dict]:
        try:
            stamp = tuple((f.name, f.stat().st_mtime_ns) for f in sorted(self.folder.glob("*.json")))
        except OSError as e:
            self.error = f"cannot read level folder: {e.strerror}"
            return self._levels
        if stamp != self._stamp:
            try:
                self._levels = load_levels(self.folder)
                self.error = None
            except (OSError, LevelError) as e:
                self.error = str(e)
            self._stamp = stamp
        return self._levels
