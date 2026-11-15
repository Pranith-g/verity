"""Euclidean (random opening runs) against Euclidean + LHS (maximin Latin hypercube opening runs).

Both arms run the Verify learner with the same seeds, the same Euclidean distance everywhere,
and the same learner random stream; only the 12 opening runs differ. The result is written to
app/data/init_design.json, which the API serves to the web app's "Opening design" page.

python -m scripts.compare_init               # all simulators, 16 seeds, 420 runs
python -m scripts.compare_init peaks 4 240
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from statistics import median

import numpy as np

from app.core.learner import LearnerConfig, largest_gap, min_pair_distance, opening_design
from app.core.race import RaceLearner
from app.core.referee import make_truth
from app.core.simulators import SIMULATORS, TEST_FUNCTIONS

ARMS = ("random", "lhs")
LABELS = {"random": "Euclidean", "lhs": "Euclidean + LHS"}
OUT = Path(__file__).resolve().parent.parent / "app" / "data" / "init_design.json"
EARLY = 60  # "early error" checkpoint, in runs
TAU = 0.05
BATCH = 6


def one(args: tuple[str, int, int, str]) -> dict:
    key, seed, budget, arm = args
    cfg = replace(LearnerConfig(), init_design=arm)
    truth = make_truth(SIMULATORS[key], cfg.grid, TAU)
    t_design = time.perf_counter()
    init = opening_design(cfg.n_init, seed * 7919 + 13, cfg)  # the same seeds make_race uses
    design_ms = 1000 * (time.perf_counter() - t_design)
    t0 = time.perf_counter()  # learner wall time: fitting, proposing, checking (the simulators are near-free)
    lr = RaceLearner("verify", truth, seed * 101 + 2 * 17 + 1, init, cfg, TAU)
    curve = [(lr.n, lr.audit.rmse, lr.audit.captured)]
    elapsed = [(lr.n, 0.0)]
    while lr.n < budget:
        lr.step(min(BATCH, budget - lr.n))
        curve.append((lr.n, lr.audit.rmse, lr.audit.captured))
        elapsed.append((lr.n, time.perf_counter() - t0))
    finish_s = None
    if lr.done_at is not None:
        finish_s = next(s for n, s in elapsed if n >= lr.done_at)
    return {
        "design_ms": design_ms,
        "compute_s": elapsed[-1][1],
        "finish_s": finish_s,
        "sim": key,
        "seed": seed,
        "arm": arm,
        "total": lr.audit.total,
        "init_min_dist": min_pair_distance(init),
        "init_gap": largest_gap(init, cfg.grid)[0],
        "done_at": lr.done_at,
        "declared_at": lr.declared_at,
        "declared_correct": lr.declared_correct,
        "rmse": lr.audit.rmse,
        "ghosts": lr.audit.ghosts,
        "captured": lr.audit.captured,
        "curve": curve,
    }


def _at(curve: list, n: int) -> tuple[float, int]:
    """rmse and features captured at the last batch that reached ``n`` runs."""
    row = next((c for c in curve if c[0] >= n), curve[-1])
    return row[1], row[2]


def sign_test(wins: int, losses: int) -> float:
    """Two-sided exact sign test p-value (ties dropped)."""
    n = wins + losses
    if n == 0:
        return 1.0
    k = min(wins, losses)
    p = sum(math.comb(n, i) for i in range(k + 1)) / 2**n
    return min(1.0, 2 * p)


def paired(rows: dict, metric, lower_better: bool = True) -> dict:
    """LHS wins/losses/ties over (simulator, seed) pairs on one metric."""
    w = loss = tie = 0
    diffs: list[float] = []
    for arms in rows.values():
        a, b = metric(arms["random"]), metric(arms["lhs"])
        if a is None or b is None:
            continue
        d = (a - b) if lower_better else (b - a)  # > 0 means LHS did better
        diffs.append(d)
        if abs(d) < 1e-12:
            tie += 1
        elif d > 0:
            w += 1
        else:
            loss += 1
    return {"lhs_wins": w, "random_wins": loss, "ties": tie, "p": sign_test(w, loss)}


def main() -> None:
    keys = sys.argv[1].split(",") if len(sys.argv) > 1 else list(TEST_FUNCTIONS)
    seeds = int(sys.argv[2]) if len(sys.argv) > 2 else 16
    budget = int(sys.argv[3]) if len(sys.argv) > 3 else 420
    jobs = [(k, s, budget, arm) for k in keys for s in range(1, seeds + 1) for arm in ARMS]
    # One BLAS thread per worker: with one per core in every process they fight over the CPU.
    for var in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
        os.environ[var] = "1"
    workers = max(1, (os.cpu_count() or 2) - 2)
    t0 = time.time()
    results = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(one, j) for j in jobs]
        for i, fut in enumerate(as_completed(futures), 1):
            results.append(fut.result())
            print(f"  {i}/{len(jobs)} done, {time.time() - t0:.0f} s", flush=True)
    took = time.time() - t0

    pairs: dict = {}
    for r in results:
        pairs.setdefault((r["sim"], r["seed"]), {})[r["arm"]] = r
    censored = budget + BATCH  # an unfinished run counts as "later than the budget"

    def finish(r: dict) -> int:
        return r["done_at"] if r["done_at"] is not None else censored

    sims_out = []
    for k in keys:
        sim_pairs = {p: a for p, a in pairs.items() if p[0] == k}
        arms_out = {}
        for arm in ARMS:
            rs = [a[arm] for a in sim_pairs.values()]
            done = [r["done_at"] for r in rs if r["done_at"] is not None]
            dec = [r for r in rs if r["declared_at"] is not None]
            ns = sorted({c[0] for r in rs for c in r["curve"]})
            arms_out[arm] = {
                "finished": len(done),
                "median_done_at": median(done) if done else None,
                "stop_fired": len(dec),
                "stop_correct": sum(1 for d in dec if d["declared_correct"]),
                "median_declared_at": median(d["declared_at"] for d in dec) if dec else None,
                "rmse_init": median(_at(r["curve"], 0)[0] for r in rs),
                "rmse_early": median(_at(r["curve"], EARLY)[0] for r in rs),
                "rmse_final": median(r["rmse"] for r in rs),
                "init_min_dist": median(r["init_min_dist"] for r in rs),
                "init_gap": median(r["init_gap"] for r in rs),
                "curve": [
                    {
                        "n": n,
                        "rmse": median(_at(r["curve"], n)[0] for r in rs),
                        "captured": float(np.mean([_at(r["curve"], n)[1] / max(1, r["total"]) for r in rs])),
                    }
                    for n in ns
                ],
            }
        sims_out.append(
            {
                "key": k,
                "name": SIMULATORS[k].name,
                "features": next(iter(sim_pairs.values()))["random"]["total"],
                "arms": arms_out,
                "finish": paired(sim_pairs, finish),
                "early": paired(sim_pairs, lambda r: _at(r["curve"], EARLY)[0]),
            }
        )

    def finish_time(r: dict) -> float:
        return r["finish_s"] if r["finish_s"] is not None else 1e9  # never finished: slower than any finish

    def arm_times(arm: str) -> dict:
        rs = [r for r in results if r["arm"] == arm]
        done = [r["finish_s"] for r in rs if r["finish_s"] is not None]
        return {
            "design_ms": median(r["design_ms"] for r in rs),
            "compute_s": median(r["compute_s"] for r in rs),
            "finish_s": median(done) if done else None,
            "finish_runs": median(r["done_at"] for r in rs if r["done_at"] is not None) if done else None,
            "total_compute_s": sum(r["compute_s"] for r in rs),
        }

    timing = {
        "workers": workers,
        "arms": {arm: arm_times(arm) for arm in ARMS},
        "finish": paired(pairs, finish_time),
        "compute": paired(pairs, lambda r: r["compute_s"]),
    }

    overall = {
        "timing": timing,
        "finish": paired(pairs, finish),
        "early": paired(pairs, lambda r: _at(r["curve"], EARLY)[0]),
        "final": paired(pairs, lambda r: r["rmse"]),
        "spread": paired(pairs, lambda r: r["init_min_dist"], lower_better=False),
        "arms": {
            arm: {
                "finished": sum(1 for r in results if r["arm"] == arm and r["done_at"] is not None),
                "stop_fired": sum(1 for r in results if r["arm"] == arm and r["declared_at"] is not None),
                "stop_correct": sum(1 for r in results if r["arm"] == arm and r["declared_correct"]),
                "init_min_dist": median(r["init_min_dist"] for r in results if r["arm"] == arm),
                "init_gap": median(r["init_gap"] for r in results if r["arm"] == arm),
                "median_finish": median(finish(r) for r in results if r["arm"] == arm),
                # error, as a geometric mean over simulators of each simulator's median curve
                "curve": [
                    {
                        "n": pt["n"],
                        "rmse": float(
                            np.exp(np.mean([np.log(max(1e-9, _curve_at(s, arm, pt["n"]))) for s in sims_out]))
                        ),
                        "captured": float(np.mean([_curve_at(s, arm, pt["n"], "captured") for s in sims_out])),
                    }
                    for pt in sims_out[0]["arms"][arm]["curve"]
                ],
            }
            for arm in ARMS
        },
    }
    overall["verdict"] = verdict(overall, len(pairs))

    payload = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "seeds": seeds,
        "budget": budget,
        "batch": BATCH,
        "tau": TAU,
        "n_init": LearnerConfig().n_init,
        "early_at": EARLY,
        "labels": LABELS,
        "seconds": round(took, 1),
        "overall": overall,
        "simulators": sims_out,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1))
    print(
        json.dumps({"verdict": overall["verdict"], **{k: overall[k] for k in ("finish", "early", "final")}}, indent=1)
    )
    for arm in ARMS:
        a = overall["arms"][arm]
        print(
            f"{LABELS[arm]:16s} finished {a['finished']}/{len(pairs)}"
            f"  stop fired {a['stop_fired']} correct {a['stop_correct']}"
            f"  opening min-dist {a['init_min_dist']:.3f} gap {a['init_gap']:.3f}"
        )
    print(f"wrote {OUT} in {took:.0f} s")


def _curve_at(sim: dict, arm: str, n: int, field: str = "rmse") -> float:
    c = sim["arms"][arm]["curve"]
    return next((p for p in c if p["n"] >= n), c[-1])[field]


def verdict(o: dict, pairs: int) -> dict:
    """Pick a winner from the paired results, counting only differences the sign test can tell from noise.

    Finishing sooner (every feature found) is the main measure; lower error early on is the second.
    ``strong`` means the main measure itself moved.
    """
    f, e = o["finish"], o["early"]
    ra, la = o["arms"]["random"], o["arms"]["lhs"]
    wrong = {arm: o["arms"][arm]["stop_fired"] - o["arms"][arm]["stop_correct"] for arm in ARMS}

    def leader(t: dict) -> str:
        return "lhs" if t["lhs_wins"] > t["random_wins"] else "random" if t["lhs_wins"] < t["random_wins"] else "tie"

    if f["p"] < 0.05 and leader(f) != "tie":
        winner, strong = leader(f), True
        head = f"{LABELS[winner]} is better: it finds every feature sooner"
    elif e["p"] < 0.05 and leader(e) != "tie":
        winner, strong = leader(e), False
        head = f"{LABELS[winner]} is better early on; by the time every feature is found the two are level"
    else:
        winner, strong = "tie", False
        head = "No clear winner: the difference is within seed-to-seed noise"
    reasons = [
        f"Finished first in {f['lhs_wins']} of {pairs} paired starts with LHS, {f['random_wins']} without"
        f" ({f['ties']} ties, sign test p = {f['p']:.2g}).",
        f"Lower error after {EARLY} runs in {e['lhs_wins']} of {pairs} starts with LHS, {e['random_wins']} without"
        f" (p = {e['p']:.2g}).",
        f"Finished {la['finished']} of {pairs} with LHS against {ra['finished']} without; the stop rule was wrong"
        f" {wrong['lhs']} time(s) with LHS and {wrong['random']} without.",
        f"The 12 opening runs' closest pair is {la['init_min_dist']:.2f} apart with LHS against"
        f" {ra['init_min_dist']:.2f} at random; the biggest hole shrinks from {ra['init_gap']:.2f}"
        f" to {la['init_gap']:.2f}.",
    ]
    return {"winner": winner, "strong": strong, "headline": head, "reasons": reasons}


if __name__ == "__main__":
    main()
