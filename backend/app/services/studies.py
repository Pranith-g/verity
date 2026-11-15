"""Study logic: turn stored runs into suggestions, a surrogate and a stop decision."""

from __future__ import annotations

import base64
import threading
from collections import OrderedDict
from datetime import UTC, datetime

import numpy as np
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..core.learner import Field, LearnerConfig, StopStatus, _Taken, build_field, certify, depth_threshold, propose
from ..core.learner import _needs_vertex_run as needs_vertex_run
from ..core.simulators import SIMULATORS
from ..models import Run, Study
from ..schemas import FeatureOut, RunOut, StateOut, StopOut, StudyCreate, StudyOut, SuggestionOut

CFG = LearnerConfig()

# One lock per study: two workers asking at the same moment must not get the same points.
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def study_lock(study_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(study_id, threading.Lock())


# The fit is the expensive part, and it only changes when a result arrives.
_fields: OrderedDict[tuple[str, int], Field] = OrderedDict()
_fields_guard = threading.Lock()


def _field_for(study_id: str, points: np.ndarray, values: np.ndarray) -> Field:
    key = (study_id, len(values))
    with _fields_guard:
        if key in _fields:
            _fields.move_to_end(key)
            return _fields[key]
    fld = build_field(points, values, CFG)
    with _fields_guard:
        _fields[key] = fld
        while len(_fields) > 64:
            _fields.popitem(last=False)
    return fld


def forget(study_id: str) -> None:
    with _fields_guard:
        for key in [k for k in _fields if k[0] == study_id]:
            del _fields[key]
    with _locks_guard:
        _locks.pop(study_id, None)


# ---------------------------------------------------------------- helpers
def _row_lock(session: Session, study: Study) -> None:
    """Serialise ask/tell per study across processes. A no-op on SQLite, a row lock on Postgres."""
    session.execute(select(Study.id).where(Study.id == study.id).with_for_update())


def _to_real(study: Study, u: float, v: float) -> tuple[float, float]:
    a, b = study.config["inputs"]
    return a["low"] + u * (a["high"] - a["low"]), b["low"] + v * (b["high"] - b["low"])


def _to_unit(study: Study, x1: float, x2: float) -> tuple[float, float]:
    a, b = study.config["inputs"]
    return (x1 - a["low"]) / (a["high"] - a["low"]), (x2 - b["low"]) / (b["high"] - b["low"])


def _done(session: Session, study: Study) -> list[Run]:
    return list(session.scalars(select(Run).where(Run.study_id == study.id, Run.status == "done").order_by(Run.seq)))


def _pending(session: Session, study: Study) -> list[Run]:
    return list(session.scalars(select(Run).where(Run.study_id == study.id, Run.status == "pending").order_by(Run.id)))


def _arrays(runs: list[Run]) -> tuple[np.ndarray, np.ndarray]:
    pts = np.array([[r.u, r.v] for r in runs], dtype=float).reshape(-1, 2)
    vals = np.array([r.value for r in runs], dtype=float)
    return pts, vals


def _depth(study: Study, values: np.ndarray) -> float:
    return depth_threshold(values, study.config["min_depth_rel"], study.config.get("min_depth_abs"))


def _stop(study: Study, done: list[Run], fld: Field) -> StopStatus:
    pts, vals = _arrays(done)
    scored = [r for r in done if r.predicted is not None]
    recent = [abs(r.predicted - r.value) for r in scored]
    rand = [abs(r.predicted - r.value) for r in scored if r.reason == "explore"]
    return certify(pts, vals, recent, rand, _depth(study, vals), CFG, fld)


def stop_out(s: StopStatus) -> StopOut:
    return StopOut(
        ready=s.ready, features_checked=s.features_checked, surprises_small=s.surprises_small,
        no_blind_spot=s.no_blind_spot, unchecked=s.unchecked, deep_features=s.deep_features,
        worst_recent_miss=s.worst_recent_miss, typical_miss=s.typical_miss, allowed_miss=s.allowed_miss,
        largest_gap=s.largest_gap, max_gap=CFG.max_gap, depth=s.depth, notes=s.notes,
    )  # fmt: skip


def study_out(session: Session, study: Study, autorun: bool = False) -> StudyOut:
    counts = dict(
        session.execute(select(Run.status, func.count()).where(Run.study_id == study.id).group_by(Run.status)).all()
    )
    done, pending = counts.get("done", 0), counts.get("pending", 0)
    if study.declared_at is not None:
        status = "ready"
    elif done >= study.max_runs:
        status = "out_of_budget"
    elif done < CFG.n_init:
        status = "collecting"
    else:
        status = "learning"
    c = study.config
    return StudyOut(
        id=study.id, name=study.name, created_at=study.created_at, inputs=c["inputs"],
        output_name=c["output_name"], min_depth_rel=c["min_depth_rel"], min_depth_abs=c.get("min_depth_abs"),
        max_runs=study.max_runs, seed=study.seed, demo_simulator=study.demo_simulator, runs_done=done,
        runs_pending=pending, declared_at=study.declared_at, status=status, autorun=autorun,
    )  # fmt: skip


# ---------------------------------------------------------------- operations
def create(session: Session, body: StudyCreate) -> Study:
    settings = get_settings()
    if body.max_runs > settings.max_runs_per_study:
        raise HTTPException(422, f"max_runs may be at most {settings.max_runs_per_study}")
    inputs = [i.model_dump() for i in body.inputs] if body.inputs else None
    output_name = body.output_name
    if body.demo_simulator is not None:
        sim = SIMULATORS.get(body.demo_simulator)
        if sim is None:
            raise HTTPException(422, f"unknown simulator '{body.demo_simulator}'")
        inputs = [
            {"name": sim.inputs[0], "low": sim.box[0], "high": sim.box[1]},
            {"name": sim.inputs[1], "low": sim.box[2], "high": sim.box[3]},
        ]
        if "output_name" not in body.model_fields_set:
            output_name = sim.output
    study = Study(
        name=body.name.strip(), seed=body.seed, max_runs=body.max_runs, demo_simulator=body.demo_simulator,
        config={
            "inputs": inputs, "output_name": output_name,
            "min_depth_rel": body.min_depth_rel, "min_depth_abs": body.min_depth_abs,
        },
        history=[],
    )  # fmt: skip
    session.add(study)
    session.commit()
    return study


def get(session: Session, study_id: str) -> Study:
    study = session.get(Study, study_id)
    if study is None:
        raise HTTPException(404, "study not found")
    return study


def ask(session: Session, study: Study, n: int) -> tuple[list[SuggestionOut], str | None]:
    settings = get_settings()
    n = min(n, settings.max_ask)
    with study_lock(study.id):
        _row_lock(session, study)
        done, pending = _done(session, study), _pending(session, study)
        room = study.max_runs - len(done) - len(pending)
        if room <= 0:
            if pending:
                return [], "Every run in the budget has been handed out. Report the pending results."
            return [], "The run budget is spent."
        n = min(n, room)
        pts, vals = _arrays(done)
        pend = np.array([[r.u, r.v] for r in pending], dtype=float).reshape(-1, 2)
        rng = np.random.default_rng([study.seed, len(done), len(pending)])
        fld = _field_for(study.id, pts, vals) if len(done) >= CFG.n_init else None
        props = propose(pts, vals, pend, n, rng, _depth(study, vals), CFG, fld, seed=study.seed)
        rows = [Run(study_id=study.id, u=p.u, v=p.v, reason=p.reason, predicted=p.predicted) for p in props]
        session.add_all(rows)
        session.commit()
    message = None
    if not rows:
        message = "Waiting for pending results before suggesting more."
    out = []
    for r in rows:
        x1, x2 = _to_real(study, r.u, r.v)
        out.append(SuggestionOut(run_id=r.id, x1=x1, x2=x2, reason=r.reason, predicted=r.predicted))
    return out, message


def tell(session: Session, study: Study, results: list) -> tuple[int, int, StopOut | None]:
    with study_lock(study.id):
        _row_lock(session, study)
        done = _done(session, study)
        seq = len(done)
        pts, _ = _arrays(done)
        taken = _Taken(pts)
        fld = None
        if len(done) >= CFG.n_init:
            fld = _field_for(study.id, *_arrays(done))
        accepted = 0
        seen: set[int] = set()
        for res in results:
            if res.run_id is not None:
                run = session.get(Run, res.run_id)
                if run is None or run.study_id != study.id:
                    raise HTTPException(404, f"run {res.run_id} does not belong to this study")
                if run.status != "pending" or run.id in seen:
                    raise HTTPException(409, f"run {res.run_id} already has a result")
                seen.add(run.id)
            else:
                if seq >= study.max_runs:
                    raise HTTPException(409, "the run budget is spent")
                u, v = _to_unit(study, res.x1, res.x2)
                if not (-1e-9 <= u <= 1 + 1e-9 and -1e-9 <= v <= 1 + 1e-9):
                    raise HTTPException(422, f"point ({res.x1}, {res.x2}) is outside the study's input ranges")
                u, v = min(1.0, max(0.0, u)), min(1.0, max(0.0, v))
                if taken.min_dist(u, v) < CFG.duplicate:
                    raise HTTPException(409, f"point ({res.x1}, {res.x2}) has already been measured")
                pred = float(fld.surrogate(np.array([[u, v]]))[0]) if fld is not None else None
                run = Run(study_id=study.id, u=u, v=v, reason="manual", predicted=pred)
                session.add(run)
            run.value = res.value
            run.status = "done"
            run.seq = seq
            run.completed_at = datetime.now(UTC)
            taken.add(run.u, run.v)
            seq += 1
            accepted += 1
        session.flush()
        done = _done(session, study)
        stop = None
        if len(done) >= CFG.n_init:
            fld = _field_for(study.id, *_arrays(done))
            status = _stop(study, done, fld)
            stop = stop_out(status)
            if status.ready and study.declared_at is None:
                study.declared_at = len(done)
            study.history = [
                *study.history,
                {
                    "n": len(done), "unchecked": status.unchecked, "deep": status.deep_features,
                    "worst": status.worst_recent_miss, "allowed": status.allowed_miss,
                    "gap": status.largest_gap, "ready": status.ready,
                },
            ][-600:]  # fmt: skip
        session.commit()
    return accepted, len(done), stop


def state(session: Session, study: Study, autorun: bool = False) -> StateOut:
    done, pending = _done(session, study), _pending(session, study)
    runs = []
    for r in [*done, *pending]:
        x1, x2 = _to_real(study, r.u, r.v)
        runs.append(
            RunOut(id=r.id, status=r.status, seq=r.seq, u=r.u, v=r.v, x1=x1, x2=x2, reason=r.reason,
                   predicted=r.predicted, value=r.value)
        )  # fmt: skip
    z = z_min = z_max = None
    feats: list[FeatureOut] = []
    stop = None
    if len(done) >= CFG.n_init:
        pts, vals = _arrays(done)
        fld = _field_for(study.id, pts, vals)
        status = _stop(study, done, fld)
        stop = stop_out(status)
        z = base64.b64encode(fld.z.astype("<f4").tobytes()).decode()
        z_min, z_max = float(fld.z.min()), float(fld.z.max())
        taken = _Taken(pts)
        for f in sorted(fld.features, key=lambda f: -f.depth):
            if f.depth <= 0.25 * status.depth:
                continue
            u, v = fld.node_uv(f.node)
            x1, x2 = _to_real(study, u, v)
            checked = (
                taken.min_dist(u, v) < CFG.on_feature
                and taken.count_near(u, v, CFG.polish_radius) >= CFG.polish_count
                and needs_vertex_run(f, fld, pts, vals, taken, CFG) is None
            )
            feats.append(
                FeatureOut(kind=f.kind, u=u, v=v, x1=x1, x2=x2, value=f.value, depth=f.depth,
                           deep=f.depth > status.depth, checked=checked)
            )  # fmt: skip
    return StateOut(
        study=study_out(session, study, autorun), grid=CFG.grid, z=z, z_min=z_min, z_max=z_max, runs=runs,
        features=feats[:80], stop=stop, history=study.history,
    )  # fmt: skip
