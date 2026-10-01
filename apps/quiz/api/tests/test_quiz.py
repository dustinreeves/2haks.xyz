import json
import os
import random

import pytest

os.environ["QUIZ_NO_AUTOAPP"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app.game import GameError, GameStore, clean_name, points_for  # noqa: E402
from app.main import create_app  # noqa: E402
from app.questions import Question, QuestionError, load_bank, parse_bank, save_bank  # noqa: E402

GOOD = {"id": "q-01", "category": "Space", "question": "Closest planet?", "choices": ["Mercury", "Venus", "Earth", "Mars"], "answer": 0}


def bank(n=12, category="Space"):
    return [Question(f"q-{i:02d}", category, f"Question {i}?", ("a", "b", "c", "d"), i % 4) for i in range(n)]


# ---------- questions ----------

def test_parse_good_bank():
    (q,) = parse_bank({"questions": [GOOD]})
    assert q.choices[q.answer] == "Mercury"


@pytest.mark.parametrize("change", [
    {"id": "Bad ID"},
    {"choices": ["a", "b", "c"]},
    {"choices": ["a", "a", "b", "c"]},
    {"answer": 4},
    {"answer": True},
    {"question": ""},
    {"extra": 1},
])
def test_bad_questions_are_rejected(change):
    with pytest.raises(QuestionError):
        parse_bank({"questions": [{**GOOD, **change}]})


def test_duplicate_ids_rejected():
    with pytest.raises(QuestionError, match="duplicate"):
        parse_bank({"questions": [GOOD, GOOD]})


def test_save_then_load_roundtrip(tmp_path):
    path = tmp_path / "questions.json"
    save_bank(path, bank(3))
    assert [q.id for q in load_bank(path)] == ["q-00", "q-01", "q-02"]


def test_shipped_questions_are_valid():
    path = os.path.join(os.path.dirname(__file__), "..", "..", "content", "questions.json")
    if not os.path.exists(path):
        pytest.skip("content/ not mounted")
    assert len(load_bank(path)) >= 10


# ---------- scoring and names ----------

def test_points():
    assert points_for(0, 0) == 150
    assert points_for(0, 4) == 140
    assert points_for(0, 60) == 100
    assert points_for(1, 0) == 50
    assert points_for(3, 0) == 0


@pytest.mark.parametrize("name", ["", "x" * 13, "<script>", "b4dpoop", "F.U.C.K"])
def test_bad_names(name):
    with pytest.raises(GameError):
        clean_name(name)


def test_good_name_is_tidied():
    assert clean_name("  Tripp   R ") == "Tripp R"


# ---------- games ----------

@pytest.fixture
def store(tmp_path):
    return GameStore(tmp_path / "quiz.db", rng=random.Random(1))


def answers_for(store, game_id):
    import sqlite3
    with sqlite3.connect(store.db_path) as db:
        (rounds,) = db.execute("SELECT rounds FROM games WHERE id = ?", (game_id,)).fetchone()
    return [r["answer"] for r in json.loads(rounds)]


def test_full_game(store):
    g = store.new_game(bank(), None, now=1000)
    assert len(g["rounds"]) == 10
    assert all("answer" not in r for r in g["rounds"])
    answers = answers_for(store, g["game_id"])

    wrong = (answers[0] + 1) % 4
    r = store.answer(g["game_id"], 0, wrong, now=1001)
    assert not r.correct and r.score == 0
    store.answer(g["game_id"], 0, wrong, now=1002)  # same wrong choice again: no extra cost
    r = store.answer(g["game_id"], 0, answers[0], now=1003)
    assert r.correct and r.points == 50

    t = 1003
    for i in range(1, 10):
        t += 2
        r = store.answer(g["game_id"], i, answers[i], now=t)
        assert r.correct and r.points == 145
    assert r.finished and r.score == 50 + 9 * 145 and r.correct_first == 9

    with pytest.raises(GameError):
        store.answer(g["game_id"], 10, 0, now=t)

    entry = store.finish(g["game_id"], "Tripp", now=t)
    assert entry["rank"] == 1
    with pytest.raises(GameError, match="already"):
        store.finish(g["game_id"], "Tripp", now=t)
    assert store.leaderboard()[0]["name"] == "Tripp"


def test_cannot_skip_rounds_or_finish_early(store):
    g = store.new_game(bank(), None, now=0)
    with pytest.raises(GameError):
        store.answer(g["game_id"], 3, 0, now=1)
    with pytest.raises(GameError, match="finish all"):
        store.finish(g["game_id"], "Tripp", now=1)


def test_category_filter_and_expiry(store):
    with pytest.raises(GameError):
        store.new_game(bank(), "Animals", now=0)
    g = store.new_game(bank(3), "space", now=0)
    assert len(g["rounds"]) == 3
    with pytest.raises(GameError, match="expired"):
        store.answer(g["game_id"], 0, 0, now=10 * 60 * 60)


# ---------- HTTP API ----------

def test_api_end_to_end(tmp_path):
    qfile = tmp_path / "questions.json"
    save_bank(qfile, bank())
    store = GameStore(tmp_path / "quiz.db")
    client = TestClient(create_app(qfile, tmp_path / "quiz.db", store))

    assert client.get("/api/health").json() == {"status": "ok", "questions": 12}
    assert client.get("/api/categories").json()["categories"] == [{"name": "Space", "questions": 12}]
    assert "answer" not in client.get("/api/questions").json()["questions"][0]

    g = client.post("/api/games", json={}).json()
    answers = answers_for(store, g["game_id"])
    for i, a in enumerate(answers):
        body = client.post(f"/api/games/{g['game_id']}/answer", json={"round": i, "choice": a}).json()
        assert body["correct"]
    assert body["finished"]

    assert client.post(f"/api/games/{g['game_id']}/finish", json={"name": "Dustin"}).status_code == 201
    assert client.get("/api/leaderboard").json()["leaderboard"][0]["name"] == "Dustin"
    assert client.post("/api/games/nope/answer", json={"round": 0, "choice": 0}).status_code == 404
    assert client.post(f"/api/games/{g['game_id']}/answer", json={"round": 0, "choice": 9}).status_code == 422


def test_health_degraded_keeps_last_good_copy(tmp_path):
    qfile = tmp_path / "questions.json"
    save_bank(qfile, bank())
    client = TestClient(create_app(qfile, tmp_path / "quiz.db"))
    assert client.get("/api/health").json()["status"] == "ok"
    qfile.write_text("{ broken", encoding="utf-8")
    os.utime(qfile, ns=(1, 1))
    body = client.get("/api/health").json()
    assert body["status"] == "degraded" and body["questions"] == 12
