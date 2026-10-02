import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.catalog import Catalog, DesignError, check_catalog, load_catalog
from app.main import create_app
from app import store as store_module

PARTS = Path(__file__).resolve().parents[2] / "content" / "parts.json"


@pytest.fixture()
def cat() -> Catalog:
    return Catalog(load_catalog(PARTS))


@pytest.fixture()
def client(tmp_path):
    return TestClient(create_app(PARTS, tmp_path / "designs.db"))


def duck_longboi():
    return {
        "base": "longboi",
        "parts": {"barrel": "barrel_long", "muzzle": "muzzle_duck", "magazine": "mag_box"},
        "paint": {"body": "#112233", "accent": "#FF0000", "finish": "gold"},
    }


def test_real_catalog_is_valid():
    assert check_catalog(json.loads(PARTS.read_text(encoding="utf-8"))) == []


def test_every_part_fits_at_least_one_base(cat):
    for part in cat.parts.values():
        fits = [b for b in cat.bases.values() if not part.get("classes") or b["class"] in part["classes"]]
        assert fits, part["id"]


def test_catalog_problems_are_reported():
    data = json.loads(PARTS.read_text(encoding="utf-8"))
    data["parts"][0]["shapes"][0]["t"] = "blob"
    data["parts"][1]["id"] = data["parts"][0]["id"]
    errs = check_catalog(data)
    assert any("unknown shape type" in e for e in errs)
    assert any("duplicate id" in e for e in errs)


def test_check_design_canonical_form(cat):
    clean = cat.check_design(duck_longboi())
    assert list(clean["parts"]) == ["barrel", "muzzle", "magazine"]  # slot order
    assert clean["paint"] == {"body": "#112233", "accent": "#ff0000", "finish": "gold"}


def test_check_design_drops_empty_slots(cat):
    d = duck_longboi()
    d["parts"]["grip"] = None
    assert "grip" not in cat.check_design(d)["parts"]


@pytest.mark.parametrize("change, message", [
    (lambda d: d.update(base="nope"), "unknown base"),
    (lambda d: d["parts"].update(barrel="muzzle_duck"), "isn't a barrel part"),
    (lambda d: d["parts"].update(magazine="mag_pistol_ext"), "doesn't fit"),
    (lambda d: d["parts"].pop("barrel"), "nothing to attach the muzzle"),
    (lambda d: d["paint"].update(body="red"), "colours"),
    (lambda d: d["paint"].update(finish="glitter"), "unknown finish"),
    (lambda d: d["parts"].update(hat="x"), "unknown slot"),
])
def test_bad_designs_are_refused(cat, change, message):
    d = duck_longboi()
    change(d)
    with pytest.raises(DesignError, match=message):
        cat.check_design(d)


def test_stats_add_up_and_clamp(cat):
    clean = cat.check_design(duck_longboi())
    s = cat.compute_stats(clean)
    # longboi 85 range + 20 long barrel -> clamped to 100
    assert s["range"] == 100
    # 5 base + 40 duck + 5 gold
    assert s["goofiness"] == 50
    assert all(0 <= v <= 100 for v in s.values())


def test_names(cat):
    # The goofiest nicknamed part wins; these must match web/public/js/rules.js.
    assert cat.design_name(cat.check_design(duck_longboi())) == "Golden Quacking Longboi"
    plain = cat.check_design({"base": "sidekick", "parts": {"barrel": "barrel_std"}})
    assert cat.design_name(plain) == "Stealthy Sidekick"
    tie = cat.check_design({"base": "buzzbox", "parts": {"barrel": "barrel_long", "optic": "optic_scope"}})
    assert cat.design_name(tie) == "Stealthy Long-Range Buzzbox"  # equal goofiness: earlier slot wins


def test_health_and_parts(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and h["bases"] == 5 and h["designs"] == 0
    assert {b["id"] for b in client.get("/api/parts").json()["bases"]} >= {"sidekick", "longboi"}


def test_save_get_and_dedupe(client):
    r = client.post("/api/designs", json=duck_longboi())
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Golden Quacking Longboi"
    assert len(body["code"]) == 6 and body["stats"]["goofiness"] == 50
    again = client.post("/api/designs", json=duck_longboi())
    assert again.status_code == 200 and again.json()["code"] == body["code"]
    got = client.get(f"/api/designs/{body['code'].upper()}")
    assert got.status_code == 200 and got.json()["design"] == body["design"]
    listed = client.get("/api/designs").json()["designs"]
    assert [d["code"] for d in listed] == [body["code"]]
    assert client.get("/api/designs?base=sidekick").json()["designs"] == []


def test_bad_save_and_missing_code(client):
    r = client.post("/api/designs", json={"base": "longboi", "parts": {"muzzle": "muzzle_duck"}})
    assert r.status_code == 422 and "attach" in r.json()["detail"]
    assert client.get("/api/designs/zzzzzz").status_code == 404
    assert client.get("/api/designs/../etc").status_code == 404


def test_check_endpoint(client):
    r = client.post("/api/check", json={"base": "zapomatic"})
    assert r.status_code == 200 and r.json()["name"] == "Stealthy Zap-o-Matic 3000"


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(store_module, "SAVES_PER_HOUR", 2)
    colours = ["#000001", "#000002", "#000003"]
    codes = []
    for c in colours:
        d = duck_longboi()
        d["paint"]["body"] = c
        codes.append(client.post("/api/designs", json=d, headers={"X-Forwarded-For": "1.2.3.4"}).status_code)
    assert codes == [201, 201, 429]
    d = duck_longboi()
    d["paint"]["body"] = "#000009"
    assert client.post("/api/designs", json=d, headers={"X-Forwarded-For": "5.6.7.8"}).status_code == 201
