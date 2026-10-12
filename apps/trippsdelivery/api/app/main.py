"""Tripp's Delivery API: https://trippsdelivery.2haks.xyz/api"""

from __future__ import annotations

import hmac
import os
import re
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from . import mailer
from .store import MAX_PER_ORDER, PRICES, OutOfStock, Store

DB_FILE = Path(os.environ.get("TRIPPS_DB", "/var/lib/trippsdelivery/delivery.db"))
ORDERS_PER_HOUR = 10
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class OrderIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    water: int = Field(default=0, ge=0, le=MAX_PER_ORDER["water"])
    dog: int = Field(default=0, ge=0, le=MAX_PER_ORDER["dog"])
    lawn: int = Field(default=0, ge=0, le=MAX_PER_ORDER["lawn"])


class StockIn(BaseModel):
    water: int = Field(ge=0, le=10_000)


def create_app(store: Store | None = None, admin_token: str | None = None) -> FastAPI:
    games = store or Store(DB_FILE)
    token = admin_token if admin_token is not None else os.environ.get("ADMIN_TOKEN", "")
    recent: dict[str, deque[float]] = defaultdict(deque)

    app = FastAPI(title="Tripp's Delivery API", version="1.0.0", docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")

    def require_admin(authorization: str | None) -> None:
        # An empty token means admin endpoints are switched off.
        supplied = (authorization or "").removeprefix("Bearer ").strip()
        if not token or not hmac.compare_digest(supplied.encode(), token.encode()):
            raise HTTPException(401, "Admin token required")

    def rate_limit(request: Request) -> None:
        # Caddy runs on the host and sets X-Forwarded-For; the last entry is the one Caddy saw.
        forwarded = request.headers.get("x-forwarded-for", "")
        who = forwarded.split(",")[-1].strip() or (request.client.host if request.client else "?")
        now = time.monotonic()
        hits = recent[who]
        while hits and now - hits[0] > 3600:
            hits.popleft()
        if len(hits) >= ORDERS_PER_HOUR:
            raise HTTPException(429, "Too many orders from here. Try again later.")
        hits.append(now)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "water": games.water()}

    @app.get("/api/stock")
    def stock() -> dict:
        return {"water": games.water(), "prices": PRICES, "max_per_order": MAX_PER_ORDER}

    @app.post("/api/orders", status_code=201)
    def create_order(body: OrderIn, request: Request) -> dict:
        name = _CONTROL.sub("", body.name).strip()
        if not name:
            raise HTTPException(422, "Please type your name")
        if body.water + body.dog + body.lawn == 0:
            raise HTTPException(422, "Pick at least one thing")
        rate_limit(request)
        try:
            order = games.place_order(name, body.water, body.dog, body.lawn)
        except OutOfStock as exc:
            raise HTTPException(409, f"Only {exc.available} water left") from exc
        emailed = mailer.notify(order)
        if emailed:
            games.mark_emailed(order["id"])
        return {**order, "emailed": emailed, "water_left": games.water()}

    @app.get("/api/orders")
    def list_orders(limit: int = 50, authorization: str | None = Header(default=None)) -> dict:
        require_admin(authorization)
        return {"orders": games.orders(max(1, min(limit, 200)))}

    @app.put("/api/stock")
    def set_stock(body: StockIn, authorization: str | None = Header(default=None)) -> dict:
        require_admin(authorization)
        games.set_water(body.water)
        return {"water": games.water()}

    return app


app = create_app()
