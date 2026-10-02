"""Apple's free, keyless podcast directory: top charts, lookups and search.

Apple only tells us which shows are biggest and where their RSS feeds live. The episodes
come from each creator's own feed.
"""

from __future__ import annotations

import json
from urllib.parse import urlencode

from .fetch import FetchError, Upstream

COUNTRY = "us"
CHART_SIZE = 100

# Apple podcast genre ids.
GENRES = {
    "all": ("All", None),
    "comedy": ("Comedy", 1303),
    "news": ("News", 1489),
    "true-crime": ("True Crime", 1488),
    "society": ("Society & Culture", 1324),
    "sports": ("Sports", 1545),
    "history": ("History", 1487),
    "science": ("Science", 1533),
    "technology": ("Technology", 1318),
    "business": ("Business", 1321),
    "education": ("Education", 1304),
    "health": ("Health & Fitness", 1512),
    "kids": ("Kids & Family", 1305),
    "tv-film": ("TV & Film", 1309),
    "music": ("Music", 1310),
    "fiction": ("Fiction", 1483),
    "leisure": ("Leisure", 1502),
    "religion": ("Religion & Spirituality", 1314),
}


def _json(up: Upstream, url: str):
    res = up.get(url)
    try:
        return json.loads(res.body)
    except ValueError:
        raise FetchError("Apple sent something that isn't JSON") from None


def _art(r: dict) -> str:
    return r.get("artworkUrl600") or r.get("artworkUrl100") or ""


def show_from_lookup(r: dict) -> dict:
    """One iTunes lookup/search result as our podcast summary."""
    return {
        "id": str(r["collectionId"]),
        "name": r.get("collectionName") or r.get("trackName") or "",
        "author": r.get("artistName") or "",
        "artwork": _art(r),
        "genre": r.get("primaryGenreName") or "",
        # collectionExplicitness says "notExplicit" even for very explicit shows; the
        # advisory rating is the field Apple actually keeps up to date.
        "explicit": r.get("contentAdvisoryRating") == "Explicit"
        or "explicit" in (r.get("collectionExplicitness"), r.get("trackExplicitness")),
        "feed": r.get("feedUrl") or "",
        "episodes": r.get("trackCount"),
        "updated": r.get("releaseDate"),
        "apple_url": (r.get("collectionViewUrl") or "").split("?")[0],
    }


def lookup(up: Upstream, ids: list[str]) -> dict[str, dict]:
    """Shows by Apple id (up to ~150 per call)."""
    if not ids:
        return {}
    data = _json(up, f"https://itunes.apple.com/lookup?{urlencode({'id': ','.join(ids), 'entity': 'podcast'})}")
    out = {}
    for r in data.get("results", []):
        if r.get("kind") == "podcast" and r.get("collectionId"):
            show = show_from_lookup(r)
            out[show["id"]] = show
    return out


def chart(up: Upstream, genre: str) -> list[dict]:
    """The top shows in a genre, biggest first, with feed URLs filled in from a lookup."""
    _, genre_id = GENRES[genre]
    path = f"limit={CHART_SIZE}" + (f"/genre={genre_id}" if genre_id else "")
    data = _json(up, f"https://itunes.apple.com/{COUNTRY}/rss/toppodcasts/{path}/json")
    entries = data.get("feed", {}).get("entry", [])
    if isinstance(entries, dict):  # a one-entry chart isn't a list
        entries = [entries]
    ranked = []
    for e in entries:
        try:
            ranked.append({
                "id": e["id"]["attributes"]["im:id"],
                "name": e["im:name"]["label"],
                "author": e.get("im:artist", {}).get("label", ""),
                "artwork": (e.get("im:image") or [{}])[-1].get("label", ""),
            })
        except (KeyError, TypeError):
            continue
    details = lookup(up, [r["id"] for r in ranked])
    out = []
    for rank, r in enumerate(ranked, 1):
        show = details.get(r["id"]) or {**r, "genre": "", "explicit": False, "feed": "", "episodes": None,
                                         "updated": None, "apple_url": ""}
        out.append({**show, "rank": rank})
    return out


def search(up: Upstream, term: str, limit: int = 30) -> list[dict]:
    q = urlencode({"media": "podcast", "entity": "podcast", "term": term, "limit": limit, "country": COUNTRY})
    data = _json(up, f"https://itunes.apple.com/search?{q}")
    return [show_from_lookup(r) for r in data.get("results", []) if r.get("collectionId") and r.get("feedUrl")]
