"""Boss Builder API: share levels with a 6-character code."""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import deque
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from .levels import LevelError, normalize_code, validate_level
from .store import LevelStore, StoreFull

DB_PATH = os.environ.get("LEVELS_DB", "/data/levels.db")
MAX_LEVELS = int(os.environ.get("MAX_LEVELS", "5000"))
SHARES_PER_HOUR = int(os.environ.get("SHARES_PER_HOUR", "20"))
MAX_BODY_BYTES = 16_384

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("bossbuilder")

store = LevelStore(DB_PATH, MAX_LEVELS)

app = FastAPI(
    title="Boss Builder API",
    description="Share Boss Builder levels. Each level gets a 6-character code.",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)


class RateLimiter:
    """At most `limit` events per key per hour, kept in memory."""

    def __init__(self, limit: int, window: float = 3600) -> None:
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            if len(self._hits) > 10_000:
                self._hits = {k: q for k, q in self._hits.items() if q and q[-1] > now - self.window}
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True


share_limiter = RateLimiter(SHARES_PER_HOUR)


def client_ip(request: Request) -> str:
    # Only Caddy can reach this container, and Caddy sets X-Forwarded-For itself.
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    if request.method == "POST":
        length = request.headers.get("content-length")
        if length is None or not length.isdigit():
            return JSONResponse({"detail": "Content-Length is required."}, status_code=411)
        if int(length) > MAX_BODY_BYTES:
            return JSONResponse({"detail": "That level is too big."}, status_code=413)
    return await call_next(request)


class ShareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: dict[str, Any]


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "levels": store.count()}


@app.post("/api/levels", status_code=201)
def share_level(body: ShareRequest, request: Request):
    try:
        level = validate_level(body.level)
    except LevelError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    if not share_limiter.allow(client_ip(request)):
        raise HTTPException(status_code=429, detail="You've shared a lot of levels! Try again in a while.")
    try:
        summary, created = store.add(level)
    except StoreFull:
        log.warning("level store is full (%d levels)", MAX_LEVELS)
        raise HTTPException(status_code=507, detail="The level library is full right now.") from None
    if created:
        log.info("shared level %s (%s)", summary["code"], summary["boss"])
    return JSONResponse(summary, status_code=201 if created else 200)


@app.get("/api/levels")
def recent_levels(limit: int = Query(12, ge=1, le=50)) -> dict:
    return {"levels": store.recent(limit)}


@app.get("/api/levels/{code}")
def get_level(code: str) -> dict:
    normalized = normalize_code(code)
    level = store.get(normalized) if normalized else None
    if not level:
        raise HTTPException(status_code=404, detail="No level has that code.")
    return level
