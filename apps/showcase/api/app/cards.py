"""Load, check and save showcase cards (projects.json).

Standard library only, so the API container and the CLI share one set of rules.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

AUTHORS = ("Dustin", "Tripp", "Co-authored")
FIELDS = ("slug", "name", "launch_date", "url", "description", "author", "examples")
EXAMPLE_KINDS = ("api", "cli")

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_NAME = 60
MAX_DESCRIPTION = 300
MAX_EXAMPLE = 300


class CardError(ValueError):
    """projects.json, or one card in it, breaks the rules."""


def _text(card: dict, field: str, where: str, max_len: int | None = None) -> str:
    value = card[field]
    if not isinstance(value, str) or not value.strip():
        raise CardError(f"{where}: '{field}' must be non-empty text")
    if value != value.strip():
        raise CardError(f"{where}: '{field}' has spaces at the start or end")
    if max_len is not None and len(value) > max_len:
        raise CardError(f"{where}: '{field}' is longer than {max_len} characters")
    return value


def validate_card(card: Any, where: str = "card") -> dict:
    """Return the card unchanged if it follows the rules, else raise CardError."""
    if not isinstance(card, dict):
        raise CardError(f"{where}: must be a JSON object")

    missing = [f for f in FIELDS if f not in card]
    if missing:
        raise CardError(f"{where}: missing field(s): {', '.join(missing)}")
    unknown = sorted(set(card) - set(FIELDS))
    if unknown:
        raise CardError(f"{where}: unknown field(s): {', '.join(unknown)}")

    slug = _text(card, "slug", where)
    if not SLUG_RE.match(slug):
        raise CardError(f"{where}: 'slug' must be lowercase letters, numbers and dashes (like 'my-app')")
    where = f"card '{slug}'"

    _text(card, "name", where, MAX_NAME)
    _text(card, "description", where, MAX_DESCRIPTION)

    launch = _text(card, "launch_date", where)
    try:
        if not DATE_RE.match(launch):
            raise ValueError
        dt.date.fromisoformat(launch)
    except ValueError:
        raise CardError(f"{where}: 'launch_date' must be a real date like 2026-10-01") from None

    url = urlparse(_text(card, "url", where))
    if url.scheme != "https" or not url.hostname:
        raise CardError(f"{where}: 'url' must start with https://")

    if _text(card, "author", where) not in AUTHORS:
        raise CardError(f"{where}: 'author' must be one of: {', '.join(AUTHORS)}")

    examples = card["examples"]
    if not isinstance(examples, dict) or set(examples) != set(EXAMPLE_KINDS):
        raise CardError(f"{where}: 'examples' must have exactly the keys 'api' and 'cli'")
    for kind in EXAMPLE_KINDS:
        items = examples[kind]
        if not isinstance(items, list):
            raise CardError(f"{where}: 'examples.{kind}' must be a list (it may be empty)")
        for item in items:
            if not isinstance(item, str) or not item.strip() or len(item) > MAX_EXAMPLE:
                raise CardError(
                    f"{where}: each 'examples.{kind}' entry must be non-empty text"
                    f" up to {MAX_EXAMPLE} characters"
                )
    return card


def validate_projects(data: Any) -> list[dict]:
    """Check a whole projects.json document and return its list of cards."""
    if not isinstance(data, dict) or set(data) != {"projects"}:
        raise CardError('projects.json must look like {"projects": [ ... ]}')
    projects = data["projects"]
    if not isinstance(projects, list):
        raise CardError("'projects' must be a list")

    seen: set[str] = set()
    for i, card in enumerate(projects, start=1):
        validate_card(card, where=f"card #{i}")
        if card["slug"] in seen:
            raise CardError(f"two cards use the slug '{card['slug']}'")
        seen.add(card["slug"])
    return projects


def load_projects(path: str | os.PathLike) -> list[dict]:
    """Read and check projects.json."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise CardError(f"cannot read {path}: {e.strerror}") from None
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise CardError(f"{path} is not valid JSON (line {e.lineno}, column {e.colno}): {e.msg}") from None
    return validate_projects(data)


def save_projects(path: str | os.PathLike, projects: list[dict]) -> None:
    """Check the cards, then replace projects.json in one step.

    The new file is written next to the old one and renamed over it, so readers
    never see a half-written file.
    """
    validate_projects({"projects": projects})
    path = Path(path)
    text = json.dumps({"projects": projects}, indent=2, ensure_ascii=False) + "\n"

    try:
        mode = path.stat().st_mode & 0o7777
    except FileNotFoundError:
        mode = 0o664

    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".projects-", suffix=".json.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise
