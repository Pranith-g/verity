"""Run three-way benchmarks in the background and let any number of viewers follow along."""

from __future__ import annotations

import base64
import logging
import threading
from collections import OrderedDict
from dataclasses import dataclass, field

import numpy as np

from ..config import get_settings
from ..core.race import Frame, Race, make_race
from ..db import SessionLocal
from ..models import RaceRecord
from .studies import stop_out

log = logging.getLogger("vdc.races")


def _b64(z: np.ndarray) -> str:
    return base64.b64encode(np.asarray(z).astype("<f4").tobytes()).decode()


@dataclass
class LiveRace:
    id: str
    events: list[dict] = field(default_factory=list)  # append-only; viewers read by index
    done: bool = False
    cancel: threading.Event = field(default_factory=threading.Event)


_live: OrderedDict[str, LiveRace] = OrderedDict()
_guard = threading.Lock()


def running() -> int:
    with _guard:
        return sum(1 for r in _live.values() if not r.done)


def cancel(race_id: str) -> bool:
    """Ask a running race to stop after its current batch. False when it is unknown or already finished."""
    live = get_live(race_id)
    if live is None or live.done:
        return False
    live.cancel.set()
    return True


def get_live(race_id: str) -> LiveRace | None:
    with _guard:
        return _live.get(race_id)


def _truth_event(race: Race, simulator: str) -> dict:
    t = race.truth
    g = t.grid
    return {
        "type": "truth", "simulator": simulator, "grid": g, "z": _b64(t.z), "lo": t.lo, "hi": t.hi,
        "tau": t.tau, "budget": race.budget,
        "features": [
            {"kind": f.kind, "u": (f.node // g) / (g - 1), "v": (f.node % g) / (g - 1), "depth": f.depth / t.range}
            for f in t.significant
        ],
        "depths": sorted((f.depth / t.range for f in t.all if f.depth > 0.25 * t.depth), reverse=True)[:48],
        "init": [[round(float(u), 5), round(float(v), 5)] for u, v in race.learners[0].points],
    }  # fmt: skip


def _frame_event(fr: Frame, race: Race) -> dict:
    t = race.truth
    g = t.grid
    a = fr.audit
    ev: dict = {
        "type": "step", "kind": fr.kind, "n": fr.n, "z": _b64(fr.z),
        "points": [[round(u, 5), round(v, 5), tag] for u, v, tag in fr.new_points],
        "audit": {
            "captured": a.captured, "total": a.total, "ghosts": a.ghosts, "rmse": a.rmse, "worst": a.worst,
            "at_features": a.at_features, "hit": a.hit,
            "ghost_points": [[(n // g) / (g - 1), (n % g) / (g - 1)] for n in a.ghost_nodes],
        },
        "done_at": fr.done_at, "declared_at": fr.declared_at, "declared_correct": fr.declared_correct,
    }  # fmt: skip
    if fr.stop is not None:
        s = stop_out(fr.stop).model_dump()
        # the page shows these as shares of the true range, like every other number in the race
        for key in ("worst_recent_miss", "typical_miss", "allowed_miss", "depth"):
            if s[key] is not None:
                s[key] = s[key] / t.range
        ev["stop"] = s
        lr = race.learners[2]
        floor = 0.25 * fr.stop.depth
        ev["depths"] = sorted((f.depth / t.range for f in lr.field.features if f.depth > floor), reverse=True)[:48]
    return ev


def start(simulator: str, tau: float, budget: int, seed: int) -> str:
    with SessionLocal() as session:
        rec = RaceRecord(simulator=simulator, tau=tau, budget=budget, seed=seed)
        session.add(rec)
        session.commit()
        race_id = rec.id
    live = LiveRace(race_id)
    with _guard:
        _live[race_id] = live
        keep = get_settings().races_kept_in_memory
        for key in [k for k, r in _live.items() if r.done][: max(0, len(_live) - keep)]:
            del _live[key]
    threading.Thread(
        target=_run, args=(live, simulator, tau, budget, seed), daemon=True, name=f"race-{race_id}"
    ).start()
    return race_id


def _run(live: LiveRace, simulator: str, tau: float, budget: int, seed: int) -> None:
    status, summary = "done", None
    try:
        race = make_race(simulator, seed=seed, tau=tau, budget=budget)
        live.events.append(_truth_event(race, simulator))
        for fr in race.frames():
            if live.cancel.is_set():
                status = "stopped"
                live.events.append({"type": "error", "message": "the race was stopped"})
                break
            live.events.append(_frame_event(fr, race))
        else:
            summary = race.summary()
            live.events.append({"type": "done", "summary": summary})
    except Exception as exc:  # pragma: no cover
        log.exception("race %s failed", live.id)
        status = "failed"
        live.events.append({"type": "error", "message": str(exc)})
    finally:
        live.done = True
        with SessionLocal() as session:
            rec = session.get(RaceRecord, live.id)
            if rec is not None:
                rec.status, rec.summary = status, summary
                session.commit()
