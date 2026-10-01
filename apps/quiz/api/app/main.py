"""Portal Quiz API: https://quiz.2haks.xyz/api"""

from __future__ import annotations

import os
from collections import Counter
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .game import LEADERBOARD_SIZE, GameError, GameStore
from .questions import BankCache

QUESTIONS_FILE = Path(os.environ.get("QUESTIONS_FILE", "/content/questions.json"))
DB_FILE = Path(os.environ.get("QUIZ_DB", "/var/lib/quiz/quiz.db"))


class NewGame(BaseModel):
    category: str | None = Field(default=None, max_length=24)


class Answer(BaseModel):
    round: int = Field(ge=0, le=100)
    choice: int = Field(ge=0, le=3)


class Finish(BaseModel):
    name: str = Field(max_length=64)


def create_app(questions_file: Path = QUESTIONS_FILE, db_file: Path = DB_FILE, store: GameStore | None = None) -> FastAPI:
    bank = BankCache(questions_file)
    games = store or GameStore(db_file)

    app = FastAPI(
        title="Portal Quiz API",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )

    @app.exception_handler(GameError)
    async def game_error(_: Request, exc: GameError) -> JSONResponse:
        return JSONResponse({"detail": exc.message}, status_code=exc.status)

    @app.get("/api/health")
    def health():
        questions = bank.get()
        try:
            games.check()
        except Exception as e:  # noqa: BLE001 - report any database problem
            return JSONResponse({"status": "error", "detail": f"database: {e}"}, status_code=503)
        if not questions:
            return JSONResponse({"status": "error", "detail": bank.error or "no questions"}, status_code=503)
        if bank.error:
            return {"status": "degraded", "questions": len(questions), "detail": bank.error}
        return {"status": "ok", "questions": len(questions)}

    @app.get("/api/categories")
    def categories():
        counts = Counter(q.category for q in bank.get())
        return {"categories": [{"name": name, "questions": n} for name, n in sorted(counts.items())]}

    @app.get("/api/questions")
    def questions(category: str | None = Query(default=None, max_length=24)):
        """Every question, without the answers."""
        return {
            "questions": [
                {"id": q.id, "category": q.category, "question": q.question, "choices": list(q.choices)}
                for q in bank.get()
                if category is None or q.category.casefold() == category.casefold()
            ]
        }

    @app.post("/api/games", status_code=201)
    def new_game(body: NewGame | None = None):
        questions = bank.get()
        if not questions:
            raise HTTPException(503, "no questions available")
        return games.new_game(questions, body.category if body else None)

    @app.post("/api/games/{game_id}/answer")
    def answer(game_id: str, body: Answer):
        r = games.answer(game_id, body.round, body.choice)
        return {
            "correct": r.correct,
            "points": r.points,
            "score": r.score,
            "round": r.round,
            "finished": r.finished,
            "correct_first_try": r.correct_first,
        }

    @app.post("/api/games/{game_id}/finish", status_code=201)
    def finish(game_id: str, body: Finish):
        return games.finish(game_id, body.name)

    @app.get("/api/leaderboard")
    def leaderboard(limit: int = Query(default=LEADERBOARD_SIZE, ge=1, le=50)):
        return {"leaderboard": games.leaderboard(limit)}

    return app


app = create_app() if os.environ.get("QUIZ_NO_AUTOAPP") != "1" else None
