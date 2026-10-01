"""Pixel art maker: a tiny API for saving drawings, plus the web editor."""

import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from .png import encode_png

DB_PATH = Path(os.environ.get("PIXEL_DB", "/data/pixel.db"))
STATIC_DIR = Path(__file__).parent / "static"

SIZES = (20, 40)
COLOR_RE = re.compile(r"^#[0-9a-f]{6}$")
# PICO-8's 16 colours: bright, friendly and easy to tell apart.
PALETTE = [
    "#000000", "#1d2b53", "#7e2553", "#008751",
    "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
    "#ff004d", "#ffa300", "#ffec27", "#00e436",
    "#29adff", "#83769c", "#ff77a8", "#ffccaa",
]

@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS drawings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                size INTEGER NOT NULL,
                pixels TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                created REAL NOT NULL,
                updated REAL NOT NULL
            )"""
        )


@asynccontextmanager
async def lifespan(_app):
    init_db()
    yield


app = FastAPI(title="Pixel", description="Make and share pixel art.", version="1.0.0", lifespan=lifespan)


class DrawingIn(BaseModel):
    title: str = Field("Untitled", max_length=60)
    author: str = Field("", max_length=30)
    size: int
    # One entry per cell, row by row. None means "see-through".
    pixels: list[str | None]

    @field_validator("title", "author")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("size")
    @classmethod
    def check_size(cls, v: int) -> int:
        if v not in SIZES:
            raise ValueError(f"size must be one of {SIZES}")
        return v

    @field_validator("pixels")
    @classmethod
    def check_pixels(cls, v, info):
        size = info.data.get("size")
        if size and len(v) != size * size:
            raise ValueError(f"expected {size * size} pixels, got {len(v)}")
        for p in v:
            if p is not None and not COLOR_RE.match(p):
                raise ValueError(f"bad colour {p!r}; use #rrggbb in lowercase")
        return v


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def row_to_dict(row: sqlite3.Row, with_pixels: bool = True) -> dict:
    d = {
        "id": row["id"],
        "title": row["title"] or "Untitled",
        "author": row["author"],
        "size": row["size"],
        "created": row["created"],
        "updated": row["updated"],
    }
    if with_pixels:
        d["pixels"] = json.loads(row["pixels"])
    return d


def load(drawing_id: str) -> sqlite3.Row:
    with db() as conn:
        row = conn.execute("SELECT * FROM drawings WHERE id = ?", (drawing_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "No drawing with that id")
    return row


def check_token(row: sqlite3.Row, token: str | None):
    if not token or not secrets.compare_digest(hash_token(token), row["token_hash"]):
        raise HTTPException(403, "Only the person who made this drawing can change it")


@app.get("/api/health")
def health():
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM drawings").fetchone()[0]
    return {"ok": True, "drawings": count}


@app.get("/api/palette")
def palette():
    return {"sizes": SIZES, "colors": PALETTE}


@app.get("/api/drawings")
def list_drawings(limit: int = Query(60, ge=1, le=200)):
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM drawings ORDER BY updated DESC LIMIT ?", (limit,)
        ).fetchall()
    return [row_to_dict(r, with_pixels=False) for r in rows]


@app.post("/api/drawings", status_code=201)
def create_drawing(body: DrawingIn):
    drawing_id = secrets.token_hex(4)
    token = secrets.token_urlsafe(24)
    now = time.time()
    with db() as conn:
        conn.execute(
            "INSERT INTO drawings VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (drawing_id, body.title, body.author, body.size,
             json.dumps(body.pixels), hash_token(token), now, now),
        )
    # The edit token is shown once. Whoever holds it can change or delete the drawing.
    return {**row_to_dict(load(drawing_id)), "edit_token": token}


@app.get("/api/drawings/{drawing_id}")
def get_drawing(drawing_id: str):
    return row_to_dict(load(drawing_id))


@app.put("/api/drawings/{drawing_id}")
def update_drawing(drawing_id: str, body: DrawingIn, x_edit_token: str | None = Header(None)):
    check_token(load(drawing_id), x_edit_token)
    with db() as conn:
        conn.execute(
            "UPDATE drawings SET title=?, author=?, size=?, pixels=?, updated=? WHERE id=?",
            (body.title, body.author, body.size, json.dumps(body.pixels), time.time(), drawing_id),
        )
    return row_to_dict(load(drawing_id))


@app.delete("/api/drawings/{drawing_id}", status_code=204)
def delete_drawing(drawing_id: str, x_edit_token: str | None = Header(None)):
    check_token(load(drawing_id), x_edit_token)
    with db() as conn:
        conn.execute("DELETE FROM drawings WHERE id = ?", (drawing_id,))
    return Response(status_code=204)


@app.get("/api/drawings/{drawing_id}/png")
def drawing_png(drawing_id: str, scale: int = Query(10, ge=1, le=32)):
    row = load(drawing_id)
    png = encode_png(json.loads(row["pixels"]), row["size"], scale)
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-cache"})


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
