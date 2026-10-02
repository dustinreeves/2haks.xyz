import copy
import json
import os
from pathlib import Path

import pytest

os.environ["PORTAL_NO_AUTOAPP"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app import runs as runs_mod  # noqa: E402
from app.levels import LevelError, load_levels, validate_level  # noqa: E402
from app.main import create_app  # noqa: E402
from app.runs import RunError, RunStore, clean_name  # noqa: E402

LEVEL = {
    "id": "01-test",
    "order": 1,
    "name": "Test",
    "intro": "Hello.",
    "gun": "both",
    "start": {"pos": [0, 1.6, 0], "yaw": 0},
    "room": {"min": [-5, 0, -5], "max": [5, 5, 5], "type": "metal"},
    "boxes": [{"min": [-5, 0, -1], "max": [-4.8, 4, 1], "type": "white"}],
    "doors": [{"id": "d1", "min": [-1, 0, -4], "max": [1, 3, -3.8]}],
    "buttons": [{"pos": [2, 0, 0], "opens": ["d1"]}],
    "cubes": [{"pos": [0, 0.3, 2]}],
    "exit": {"min": [-1, 0, -5], "max": [1, 3, -4.5]},
}

SHIPPED = Path(__file__).resolve().parents[2] / "content" / "levels"


def level(**changes):
    lv = copy.deepcopy(LEVEL)
    lv.update(changes)
    return lv


def write_levels(folder: Path, *lvs):
    folder.mkdir(parents=True, exist_ok=True)
    for lv in lvs:
        (folder / f"{lv['id']}.json").write_text(json.dumps(lv), encoding="utf-8")


# ---------- levels ----------

def test_good_level():
    lv = validate_level(LEVEL)
    assert lv["room"]["floor"] is True and lv["hint"] == ""


@pytest.mark.parametrize("change", [
    {"id": "test"},
    {"gun": "red"},
    {"start": {"pos": [50, 1, 0], "yaw": 0}},
    {"boxes": [{"min": [0, 0, 0], "max": [0, 1, 1], "type": "white"}]},
    {"boxes": [{"min": [0, 0, 0], "max": [1, 1, 1], "type": "lava"}]},
    {"buttons": [{"pos": [0, 0, 0], "opens": ["nope"]}]},
    {"buttons": []},
    {"fixed_portals": [{"color": "orange", "pos": [0, 1, 0], "normal": [0, 0, -1]}]},
    {"gun": "blue"},
    {"surprise": True},
])
def test_bad_levels_rejected(change):
    with pytest.raises(LevelError):
        validate_level(level(**change))


def test_blue_gun_with_fixed_orange_ok():
    validate_level(level(gun="blue", fixed_portals=[{"color": "orange", "pos": [0, 1, -5], "normal": [0, 0, 1]}]))


def test_file_name_must_match_id(tmp_path):
    (tmp_path / "02-wrong.json").write_text(json.dumps(LEVEL), encoding="utf-8")
    with pytest.raises(LevelError, match="file name"):
        load_levels(tmp_path)


def test_shipped_levels_are_valid():
    if not SHIPPED.exists():
        pytest.skip("content/ not available")
    levels = load_levels(SHIPPED)
    assert [lv["order"] for lv in levels] == sorted(lv["order"] for lv in levels)
    assert len(levels) >= 5


# ---------- runs ----------

@pytest.fixture
def store(tmp_path):
    return RunStore(tmp_path / "portal.db")


def test_names():
    assert clean_name("  Jim   Core ") == "Jim Core"
    for bad in ["", "x" * 13, "<b>", "poopy"]:
        with pytest.raises(RunError):
            clean_name(bad)


def test_full_run(store):
    r = store.new_run(["01-a", "02-b"], now=1000)
    with pytest.raises(RunError, match="next chamber"):
        store.complete(r["run_id"], "02-b", now=1010)
    with pytest.raises(RunError, match="impossibly"):
        store.complete(r["run_id"], "01-a", now=1001)
    a = store.complete(r["run_id"], "01-a", now=1020)
    assert a == {"level": "01-a", "seconds": 20, "total_seconds": 20, "done": 1, "next": "02-b", "finished": False}
    with pytest.raises(RunError, match="finish every"):
        store.finish(r["run_id"], "Tripp", now=1021)
    b = store.complete(r["run_id"], "02-b", now=1050)
    assert b["finished"] and b["total_seconds"] == 50
    with pytest.raises(RunError, match="already finished"):
        store.complete(r["run_id"], "02-b", now=1060)

    entry = store.finish(r["run_id"], "Tripp", now=1060)
    assert entry["seconds"] == 50 and entry["rank"] == 1
    with pytest.raises(RunError, match="already on"):
        store.finish(r["run_id"], "Tripp", now=1061)


def test_faster_run_ranks_first(store):
    for name, took in [("Slow", 100), ("Fast", 40)]:
        r = store.new_run(["01-a"], now=0)
        store.complete(r["run_id"], "01-a", now=took)
        store.finish(r["run_id"], name, now=took)
    assert [row["name"] for row in store.leaderboard()] == ["Fast", "Slow"]


def test_runs_expire(store):
    r = store.new_run(["01-a"], now=0)
    with pytest.raises(RunError, match="expired"):
        store.complete(r["run_id"], "01-a", now=runs_mod.RUN_TTL_SECONDS + 10)


# ---------- HTTP API ----------

def test_api_end_to_end(tmp_path, monkeypatch):
    write_levels(tmp_path / "levels", LEVEL, level(id="02-next", order=2))
    client = TestClient(create_app(tmp_path / "levels", tmp_path / "portal.db"))

    assert client.get("/api/health").json() == {"status": "ok", "levels": 2}
    assert [lv["id"] for lv in client.get("/api/levels").json()["levels"]] == ["01-test", "02-next"]
    assert client.get("/api/levels/01-test").json()["cubes"] == [{"pos": [0.0, 0.3, 2.0]}]
    assert client.get("/api/levels/99-nope").status_code == 404

    clock = [1000.0]
    monkeypatch.setattr(runs_mod.time, "time", lambda: clock[0])
    run = client.post("/api/runs").json()
    for lid in run["levels"]:
        clock[0] += 30
        res = client.post(f"/api/runs/{run['run_id']}/complete", json={"level": lid})
        assert res.status_code == 200, res.text
    assert res.json()["finished"]

    res = client.post(f"/api/runs/{run['run_id']}/finish", json={"name": "Dustin"})
    assert res.status_code == 201 and res.json()["seconds"] == 60
    assert client.get("/api/leaderboard").json()["leaderboard"][0]["name"] == "Dustin"
    assert client.post("/api/runs/nope/complete", json={"level": "01-test"}).status_code == 404


def test_broken_level_file_keeps_last_good(tmp_path):
    folder = tmp_path / "levels"
    write_levels(folder, LEVEL)
    client = TestClient(create_app(folder, tmp_path / "portal.db"))
    assert client.get("/api/health").json()["status"] == "ok"
    (folder / "01-test.json").write_text("{ broken", encoding="utf-8")
    os.utime(folder / "01-test.json", ns=(1, 1))
    body = client.get("/api/health").json()
    assert body["status"] == "degraded" and body["levels"] == 1
