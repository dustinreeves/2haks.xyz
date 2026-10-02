"""Pod Pile API: https://podcasts.2haks.xyz/api

Lists the biggest podcasts (Apple's charts) and reads their RSS feeds. Only feed text is
cached. Audio is streamed by the browser straight from each creator's host.
"""

from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from . import apple
from .cache import Cache
from .feeds import FeedError, parse_feed
from .fetch import FetchError, Upstream

DB_FILE = Path(os.environ.get("PODPILE_DB", "/var/lib/podpile/cache.db"))
SHOW_ID = re.compile(r"^\d{1,12}$")

CHART_TTL = 6 * 3600
LOOKUP_TTL = 24 * 3600
FEED_TTL = 30 * 60
SEARCH_TTL = 6 * 3600

# Upstream fetches (cache misses only) allowed per visitor and in total, per 10 minutes.
WINDOW = 600
PER_CLIENT = 120
GLOBAL = 1500

# The background warmer keeps the top-100 feeds fresh (conditional GETs, one every 2s).
WARMER = "warmer"
WARM_EVERY = 10 * 60


class TooBusy(Exception):
    pass


class Limiter:
    """In memory only; nothing about visitors is written to disk."""

    def __init__(self):
        self.lock = threading.Lock()
        self.clients: dict[str, deque] = defaultdict(deque)
        self.all: deque = deque()

    def hit(self, client: str) -> None:
        now = time.monotonic()
        with self.lock:
            q = self.clients[client]
            for d in (q, self.all):
                while d and now - d[0] > WINDOW:
                    d.popleft()
            if (client != WARMER and len(q) >= PER_CLIENT) or len(self.all) >= GLOBAL:
                raise TooBusy()
            q.append(now)
            self.all.append(now)
            if len(self.clients) > 5000:
                for k in [k for k, v in self.clients.items() if not v]:
                    del self.clients[k]


class Pods:
    def __init__(self, cache: Cache, up: Upstream):
        self.cache = cache
        self.up = up
        self.limiter = Limiter()
        self.locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
        self.locks_lock = threading.Lock()
        self.stop = threading.Event()

    def _lock(self, key: str) -> threading.Lock:
        with self.locks_lock:
            if len(self.locks) > 2000:
                self.locks = defaultdict(threading.Lock, {k: v for k, v in self.locks.items() if v.locked()})
            return self.locks[key]

    def cached(self, key: str, ttl: float, fetch, client: str) -> tuple[object, float, bool]:
        """(value, fetched time, stale). fetch(old_value_or_None) returns a new value, or
        None to mean "unchanged" (a 304). A failed refresh falls back to the old copy."""
        hit = self.cache.get(key)
        if hit and time.time() - hit[1] < ttl:
            return hit[0], hit[1], False
        with self._lock(key):
            hit = self.cache.get(key)
            if hit and time.time() - hit[1] < ttl:
                return hit[0], hit[1], False
            try:
                self.limiter.hit(client)
                value = fetch(hit[0] if hit else None)
            except (FetchError, FeedError, TooBusy):
                if hit:
                    return hit[0], hit[1], True
                raise
            if value is None and hit:
                value = hit[0]
            return value, self.cache.put(key, value), False

    def chart(self, genre: str, client: str):
        def fetch(_old):
            shows = apple.chart(self.up, genre)
            now = time.time()
            for s in shows:
                if s.get("feed"):
                    self.cache.put(f"lookup:{s['id']}", {k: v for k, v in s.items() if k != "rank"}, now)
            return shows

        return self.cached(f"chart:{genre}", CHART_TTL, fetch, client)

    def show(self, show_id: str, client: str) -> dict:
        def fetch(_old):
            found = apple.lookup(self.up, [show_id])
            if show_id not in found:
                raise HTTPException(404, "Apple doesn't know a podcast with that id")
            return found[show_id]

        info, _, _ = self.cached(f"lookup:{show_id}", LOOKUP_TTL, fetch, client)
        return info

    def feed(self, show: dict, client: str):
        def fetch(old):
            headers = {"Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.5"}
            if old and old.get("feed_url") == show["feed"]:
                if old.get("etag"):
                    headers["If-None-Match"] = old["etag"]
                if old.get("last_modified"):
                    headers["If-Modified-Since"] = old["last_modified"]
            res = self.up.get(show["feed"], headers)
            if res.status == 304 and old:
                return None
            parsed = parse_feed(res.body)
            parsed.update(
                feed_url=show["feed"],
                etag=res.headers.get("etag", ""),
                last_modified=res.headers.get("last-modified", ""),
            )
            return parsed

        return self.cached(f"feed:{show['id']}", FEED_TTL, fetch, client)

    def warm_once(self, pause: float = 2.0) -> int:
        """Refresh the top-100 chart and any of its feeds that are about to go stale, one
        at a time, so the biggest shows open instantly. Returns how many feeds were fetched."""
        shows, _, _ = self.chart("all", WARMER)
        done = 0
        for s in shows:
            if self.stop.is_set():
                break
            hit = self.cache.get(f"feed:{s['id']}")
            if not s.get("feed") or (hit and time.time() - hit[1] < FEED_TTL - WARM_EVERY):
                continue
            try:
                self.feed(s, WARMER)
                done += 1
            except (FetchError, FeedError, TooBusy):
                pass
            self.stop.wait(pause)
        return done

    def warm_forever(self) -> None:
        self.stop.wait(5)
        while not self.stop.is_set():
            try:
                n = self.warm_once()
                print(f"warmer: refreshed {n} feeds", flush=True)
            except Exception as e:  # noqa: BLE001 - keep the warmer alive
                print(f"warmer: {type(e).__name__}: {e}", flush=True)
            self.stop.wait(WARM_EVERY)

    def search(self, term: str, client: str):
        key = "search:" + " ".join(term.lower().split())
        return self.cached(key, SEARCH_TTL, lambda _old: apple.search(self.up, term), client)


def _iso(t: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def _client(request: Request) -> str:
    ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return ip or (request.client.host if request.client else "unknown")


def create_app(db_file: Path = DB_FILE, upstream: Upstream | None = None, warm: bool = True) -> FastAPI:
    pods = Pods(Cache(db_file), upstream or Upstream())

    @asynccontextmanager
    async def lifespan(_app):
        if warm:
            threading.Thread(target=pods.warm_forever, name="warmer", daemon=True).start()
        yield
        pods.stop.set()

    app = FastAPI(
        lifespan=lifespan,
        title="Pod Pile API",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )

    @app.exception_handler(FetchError)
    async def fetch_error(_: Request, exc: FetchError) -> JSONResponse:
        return JSONResponse({"detail": f"Couldn't load that: {exc}"}, status_code=502)

    @app.exception_handler(FeedError)
    async def feed_error(_: Request, exc: FeedError) -> JSONResponse:
        return JSONResponse({"detail": f"This show's feed is broken: {exc}"}, status_code=502)

    @app.exception_handler(TooBusy)
    async def too_busy(_: Request, __: TooBusy) -> JSONResponse:
        return JSONResponse({"detail": "Slow down a little and try again in a few minutes."}, status_code=429)

    @app.get("/api/health")
    def health():
        try:
            rows = pods.cache.count()
        except Exception as e:  # noqa: BLE001 - report any database problem
            return JSONResponse({"status": "error", "detail": f"database: {e}"}, status_code=503)
        return {"status": "ok", "cached": rows}

    @app.get("/api/genres")
    def genres():
        return {"genres": [{"id": k, "name": name} for k, (name, _) in apple.GENRES.items()]}

    @app.get("/api/top")
    def top(request: Request, genre: str = Query("all", max_length=32)):
        if genre not in apple.GENRES:
            raise HTTPException(404, "no such genre")
        shows, fetched, stale = pods.chart(genre, _client(request))
        return {"genre": genre, "shows": shows, "fetched": _iso(fetched), "stale": stale}

    @app.get("/api/search")
    def search(request: Request, q: str = Query(..., min_length=2, max_length=80)):
        shows, fetched, stale = pods.search(q.strip(), _client(request))
        return {"query": q, "shows": shows, "fetched": _iso(fetched), "stale": stale}

    @app.get("/api/podcasts/{show_id}")
    def podcast(request: Request, show_id: str):
        if not SHOW_ID.match(show_id):
            raise HTTPException(404, "no podcast with that id")
        client = _client(request)
        show = pods.show(show_id, client)
        if not show.get("feed"):
            raise HTTPException(404, "Apple doesn't list an RSS feed for this show")
        feed, fetched, stale = pods.feed(show, client)
        podcast = {
            "id": show["id"],
            "name": feed["name"] or show["name"],
            "author": feed["author"] or show["author"],
            "artwork": show["artwork"] or feed["artwork"],
            "description": feed["description"],
            "genre": show["genre"],
            "explicit": bool(show["explicit"] or feed["explicit"]),
            "link": feed["link"],
            "apple_url": show["apple_url"],
            "feed": show["feed"],
            "episode_count": feed["episode_count"],
        }
        return {"podcast": podcast, "episodes": feed["episodes"], "fetched": _iso(fetched), "stale": stale}

    return app


app = create_app()
