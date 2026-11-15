"""The HTTP service, driven the way a real client would drive it."""

import base64
import json
import time

import numpy as np

from app.core.simulators import SIMULATORS


def _new_study(client, **over):
    body = {
        "name": "wing drag",
        "inputs": [{"name": "angle", "low": -3, "high": 3}, {"name": "speed", "low": -3, "high": 3}],
        "output_name": "drag",
        "max_runs": 300,
    } | over
    r = client.post("/api/studies", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert "X-Request-ID" in r.headers


def test_create_validates_input(client):
    assert client.post("/api/studies", json={"name": "x"}).status_code == 422
    bad = {"name": "x", "inputs": [{"name": "a", "low": 1, "high": 1}, {"name": "b", "low": 0, "high": 1}]}
    assert client.post("/api/studies", json=bad).status_code == 422
    assert client.post("/api/studies", json={"name": "x", "demo_simulator": "nope"}).status_code == 422
    assert client.get("/api/studies/doesnotexist").status_code == 404


def test_ask_tell_loop_learns_peaks_and_stops_itself(client):
    """A client that owns the simulator: ask, run, tell, until the service says stop."""
    sim = SIMULATORS["peaks"]
    study = _new_study(client)
    sid = study["id"]
    assert study["status"] == "collecting"
    stop = None
    for _ in range(60):
        asked = client.post(f"/api/studies/{sid}/ask", json={"n": 6}).json()["suggestions"]
        assert asked
        results = [{"run_id": s["run_id"], "value": sim.at(s["x1"], s["x2"])} for s in asked]
        told = client.post(f"/api/studies/{sid}/tell", json={"results": results}).json()
        assert told["accepted"] == len(asked)
        stop = told["stop"]
        if stop and stop["ready"]:
            break
    assert stop and stop["ready"], "the stop rule should pass within 360 runs on Peaks"
    state = client.get(f"/api/studies/{sid}/state").json()
    assert state["study"]["status"] == "ready" and state["study"]["declared_at"] == state["study"]["runs_done"]
    z = np.frombuffer(base64.b64decode(state["z"]), dtype="<f4")
    assert z.size == state["grid"] ** 2
    deep = [f for f in state["features"] if f["deep"]]
    assert len(deep) == 5 and all(f["checked"] for f in deep)
    assert all(-3 <= f["x1"] <= 3 and -3 <= f["x2"] <= 3 for f in deep)
    assert state["history"][-1]["ready"] is True


def test_pending_points_are_reserved_and_results_cannot_be_reported_twice(client):
    sid = _new_study(client)["id"]
    first = client.post(f"/api/studies/{sid}/ask", json={"n": 8}).json()["suggestions"]
    second = client.post(f"/api/studies/{sid}/ask", json={"n": 8}).json()
    assert len(first) == 8 and len(second["suggestions"]) == 4  # only 12 opening runs exist
    third = client.post(f"/api/studies/{sid}/ask", json={"n": 8}).json()
    assert third["suggestions"] == [] and "pending" in third["message"].lower()
    run = first[0]["run_id"]
    ok = client.post(f"/api/studies/{sid}/tell", json={"results": [{"run_id": run, "value": 1.5}]})
    assert ok.status_code == 200
    again = client.post(f"/api/studies/{sid}/tell", json={"results": [{"run_id": run, "value": 1.5}]})
    assert again.status_code == 409
    other = _new_study(client)["id"]
    cross = client.post(f"/api/studies/{other}/tell", json={"results": [{"run_id": first[1]["run_id"], "value": 1}]})
    assert cross.status_code == 404


def test_manual_points_and_their_guards(client):
    sid = _new_study(client)["id"]
    tell = lambda **r: client.post(f"/api/studies/{sid}/tell", json={"results": [r]})  # noqa: E731
    assert tell(x1=0.5, x2=0.5, value=2.0).status_code == 200
    assert tell(x1=0.5, x2=0.5, value=2.0).status_code == 409  # already measured
    assert tell(x1=9.0, x2=0.5, value=2.0).status_code == 422  # outside the ranges
    assert tell(value=2.0).status_code == 422  # no target
    assert (
        client.post(f"/api/studies/{sid}/tell", json={"results": [{"x1": 0, "x2": 0, "value": "NaN"}]}).status_code
        == 422
    )
    assert client.get(f"/api/studies/{sid}").json()["runs_done"] == 1


def test_budget_is_enforced(client):
    sid = _new_study(client, max_runs=20)["id"]
    sim = SIMULATORS["peaks"]
    for _ in range(10):
        asked = client.post(f"/api/studies/{sid}/ask", json={"n": 6}).json()["suggestions"]
        if not asked:
            break
        client.post(
            f"/api/studies/{sid}/tell",
            json={"results": [{"run_id": s["run_id"], "value": sim.at(s["x1"], s["x2"])} for s in asked]},
        )
    study = client.get(f"/api/studies/{sid}").json()
    assert study["runs_done"] == 20 and study["status"] == "out_of_budget"
    assert "budget" in client.post(f"/api/studies/{sid}/ask").json()["message"].lower()


def test_demo_study_runs_by_itself_and_can_be_deleted(client):
    r = client.post("/api/studies", json={"name": "demo", "demo_simulator": "rosenbrock", "max_runs": 300})
    sid = r.json()["id"]
    assert r.json()["inputs"][1] == {"name": "x2", "low": -1.0, "high": 3.0}
    assert client.post(f"/api/studies/{sid}/autorun", json={"batch": 8}).status_code == 202
    for _ in range(600):
        s = client.get(f"/api/studies/{sid}").json()
        if s["status"] == "ready" and not s["autorun"]:
            break
        time.sleep(0.05)
    assert s["status"] == "ready" and s["declared_at"] <= 300
    plain = _new_study(client)["id"]
    assert client.post(f"/api/studies/{plain}/autorun").status_code == 409
    assert client.delete(f"/api/studies/{sid}").status_code == 204
    assert client.get(f"/api/studies/{sid}").status_code == 404
    assert [s["id"] for s in client.get("/api/studies").json()] == [plain]


def test_real_data_demo_study_uses_the_dataset_labels(client):
    r = client.post("/api/studies", json={"name": "alps", "demo_simulator": "terrain-matterhorn"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert [i["name"] for i in body["inputs"]] == ["longitude", "latitude"]
    assert body["output_name"] == "elevation_m"


def test_race_streams_truth_steps_and_summary(client):
    sims = client.get("/api/simulators").json()
    assert [s["key"] for s in sims if s["kind"] == "test"][:1] == ["peaks"]
    assert sum(s["kind"] == "test" for s in sims) == 7
    real = [s for s in sims if s["kind"] == "real"]
    assert [s["key"] for s in real] == ["terrain-matterhorn"]
    assert real[0]["inputs"] == ["longitude", "latitude"] and "Copernicus" in real[0]["source"]
    assert client.post("/api/races", json={"simulator": "nope"}).status_code == 422
    assert client.post("/api/races", json={"simulator": "peaks", "budget": 100000}).status_code == 422
    race = client.post("/api/races", json={"simulator": "peaks", "budget": 90, "seed": 3}).json()
    events = []
    with client.stream("GET", f"/api/races/{race['id']}/events") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        for line in r.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    assert events[0]["type"] == "truth" and len(events[0]["features"]) == 5
    assert events[-1]["type"] == "done"
    steps = [e for e in events if e["type"] == "step"]
    assert {e["kind"] for e in steps} == {"random", "chase", "verify"}
    assert max(e["n"] for e in steps) == 90
    assert "stop" in next(e for e in steps if e["kind"] == "verify")
    done = client.get(f"/api/races/{race['id']}").json()
    assert done["status"] == "done" and set(done["summary"]) == {"random", "chase", "verify"}
    assert client.get("/api/races/unknown/events").status_code == 410


def test_api_key_is_enforced_when_configured(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "api_key", "s3cret")
    assert client.get("/api/health").status_code == 200  # health stays open for load balancers
    assert client.get("/api/studies").status_code == 401
    assert client.get("/api/studies", headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.get("/api/studies", headers={"X-API-Key": "s3cret"}).status_code == 200


def test_overview_counts_studies_runs_and_recent_activity(client):
    empty = client.get("/api/overview").json()
    assert empty["studies"] == 0 and empty["runs_done"] == 0 and len(empty["activity"]) == 24
    sid = _new_study(client)["id"]
    asked = client.post(f"/api/studies/{sid}/ask", json={"n": 6}).json()["suggestions"]
    results = [{"run_id": s["run_id"], "value": 1.0} for s in asked[:4]]
    client.post(f"/api/studies/{sid}/tell", json={"results": results})
    o = client.get("/api/overview").json()
    assert o["studies"] == 1 and o["by_status"]["collecting"] == 1
    assert o["runs_done"] == 4 and o["runs_pending"] == len(asked) - 4
    assert o["activity"][-1] == 4 and sum(o["activity"]) == 4


def test_a_running_race_can_be_stopped(client):
    rid = client.post("/api/races", json={"simulator": "rastrigin", "tau": 0.05, "budget": 600, "seed": 3}).json()["id"]
    assert client.delete(f"/api/races/{rid}").json()["stopped"] is True
    for _ in range(200):
        if client.get(f"/api/races/{rid}").json()["status"] != "running":
            break
        time.sleep(0.05)
    assert client.get(f"/api/races/{rid}").json()["status"] == "stopped"
    assert client.delete(f"/api/races/{rid}").json()["stopped"] is False
    assert client.delete("/api/races/nope").status_code == 404


def test_init_design_benchmark_is_served_when_saved(client):
    r = client.get("/api/benchmarks/init-design")
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        body = r.json()
        assert set(body["labels"]) == {"random", "lhs"}
        assert body["overall"]["verdict"]["winner"] in ("random", "lhs", "tie")
