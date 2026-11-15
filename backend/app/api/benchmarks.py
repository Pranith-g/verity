"""Saved offline benchmarks, served as measured. They take minutes of CPU, so the API never runs them."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from ..core.learner import LearnerConfig, largest_gap, min_pair_distance, opening_design
from .deps import require_key

router = APIRouter(prefix="/api/benchmarks", tags=["benchmarks"], dependencies=[Depends(require_key)])

DATA = Path(__file__).resolve().parent.parent / "data"


def _example(arm: str, n: int, seed: int) -> dict:
    cfg = replace(LearnerConfig(), init_design=arm)
    pts = opening_design(n, seed, cfg)
    gap, at = largest_gap(pts, cfg.grid)
    return {"points": pts.round(4).tolist(), "min_dist": min_pair_distance(pts), "gap": gap, "gap_at": list(at)}


@router.get("/init-design")
def init_design() -> dict:
    """Euclidean (random opening runs) against Euclidean + LHS (maximin Latin hypercube opening runs).

    Produced by ``python -m scripts.compare_init`` from the backend folder. ``examples`` shows the
    two opening designs the first benchmark start used, so the page can draw them.
    """
    path = DATA / "init_design.json"
    if not path.is_file():
        raise HTTPException(404, "No saved comparison yet. Run `python -m scripts.compare_init` in the backend folder.")
    report = json.loads(path.read_text())
    n, seed = int(report.get("n_init", 12)), 1 * 7919 + 13  # seed 1, as the benchmark seeds it
    report["examples"] = {arm: _example(arm, n, seed) for arm in ("random", "lhs")}
    return report
