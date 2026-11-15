"""Measure how the three strategies do over many seeded starts.

python -m scripts.measure            # all simulators, 8 seeds, 420 runs
python -m scripts.measure peaks 4 360
"""

from __future__ import annotations

import sys
from concurrent.futures import ProcessPoolExecutor
from statistics import median

from app.core.race import KINDS, make_race
from app.core.simulators import SIMULATORS


def one(args: tuple[str, int, int]) -> dict:
    key, seed, budget = args
    race = make_race(key, seed=seed, budget=budget)
    for _ in race.frames():
        pass
    return race.summary()


def main() -> None:
    keys = sys.argv[1].split(",") if len(sys.argv) > 1 else list(SIMULATORS)
    seeds = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    budget = int(sys.argv[3]) if len(sys.argv) > 3 else 420
    jobs = [(k, s, budget) for k in keys for s in range(1, seeds + 1)]
    with ProcessPoolExecutor() as pool:
        results = list(pool.map(one, jobs))
    fired = right = 0
    for k in keys:
        rows = [r for (kk, _, _), r in zip(jobs, results, strict=True) if kk == k]
        print(f"\n== {k} ({rows[0]['verify']['total']} features, {seeds} starts, {budget} runs)")
        for kind in KINDS:
            done = [r[kind]["done_at"] for r in rows if r[kind]["done_at"] is not None]
            med = median(done) if len(done) > seeds / 2 else None
            rm = median(r[kind]["rmse"] for r in rows)
            print(f"  {kind:7s} finished {len(done)}/{seeds}  median runs {med}  typical error {100 * rm:.2f}%")
        dec = [r["verify"] for r in rows if r["verify"]["declared_at"] is not None]
        ok = sum(1 for d in dec if d["declared_correct"])
        fired += len(dec)
        right += ok
        at = median(d["declared_at"] for d in dec) if dec else None
        print(f"  stop rule fired {len(dec)}/{seeds} (median at run {at}), correct {ok}/{len(dec)}")
    print(f"\nstop rule overall: fired {fired}, correct {right}")


if __name__ == "__main__":
    main()
