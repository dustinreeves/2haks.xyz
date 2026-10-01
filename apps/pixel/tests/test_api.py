import struct
import zlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import main
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "test.db")
    with TestClient(main.app) as c:
        yield c


def drawing(size=20, **kw):
    pixels = [None] * (size * size)
    pixels[0] = "#ff004d"
    pixels[-1] = "#29adff"
    return {"title": "Test", "author": "Tripp", "size": size, "pixels": pixels, **kw}


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True, "drawings": 0}


def test_create_get_list(client):
    r = client.post("/api/drawings", json=drawing())
    assert r.status_code == 201
    d = r.json()
    assert d["edit_token"] and d["size"] == 20 and d["pixels"][0] == "#ff004d"

    got = client.get(f'/api/drawings/{d["id"]}').json()
    assert "edit_token" not in got and got["pixels"] == d["pixels"]

    listed = client.get("/api/drawings").json()
    assert [x["id"] for x in listed] == [d["id"]] and "pixels" not in listed[0]


@pytest.mark.parametrize("bad", [
    {"size": 30},
    {"pixels": [None] * 10},
    {"pixels": ["red"] + [None] * 399},
    {"pixels": ["#FF004D"] + [None] * 399},
    {"title": "x" * 61},
])
def test_rejects_bad_input(client, bad):
    assert client.post("/api/drawings", json={**drawing(), **bad}).status_code == 422


def test_40x40(client):
    assert client.post("/api/drawings", json=drawing(40)).status_code == 201


def test_update_and_delete_need_token(client):
    d = client.post("/api/drawings", json=drawing()).json()
    url = f'/api/drawings/{d["id"]}'

    assert client.put(url, json=drawing(title="Hacked")).status_code == 403
    assert client.put(url, json=drawing(title="Hacked"), headers={"X-Edit-Token": "nope"}).status_code == 403
    assert client.delete(url).status_code == 403

    ok = client.put(url, json=drawing(title="New name"), headers={"X-Edit-Token": d["edit_token"]})
    assert ok.status_code == 200 and ok.json()["title"] == "New name"

    assert client.delete(url, headers={"X-Edit-Token": d["edit_token"]}).status_code == 204
    assert client.get(url).status_code == 404


def test_png(client):
    d = client.post("/api/drawings", json=drawing()).json()
    r = client.get(f'/api/drawings/{d["id"]}/png?scale=3')
    assert r.headers["content-type"] == "image/png"
    png = r.content
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", png[16:24])
    assert (width, height) == (60, 60)

    # Decode IDAT and check the top-left pixel is red and see-through pixels are clear.
    idat_len = struct.unpack(">I", png[33:37])[0]
    raw = zlib.decompress(png[41:41 + idat_len])
    row = raw[1:1 + width * 4]
    assert row[:4] == bytes([0xff, 0x00, 0x4d, 0xff])
    assert row[3 * 4:3 * 4 + 4] == b"\x00\x00\x00\x00"


def test_frontend_served(client):
    assert "Pixel" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200
