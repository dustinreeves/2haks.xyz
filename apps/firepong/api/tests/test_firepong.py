"""Tests for the Fire Pong API and the power-up files. Run them as shown in RUNBOOK.md."""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest

os.environ["FIREPONG_NO_AUTOAPP"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app import matches as matches_module  # noqa: E402
from app.main import create_app  # noqa: E402
from app.powerups import PowerupError, load_powerups, validate_powerup  # noqa: E402

REAL_POWERUPS = Path(__file__).resolve().parents[2] / "content" / "powerups"


@pytest.fixture()
def powerups_dir(tmp_path: Path) -> Path:
    dest = tmp_path / "powerups"
    shutil.copytree(REAL_POWERUPS, dest)
    return dest


@pytest.fixture()
def client(powerups_dir: Path, tmp_path: Path) -> TestClient:
    return TestClient(create_app(powerups_dir, tmp_path / "db" / "test.db"))


def good_match(**over):
    body = {"name": "Tripp", "difficulty": "normal", "player_score": 7, "ai_score": 3, "seconds": 120.5,
            "powerups": True}
    body.update(over)
    return body


# --- the real power-up files ---------------------------------------------------------------

def test_real_powerups_are_valid():
    found = load_powerups(REAL_POWERUPS)
    assert len(found) >= 8
    assert {p["effect"] for p in found} >= {"big_paddle", "multiball", "portals"}


def test_validate_rejects_mistakes():
    base = json.loads((REAL_POWERUPS / "shield.json").read_text())
    for patch, text in [
        ({"effect": "explode"}, "effect"),
        ({"color": "red"}, "color"),
        ({"duration": 99}, "duration"),
        ({"weight": 0}, "weight"),
        ({"weight": 2.5}, "weight"),
        ({"id": "Bad Id"}, "id"),
        ({"name": ""}, "name"),
        ({"secret": 1}, "unknown"),
    ]:
        with pytest.raises(PowerupError, match=text):
            validate_powerup({**base, **patch})


def test_file_name_must_match_id(tmp_path: Path):
    raw = json.loads((REAL_POWERUPS / "shield.json").read_text())
    (tmp_path / "other.json").write_text(json.dumps(raw))
    with pytest.raises(PowerupError, match="file name"):
        load_powerups(tmp_path)


# --- API -----------------------------------------------------------------------------------

def test_health_ok(client: TestClient):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_powerups_list_and_detail(client: TestClient):
    items = client.get("/api/powerups").json()["powerups"]
    assert len(items) >= 8
    one = client.get("/api/powerups/portals")
    assert one.status_code == 200 and one.json()["effect"] == "portals"
    assert client.get("/api/powerups/nope").status_code == 404


def test_broken_edit_keeps_last_good_set(client: TestClient, powerups_dir: Path):
    before = len(client.get("/api/powerups").json()["powerups"])
    (powerups_dir / "shield.json").write_text("{ not json")
    assert len(client.get("/api/powerups").json()["powerups"]) == before
    health = client.get("/api/health").json()
    assert health["status"] == "degraded"


def test_new_powerup_file_is_picked_up(client: TestClient, powerups_dir: Path):
    before = len(client.get("/api/powerups").json()["powerups"])
    raw = json.loads((powerups_dir / "shield.json").read_text())
    raw["id"] = "mega_shield"
    (powerups_dir / "mega_shield.json").write_text(json.dumps(raw))
    assert len(client.get("/api/powerups").json()["powerups"]) == before + 1


def test_match_is_saved_and_listed(client: TestClient):
    r = client.post("/api/matches", json=good_match())
    assert r.status_code == 201 and r.json()["rank"] == 1
    board = client.get("/api/leaderboard").json()["leaderboard"]
    assert board[0]["name"] == "Tripp" and board[0]["score"] == "7-3"


@pytest.mark.parametrize("patch", [
    {"player_score": 6},                 # you must win
    {"ai_score": 7},
    {"ai_score": -1},
    {"seconds": 3},                      # too fast to be real
    {"seconds": 99999},
    {"difficulty": "impossible"},
    {"name": ""},
    {"name": "<script>"},
    {"name": "a" * 13},
    {"powerups": "maybe"},
])
def test_bad_matches_are_refused(client: TestClient, patch):
    assert client.post("/api/matches", json=good_match(**patch)).status_code == 422


def test_leaderboard_order(client: TestClient):
    client.post("/api/matches", json=good_match(name="Easy", difficulty="easy", ai_score=0, seconds=30))
    client.post("/api/matches", json=good_match(name="HardSlow", difficulty="hard", ai_score=5, seconds=300))
    client.post("/api/matches", json=good_match(name="HardBig", difficulty="hard", ai_score=1, seconds=200))
    client.post("/api/matches", json=good_match(name="HardBigFast", difficulty="hard", ai_score=1, seconds=100))
    names = [e["name"] for e in client.get("/api/leaderboard").json()["leaderboard"]]
    assert names == ["HardBigFast", "HardBig", "HardSlow", "Easy"]


def test_leaderboard_limit(client: TestClient):
    for i in range(3):
        client.post("/api/matches", json=good_match(name=f"P{i}"))
    assert len(client.get("/api/leaderboard?limit=2").json()["leaderboard"]) == 2
    assert client.get("/api/leaderboard?limit=0").status_code == 422


def test_rate_limit(client: TestClient):
    codes = [client.post("/api/matches", json=good_match()).status_code
             for _ in range(matches_module.MAX_PER_MINUTE + 1)]
    assert codes[:-1] == [201] * matches_module.MAX_PER_MINUTE
    assert codes[-1] == 429
