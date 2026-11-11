"""Fire Pong API: https://firepong.2haks.xyz/api"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .matches import LEADERBOARD_SIZE, TARGET_SCORE, MatchError, MatchStore
from .powerups import PowerupCache

POWERUPS_DIR = Path(os.environ.get("POWERUPS_DIR", "/content/powerups"))
DB_FILE = Path(os.environ.get("FIREPONG_DB", "/var/lib/firepong/firepong.db"))


class Match(BaseModel):
    """A match the player won against the computer."""

    name: str = Field(min_length=1, max_length=12, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _\-]*$")
    difficulty: Literal["easy", "normal", "hard"]
    player_score: int = Field(ge=TARGET_SCORE, le=TARGET_SCORE)
    ai_score: int = Field(ge=0, le=TARGET_SCORE - 1)
    seconds: float = Field(ge=15, le=3600)
    powerups: bool


def create_app(powerups_dir: Path = POWERUPS_DIR, db_file: Path = DB_FILE) -> FastAPI:
    powerups = PowerupCache(powerups_dir)
    matches = MatchStore(db_file)

    app = FastAPI(
        title="Fire Pong API",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )

    @app.exception_handler(MatchError)
    async def match_error(_: Request, exc: MatchError) -> JSONResponse:
        return JSONResponse({"detail": exc.message}, status_code=exc.status)

    @app.get("/api/health")
    def health():
        current = powerups.get()
        try:
            matches.check()
        except Exception as e:  # noqa: BLE001 - report any database problem
            return JSONResponse({"status": "error", "detail": f"database: {e}"}, status_code=503)
        if not current:
            return JSONResponse({"status": "error", "detail": powerups.error or "no power-ups"}, status_code=503)
        if powerups.error:
            return {"status": "degraded", "powerups": len(current), "detail": powerups.error}
        return {"status": "ok", "powerups": len(current)}

    @app.get("/api/powerups")
    def list_powerups():
        return {"powerups": powerups.get()}

    @app.get("/api/powerups/{powerup_id}")
    def get_powerup(powerup_id: str):
        for p in powerups.get():
            if p["id"] == powerup_id:
                return p
        raise HTTPException(404, "no such power-up")

    @app.post("/api/matches", status_code=201)
    def add_match(body: Match):
        return matches.add(body.name.strip(), body.difficulty, body.player_score, body.ai_score,
                           body.seconds, body.powerups)

    @app.get("/api/leaderboard")
    def leaderboard(limit: int = Query(default=LEADERBOARD_SIZE, ge=1, le=50)):
        return {"leaderboard": matches.leaderboard(limit)}

    return app


app = create_app() if os.environ.get("FIREPONG_NO_AUTOAPP") != "1" else None
