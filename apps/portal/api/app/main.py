"""Portal Fan Lab API: https://portal.2haks.xyz/api"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .levels import LevelCache
from .runs import LEADERBOARD_SIZE, RunError, RunStore

LEVELS_DIR = Path(os.environ.get("LEVELS_DIR", "/content/levels"))
DB_FILE = Path(os.environ.get("PORTAL_DB", "/var/lib/portal/portal.db"))


class Complete(BaseModel):
    level: str = Field(min_length=1, max_length=48)


class Finish(BaseModel):
    name: str = Field(max_length=64)


def create_app(levels_dir: Path = LEVELS_DIR, db_file: Path = DB_FILE) -> FastAPI:
    levels = LevelCache(levels_dir)
    runs = RunStore(db_file)

    app = FastAPI(
        title="Portal Fan Lab API",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )

    @app.exception_handler(RunError)
    async def run_error(_: Request, exc: RunError) -> JSONResponse:
        return JSONResponse({"detail": exc.message}, status_code=exc.status)

    @app.get("/api/health")
    def health():
        current = levels.get()
        try:
            runs.check()
        except Exception as e:  # noqa: BLE001 - report any database problem
            return JSONResponse({"status": "error", "detail": f"database: {e}"}, status_code=503)
        if not current:
            return JSONResponse({"status": "error", "detail": levels.error or "no levels"}, status_code=503)
        if levels.error:
            return {"status": "degraded", "levels": len(current), "detail": levels.error}
        return {"status": "ok", "levels": len(current)}

    @app.get("/api/levels")
    def list_levels():
        return {"levels": [{"id": lv["id"], "order": lv["order"], "name": lv["name"]} for lv in levels.get()]}

    @app.get("/api/levels/{level_id}")
    def get_level(level_id: str):
        for lv in levels.get():
            if lv["id"] == level_id:
                return lv
        raise HTTPException(404, "no such test chamber")

    @app.post("/api/runs", status_code=201)
    def new_run():
        current = levels.get()
        if not current:
            raise HTTPException(503, "no test chambers available")
        return runs.new_run([lv["id"] for lv in current])

    @app.post("/api/runs/{run_id}/complete")
    def complete(run_id: str, body: Complete):
        return runs.complete(run_id, body.level)

    @app.post("/api/runs/{run_id}/finish", status_code=201)
    def finish(run_id: str, body: Finish):
        return runs.finish(run_id, body.name)

    @app.get("/api/leaderboard")
    def leaderboard(limit: int = Query(default=LEADERBOARD_SIZE, ge=1, le=50)):
        return {"leaderboard": runs.leaderboard(limit)}

    return app


app = create_app() if os.environ.get("PORTAL_NO_AUTOAPP") != "1" else None
