"""The parts catalog (content/parts.json): loading, checking, and judging designs.

Shared by the API and the `gundesigner` CLI. The web page has its own copy of
`compute_stats` and `design_name` in web/public/js/rules.js; keep them in step
(tests/test_catalog.py checks the name rules against a few known designs).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

SHAPE_TYPES = {"box", "cyl", "sph", "tor"}
MATERIALS = {"body", "accent", "metal", "dark", "glass", "glow", "plastic"}
AXES = {"x", "y", "z"}
ANIMS = {"wobble", "spin"}
CLASSES = {"pistol", "long"}
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
ID = re.compile(r"^[a-z0-9_]{1,32}$")
MAX_SHAPES = 40


class CatalogError(ValueError):
    pass


class DesignError(ValueError):
    pass


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) < 1000


def _vec(v, n=3) -> bool:
    return isinstance(v, list) and len(v) == n and all(_num(x) for x in v)


def _check_shape(where: str, s: dict) -> list[str]:
    errs = []
    t = s.get("t")
    if t not in SHAPE_TYPES:
        return [f"{where}: unknown shape type {t!r}"]
    if not _vec(s.get("p")):
        errs.append(f"{where}: p must be [x, y, z]")
    if "r" in s and not _vec(s["r"]):
        errs.append(f"{where}: r must be [x, y, z] in degrees")
    if s.get("m") not in MATERIALS:
        errs.append(f"{where}: m must be one of {sorted(MATERIALS)}")
    if "c" in s and not (isinstance(s["c"], str) and COLOR.match(s["c"])):
        errs.append(f"{where}: c must be a colour like #ff8800")
    if "anim" in s and s["anim"] not in ANIMS:
        errs.append(f"{where}: anim must be one of {sorted(ANIMS)}")
    if t == "box" and not (_vec(s.get("s")) and all(x > 0 for x in s["s"])):
        errs.append(f"{where}: box needs s = [x, y, z] sizes above 0")
    if t == "cyl":
        if not (_num(s.get("r1")) and s["r1"] > 0 and _num(s.get("l")) and s["l"] > 0):
            errs.append(f"{where}: cyl needs r1 and l above 0")
        if "r2" in s and not (_num(s["r2"]) and s["r2"] >= 0):
            errs.append(f"{where}: r2 must be 0 or more")
        if s.get("ax", "y") not in AXES:
            errs.append(f"{where}: ax must be x, y or z")
    if t == "sph":
        if not (_num(s.get("rad")) and s["rad"] > 0):
            errs.append(f"{where}: sph needs rad above 0")
        if "sc" in s and not _vec(s["sc"]):
            errs.append(f"{where}: sc must be [x, y, z]")
    if t == "tor":
        if not (_num(s.get("rad")) and s["rad"] > 0 and _num(s.get("tube")) and s["tube"] > 0):
            errs.append(f"{where}: tor needs rad and tube above 0")
        if s.get("ax", "z") not in AXES:
            errs.append(f"{where}: ax must be x, y or z")
    return errs


def check_catalog(cat: dict) -> list[str]:
    """Return a list of problems (empty if the catalog is fine)."""
    errs: list[str] = []
    slots = [s.get("id") for s in cat.get("slots", [])]
    stats = [s.get("id") for s in cat.get("stats", [])]
    if not slots or not stats:
        return ["catalog needs slots and stats"]
    seen: set[str] = set()

    def check_item(kind: str, item: dict):
        iid = item.get("id")
        where = f"{kind} {iid!r}"
        if not isinstance(iid, str) or not ID.match(iid):
            errs.append(f"{where}: id must be lowercase letters, digits or _")
        elif iid in seen:
            errs.append(f"{where}: duplicate id")
        seen.add(iid)
        if not isinstance(item.get("name"), str) or not item["name"]:
            errs.append(f"{where}: needs a name")
        for k, v in item.get("stats", {}).items():
            if k not in stats or not isinstance(v, int):
                errs.append(f"{where}: stat {k!r} must be one of {stats} with a whole number")
        for slot, pos in item.get("mounts", {}).items():
            if slot not in slots or not _vec(pos):
                errs.append(f"{where}: mount {slot!r} must be a slot with [x, y, z]")
        shapes = item.get("shapes")
        if not isinstance(shapes, list) or not shapes or len(shapes) > MAX_SHAPES:
            errs.append(f"{where}: needs 1-{MAX_SHAPES} shapes")
        else:
            for i, s in enumerate(shapes):
                errs.extend(_check_shape(f"{where} shape {i}", s if isinstance(s, dict) else {}))

    for f in cat.get("finishes", []):
        if not (isinstance(f.get("id"), str) and f.get("name") and f.get("adj")):
            errs.append(f"finish {f.get('id')!r}: needs id, name and adj")
        for k in f.get("stats", {}):
            if k not in stats:
                errs.append(f"finish {f.get('id')!r}: unknown stat {k!r}")
    if not cat.get("finishes"):
        errs.append("catalog needs at least one finish")
    if not cat.get("bases"):
        errs.append("catalog needs at least one base")
    for b in cat.get("bases", []):
        check_item("base", b)
        if b.get("class") not in CLASSES:
            errs.append(f"base {b.get('id')!r}: class must be one of {sorted(CLASSES)}")
        missing = [s for s in stats if s not in b.get("stats", {})]
        if missing:
            errs.append(f"base {b.get('id')!r}: missing stats {missing}")
    for p in cat.get("parts", []):
        check_item("part", p)
        if p.get("slot") not in slots:
            errs.append(f"part {p.get('id')!r}: slot must be one of {slots}")
        for c in p.get("classes", []):
            if c not in CLASSES:
                errs.append(f"part {p.get('id')!r}: unknown class {c!r}")
    return errs


def load_catalog(path: Path) -> dict:
    try:
        cat = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise CatalogError(f"can't read {path.name}: {e}") from e
    errs = check_catalog(cat)
    if errs:
        raise CatalogError(f"{path.name}: " + "; ".join(errs[:5]) + (" ..." if len(errs) > 5 else ""))
    return cat


class Catalog:
    """A checked catalog with lookups."""

    def __init__(self, data: dict):
        self.data = data
        self.slots = [s["id"] for s in data["slots"]]
        self.stats = [s["id"] for s in data["stats"]]
        self.bases = {b["id"]: b for b in data["bases"]}
        self.parts = {p["id"]: p for p in data["parts"]}
        self.finishes = {f["id"]: f for f in data["finishes"]}

    def check_design(self, design) -> dict:
        """Return the design in canonical form, or raise DesignError."""
        if not isinstance(design, dict):
            raise DesignError("design must be an object")
        base = self.bases.get(design.get("base"))
        if not base:
            raise DesignError("unknown base gun")
        parts_in = design.get("parts") or {}
        if not isinstance(parts_in, dict):
            raise DesignError("parts must be an object of slot: part id")
        parts: dict[str, str] = {}
        for slot, pid in parts_in.items():
            if slot not in self.slots:
                raise DesignError(f"unknown slot {slot!r}")
            if pid is None:
                continue
            part = self.parts.get(pid)
            if not part or part["slot"] != slot:
                raise DesignError(f"{pid!r} isn't a {slot} part")
            if part.get("classes") and base["class"] not in part["classes"]:
                raise DesignError(f"{part['name']} doesn't fit a {base['name']}")
            parts[slot] = pid
        for slot in parts:
            providers = [base] + [self.parts[p] for s, p in parts.items() if s != slot]
            if not any(slot in item.get("mounts", {}) for item in providers):
                raise DesignError(f"nothing to attach the {slot} to")
        paint = design.get("paint") or {}
        if not isinstance(paint, dict):
            raise DesignError("paint must be an object")
        body, accent = paint.get("body", "#2f3640"), paint.get("accent", "#ff4f9a")
        finish = paint.get("finish", "matte")
        for c in (body, accent):
            if not (isinstance(c, str) and COLOR.match(c)):
                raise DesignError("colours must look like #ff8800")
        if finish not in self.finishes:
            raise DesignError("unknown finish")
        return {
            "base": base["id"],
            "parts": {s: parts[s] for s in self.slots if s in parts},
            "paint": {"body": body.lower(), "accent": accent.lower(), "finish": finish},
        }

    def compute_stats(self, design: dict) -> dict:
        base = self.bases[design["base"]]
        total = dict(base["stats"])
        extras = [self.parts[p] for p in design["parts"].values()]
        extras.append(self.finishes[design["paint"]["finish"]])
        for item in extras:
            for k, v in item.get("stats", {}).items():
                total[k] = total.get(k, 0) + v
        return {k: max(0, min(100, total.get(k, 0))) for k in self.stats}

    def design_name(self, design: dict) -> str:
        """e.g. "Golden Quacking Longboi": finish + goofiest nicknamed part + base."""
        best, best_goof = None, None
        for slot in self.slots:
            part = self.parts.get(design["parts"].get(slot, ""))
            if part and part.get("nick"):
                goof = part.get("stats", {}).get("goofiness", 0)
                if best_goof is None or goof > best_goof:
                    best, best_goof = part["nick"], goof
        words = [self.finishes[design["paint"]["finish"]]["adj"], best, self.bases[design["base"]]["name"]]
        return " ".join(w for w in words if w)
