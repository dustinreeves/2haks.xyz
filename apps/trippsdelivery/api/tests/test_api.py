import pytest
from fastapi.testclient import TestClient

from app import mailer
from app.main import create_app
from app.store import Store


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(mailer, "notify", lambda order: True)
    return TestClient(create_app(Store(tmp_path / "t.db"), admin_token="secret"))


def test_stock_starts_at_24(client):
    assert client.get("/api/stock").json()["water"] == 24


def test_order_prices_and_stock(client):
    r = client.post("/api/orders", json={"name": "Sam", "water": 3, "dog": 1, "lawn": 1})
    assert r.status_code == 201
    assert r.json()["total"] == 3 * 2 + 95 + 39
    assert client.get("/api/stock").json()["water"] == 21


def test_cannot_order_more_water_than_stock(client):
    client.put("/api/stock", json={"water": 2}, headers={"Authorization": "Bearer secret"})
    assert client.post("/api/orders", json={"name": "Sam", "water": 3}).status_code == 409
    assert client.get("/api/stock").json()["water"] == 2


def test_empty_order_and_blank_name_rejected(client):
    assert client.post("/api/orders", json={"name": "Sam"}).status_code == 422
    assert client.post("/api/orders", json={"name": "  \n ", "water": 1}).status_code == 422


def test_admin_endpoints_need_token(client):
    assert client.get("/api/orders").status_code == 401
    assert client.get("/api/orders", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/api/orders", headers={"Authorization": "Bearer secret"}).status_code == 200


def test_admin_off_without_token(tmp_path):
    c = TestClient(create_app(Store(tmp_path / "t.db"), admin_token=""))
    assert c.get("/api/orders", headers={"Authorization": "Bearer "}).status_code == 401


def test_rate_limit(client):
    for _ in range(10):
        assert client.post("/api/orders", json={"name": "Sam", "dog": 1}).status_code == 201
    assert client.post("/api/orders", json={"name": "Sam", "dog": 1}).status_code == 429
