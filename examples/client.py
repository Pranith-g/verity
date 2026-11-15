"""Drive a study from a script: you own the simulator, the service picks the runs.

    python examples/client.py                      # server on http://localhost:8000
    VDC_URL=https://your-host VDC_API_KEY=... python examples/client.py

Uses only the standard library.
"""

from __future__ import annotations

import json
import math
import os
import urllib.request

BASE = os.environ.get("VDC_URL", "http://localhost:8000").rstrip("/")
KEY = os.environ.get("VDC_API_KEY")


def call(method: str, path: str, body: dict | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if KEY:
        headers["X-API-Key"] = KEY
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read() or b"{}")


def simulate(angle: float, speed: float) -> float:
    """Stand-in for your expensive model. Replace the body; keep the signature."""
    lift = math.sin(math.radians(angle) * 6) * (speed / 60) ** 2
    stall = 1.5 * math.exp(-(((angle - 11) / 1.5) ** 2) - ((speed - 70) / 12) ** 2)
    return lift - stall


def main() -> None:
    study = call(
        "POST",
        "/api/studies",
        {
            "name": "Wing lift (example client)",
            "inputs": [{"name": "angle", "low": -5, "high": 15}, {"name": "speed", "low": 20, "high": 90}],
            "output_name": "lift",
            "min_depth_rel": 0.05,
            "max_runs": 400,
        },
    )
    sid = study["id"]
    print(f"study {sid}: {BASE}/studies/{sid}")
    while True:
        runs = call("POST", f"/api/studies/{sid}/ask", {"n": 6})["suggestions"]
        if not runs:
            print("budget spent before the stop rule passed")
            break
        results = [{"run_id": r["run_id"], "value": simulate(r["x1"], r["x2"])} for r in runs]
        told = call("POST", f"/api/studies/{sid}/tell", {"results": results})
        stop = told["stop"]
        if stop:
            print(
                f"{told['runs_done']:4d} runs | deep features {stop['deep_features']:2d} "
                f"(unchecked {stop['unchecked']}) | largest gap {stop['largest_gap']:.3f}"
            )
        if stop and stop["ready"]:
            print(f"stop rule passed after {told['runs_done']} runs")
            break
    state = call("GET", f"/api/studies/{sid}/state")
    for f in state["features"]:
        if f["deep"]:
            kind = "valley" if f["kind"] == "min" else "peak"
            print(f"  {kind:6s} at angle={f['x1']:.2f}, speed={f['x2']:.1f}: lift={f['value']:.3f}, depth={f['depth']:.3f}")


if __name__ == "__main__":
    main()
