"""Real-world applications: train with Verify, predict, add readings and retrain."""

import base64
import time

import numpy as np
import pytest

from app.core.applications import APPLICATIONS, naqi_pm25
from app.core.surrogate import ThinPlate, grid_points
from app.services import applications as apps


@pytest.fixture(autouse=True)
def _fresh_models():
    apps.reset_memory()
    yield
    apps.reset_memory()


def _trained(client, key, budget=72):
    r = client.post(f"/api/apps/{key}/train", json={"pace_ms": 0, "budget": budget})
    assert r.status_code == 202, r.text
    for _ in range(600):
        s = client.get(f"/api/apps/{key}").json()
        if s["status"] != "training":
            return s
        time.sleep(0.05)
    raise AssertionError("training did not finish")


def test_reference_models_are_realistic():
    nodes = grid_points(25)
    air, traffic, weather = (APPLICATIONS[k].truth_unit(nodes) for k in ("air-quality", "traffic", "weather"))
    assert air.min() > 5 and air.max() < 200  # PM2.5, µg/m³
    assert traffic.min() >= 0 and traffic.max() < 120  # % extra travel time
    assert weather.min() > 10 and weather.max() < 45  # °C
    a = APPLICATIONS["air-quality"]
    morning_still, afternoon_windy = a.truth(np.array([8.5, 14.0]), np.array([1.0, 8.0]))
    assert morning_still > 3 * afternoon_windy
    t = APPLICATIONS["traffic"]
    friday_pm, sunday_am = t.truth(np.array([18.0, 6.0]), np.array([4.0, 6.0]))
    assert friday_pm > 60 > 10 > sunday_am


def test_naqi_breakpoints():
    assert naqi_pm25(0) == 0 and naqi_pm25(30) == 50 and naqi_pm25(60) == 100 and naqi_pm25(250) == 400


def test_smoothing_lets_a_noisy_point_pull_without_passing_through():
    rng = np.random.default_rng(0)
    pts = rng.random((40, 2))
    vals = np.sin(3 * pts[:, 0]) + pts[:, 1]
    q = np.array([[0.5, 0.5]])
    base = ThinPlate(pts, vals)(q)[0]
    p2, v2 = np.vstack([pts, q]), np.append(vals, base + 1.0)
    exact = ThinPlate(p2, v2)(q)[0]
    smooth = ThinPlate(p2, v2, np.r_[np.zeros(40), 1e-3])(q)[0]
    assert abs(exact - (base + 1.0)) < 1e-6
    assert base < smooth < base + 1.0


def test_list_and_unknown(client):
    r = client.get("/api/apps")
    assert r.status_code == 200
    assert [a["key"] for a in r.json()] == ["air-quality", "traffic", "weather"]
    assert client.get("/api/apps/nope").status_code == 404


def test_train_predict_and_retrain_on_new_readings(client):
    s = _trained(client, "weather")
    assert s["status"] in ("ready", "budget") and s["runs"] >= 12
    assert len(base64.b64decode(s["z"])) == 4 * s["grid"] ** 2
    assert s["metrics"]["r2"] > 0.9 and s["history"]

    p = client.post("/api/apps/weather/predict", json={"x1": 135, "x2": 15}).json()
    assert p["low"] <= p["value"] <= p["high"] and p["band"]["label"]
    assert abs(p["error"]) < 3 and p["details"] and p["micros"] > 0
    assert client.post("/api/apps/weather/predict", json={"x1": 400, "x2": 15}).status_code == 422

    # a verified reading 6 °C above the model: the model must move to it, and say it was a surprise
    target = p["value"] + 6
    r = client.post(
        "/api/apps/weather/readings", json={"readings": [{"x1": 135, "x2": 15, "value": target, "kind": "verified"}]}
    )
    assert r.status_code == 200, r.text
    out = r.json()
    item = out["items"][0]
    assert abs(item["before"] - p["value"]) < 1e-6 and abs(item["after"] - target) < 0.05
    assert item["surprise"] and out["version"] > s["version"] and out["max_shift"] > 5
    after = client.post("/api/apps/weather/predict", json={"x1": 135, "x2": 15}).json()
    assert abs(after["value"] - target) < 0.05

    # simulated sensors, then the readings list, delete one, clear all
    r = client.post("/api/apps/weather/readings/sample", json={"n": 4})
    assert r.status_code == 200 and len(r.json()["items"]) == 4
    s = client.get("/api/apps/weather").json()
    assert s["observations"] == 5 and len(s["readings"]) == 5
    rid = s["readings"][0]["id"]
    assert client.delete(f"/api/apps/weather/readings/{rid}").status_code == 204
    assert client.delete("/api/apps/weather/readings/999999").status_code == 404
    assert client.delete("/api/apps/weather/readings").json()["removed"] == 4
    back = client.post("/api/apps/weather/predict", json={"x1": 135, "x2": 15}).json()
    assert abs(back["value"] - p["value"]) < 1e-6


def test_readings_are_validated(client):
    _trained(client, "traffic", budget=36)
    bad = {"readings": [{"x1": 30, "x2": 2, "value": 10}]}
    assert client.post("/api/apps/traffic/readings", json=bad).status_code == 422
    assert client.post("/api/apps/traffic/readings", json={"readings": []}).status_code == 422


def test_readings_survive_a_restart(client):
    _trained(client, "air-quality", budget=36)
    r = client.post("/api/apps/air-quality/readings", json={"readings": [{"x1": 8, "x2": 2, "value": 150}]})
    assert r.status_code == 200
    apps.reset_memory()  # as if the process restarted
    s = _trained(client, "air-quality", budget=36)
    assert s["observations"] == 1 and s["readings"][0]["value"] == 150


def test_model_card_explains_the_function_and_every_benchmark(client):
    from app.core.simulators import TEST_FUNCTIONS

    for key in APPLICATIONS:
        r = client.get(f"/api/apps/{key}/model")
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["formula"] and m["terms"] and m["general"]
        assert len(base64.b64decode(m["landscape"]["thumb"])) == 4 * m["thumb_grid"] ** 2
        keys = [b["key"] for b in m["benchmarks"]]
        assert sorted(keys) == sorted(TEST_FUNCTIONS)
        assert all(b["reason"] for b in m["benchmarks"])  # a reason for every benchmark function
        assert m["benchmarks"][0]["closest"]  # sorted, nearest first
        dists = [b["distance"] for b in m["benchmarks"]]
        assert dists == sorted(dists)
    assert client.get("/api/apps/nope/model").status_code == 404
