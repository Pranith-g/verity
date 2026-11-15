"""Real-world applications: train with the Verify learner, predict, and retrain on new field readings.

Each application keeps, in this process's memory, the reference-model runs the learner bought and the
surrogate fitted to them. Field readings people add are stored in the database (``app_observations``)
and blended into the surrogate: a *sensor* reading is treated as noisy, so the surface leans towards
it without having to pass through it; a *verified* reading is matched exactly.

Training runs in a background thread, one batch at a time with a short pause, so the web app can
show the runs landing on the surface. The reference runs are deterministic for a given seed, so a
restart retrains to the same surrogate.
"""

from __future__ import annotations

import base64
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import lru_cache

import numpy as np
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..core.application_cards import CARDS, GENERAL
from ..core.applications import APPLICATIONS, Application, Band
from ..core.learner import Field, LearnerConfig, StopStatus, build_field, certify, depth_threshold, propose
from ..core.simulators import TEST_FUNCTIONS
from ..core.surrogate import ThinPlate, grid_points
from ..core.topology import features
from ..models import AppObservation
from ..schemas import (
    AppBandOut,
    AppBenchmarkOut,
    AppDetailOut,
    AppExampleOut,
    AppFeatureOut,
    AppHistoryOut,
    AppInputOut,
    AppLandscapeOut,
    AppMetricsOut,
    AppModelOut,
    AppObservationOut,
    AppPointOut,
    AppPredictOut,
    AppReadingIn,
    AppRetrainItemOut,
    AppRetrainOut,
    AppRunOut,
    AppStateOut,
    AppSummaryOut,
    AppTermOut,
)
from .studies import stop_out

log = logging.getLogger("vdc.apps")

CFG = LearnerConfig()
GRID = CFG.grid
NODES = grid_points(GRID)
BATCH = 6
SEED = 7
DEPTH_REL = 0.05
SMOOTH = {"sensor": 1e-3, "verified": 1e-7}  # thin-plate smoothing per reading kind (unit-square scale)


@dataclass
class _Reading:
    id: int
    x1: float
    x2: float
    u: float
    v: float
    value: float
    kind: str
    source: str
    before: float | None
    created_at: datetime


@dataclass
class _State:
    app: Application
    truth: np.ndarray  # reference model on the grid
    lock: threading.RLock = field(default_factory=threading.RLock)
    status: str = "idle"
    pts: np.ndarray = field(default_factory=lambda: np.empty((0, 2)))
    vals: np.ndarray = field(default_factory=lambda: np.empty(0))
    reasons: list[str] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)
    stop: StopStatus | None = None
    model: ThinPlate | None = None
    z: np.ndarray | None = None
    feats: list = field(default_factory=list)
    suggestions: list[AppPointOut] | None = None
    readings: list[_Reading] = field(default_factory=list)
    version: int = 0
    train_ms: float | None = None
    trained_at: datetime | None = None
    cancel: threading.Event | None = None
    loaded: bool = False


_states: dict[str, _State] = {}
_guard = threading.Lock()


def reset_memory() -> None:
    """Forget every in-memory model (tests use this between cases)."""
    with _guard:
        for st in _states.values():
            if st.cancel is not None:
                st.cancel.set()
        _states.clear()


def _app(key: str) -> Application:
    app = APPLICATIONS.get(key)
    if app is None:
        raise HTTPException(404, f"unknown application '{key}'")
    return app


def _state(key: str) -> _State:
    app = _app(key)
    with _guard:
        st = _states.get(key)
        if st is None:
            st = _State(app=app, truth=app.truth_unit(NODES))
            _states[key] = st
    return st


def _load_readings(session: Session, st: _State) -> None:
    if st.loaded:
        return
    rows = session.scalars(
        select(AppObservation).where(AppObservation.app_key == st.app.key).order_by(AppObservation.id)
    ).all()
    with st.lock:
        if st.loaded:
            return
        st.readings = [_reading(st.app, r) for r in rows]
        st.loaded = True


def _reading(app: Application, r: AppObservation) -> _Reading:
    u, v = app.to_unit(r.x1, r.x2)
    return _Reading(r.id, r.x1, r.x2, float(u), float(v), r.value, r.kind, r.source, r.before, r.created_at)


def ensure(session: Session, key: str) -> _State:
    """The application's state, with its readings loaded and training started if it never ran."""
    st = _state(key)
    _load_readings(session, st)
    with st.lock:
        if st.status == "idle" and st.model is None:
            start_training(key, reset=True, pace_ms=60)
    return st


# ---------------------------------------------------------------- fitting
def _refit(st: _State) -> None:
    """Fit the deployed surrogate to the reference runs plus the field readings. Caller holds the lock."""
    if len(st.vals) < 3:
        return
    pts, vals = st.pts, st.vals
    smooth = np.zeros(len(vals))
    if st.readings:
        rp = np.array([[r.u, r.v] for r in st.readings])
        rv = np.array([r.value for r in st.readings])
        rs = np.array([SMOOTH.get(r.kind, SMOOTH["sensor"]) for r in st.readings])
        pts, vals, smooth = np.vstack([pts, rp]), np.concatenate([vals, rv]), np.concatenate([smooth, rs])
    st.model = ThinPlate(pts, vals, smooth if st.readings else None)
    st.z = st.model(NODES)
    st.feats = features(st.z, GRID)
    st.suggestions = None
    st.version += 1


def _metrics(st: _State) -> AppMetricsOut:
    if st.z is None:
        return AppMetricsOut(rmse=None, mae=None, r2=None, max_error=None, obs_fit=None, typical_miss=None)
    err = st.z - st.truth
    ss = float(((st.truth - st.truth.mean()) ** 2).sum())
    obs_fit = None
    if st.readings and st.model is not None:
        q = np.array([[r.u, r.v] for r in st.readings])
        obs_fit = float(np.abs(st.model(q) - np.array([r.value for r in st.readings])).mean())
    return AppMetricsOut(
        rmse=float(np.sqrt((err**2).mean())),
        mae=float(np.abs(err).mean()),
        r2=float(1 - (err**2).sum() / ss) if ss > 0 else None,
        max_error=float(np.abs(err).max()),
        obs_fit=obs_fit,
        typical_miss=st.stop.typical_miss if st.stop else None,
    )


def _allowed(st: _State) -> float:
    if st.stop is not None:
        return st.stop.allowed_miss
    return 0.5 * depth_threshold(st.vals, DEPTH_REL, None)


# ---------------------------------------------------------------- training
def start_training(key: str, reset: bool = True, pace_ms: int = 60, budget: int | None = None) -> bool:
    st = _state(key)
    with st.lock:
        if st.cancel is not None:
            st.cancel.set()
        cancel = threading.Event()
        st.cancel = cancel
        st.status = "training"
        if reset:
            st.pts, st.vals, st.reasons, st.history, st.stop = np.empty((0, 2)), np.empty(0), [], [], None
    cap = budget or st.app.budget
    threading.Thread(
        target=_train_loop, args=(st, cancel, pace_ms / 1000, cap), daemon=True, name=f"app-train-{key}"
    ).start()
    return True


def _train_loop(st: _State, cancel: threading.Event, pace: float, cap: int) -> None:
    app = st.app
    t0 = time.perf_counter()
    try:
        with st.lock:
            pts, vals, reasons = st.pts.copy(), st.vals.copy(), list(st.reasons)
        preds: list[float | None] = [None] * len(vals)
        rng = np.random.default_rng([SEED, len(vals)])
        fld: Field | None = build_field(pts, vals, CFG) if len(vals) >= CFG.n_init else None
        while not cancel.is_set():
            if len(vals) >= cap:
                final = "budget"
                break
            depth = depth_threshold(vals, DEPTH_REL, None)
            props = propose(pts, vals, np.empty((0, 2)), min(BATCH, cap - len(vals)), rng, depth, CFG, fld, seed=SEED)
            if not props:
                final = "budget"
                break
            new = np.array([[p.u, p.v] for p in props])
            pts = np.vstack([pts, new])
            vals = np.concatenate([vals, app.truth_unit(new)])
            preds += [p.predicted for p in props]
            reasons += [p.reason for p in props]
            stop = None
            if len(vals) >= CFG.n_init:
                fld = build_field(pts, vals, CFG)
                scored = [(p, y, r) for p, y, r in zip(preds, vals, reasons, strict=True) if p is not None]
                recent = [abs(p - y) for p, y, _ in scored]
                rand = [abs(p - y) for p, y, r in scored if r == "explore"]
                stop = certify(pts, vals, recent, rand, depth_threshold(vals, DEPTH_REL, None), CFG, fld)
            with st.lock:
                if cancel.is_set():
                    return
                st.pts, st.vals, st.reasons, st.stop = pts, vals, list(reasons), stop
                _refit(st)
                if st.z is not None:
                    m = _metrics(st)
                    st.history.append(
                        {"runs": len(vals), "rmse": m.rmse, "r2": m.r2 if m.r2 is not None else 0.0,
                         "ready": bool(stop and stop.ready)}
                    )  # fmt: skip
            if stop is not None and stop.ready:
                final = "ready"
                break
            if pace:
                cancel.wait(pace)
        else:
            return
        with st.lock:
            if not cancel.is_set():
                st.status = final
                st.train_ms = (time.perf_counter() - t0) * 1000
                st.trained_at = datetime.now(UTC)
    except Exception:  # pragma: no cover - a background thread must never die silently
        log.exception("training %s failed", app.key)
        with st.lock:
            st.status = "budget" if st.model is not None else "idle"


# ---------------------------------------------------------------- output shapes
def _band_out(b: Band) -> AppBandOut:
    return AppBandOut(upto=None if b.upto == float("inf") else b.upto, label=b.label, color=b.color, advice=b.advice)


def _summary_fields(st: _State) -> dict:
    app = st.app
    return dict(
        key=app.key, name=app.name, tagline=app.tagline, description=app.description,
        reference_name=app.reference_name,
        inputs=[AppInputOut(key=i.key, label=i.label, unit=i.unit, low=i.low, high=i.high, step=i.step, fmt=i.fmt)
                for i in app.inputs],
        output_label=app.output_label, output_unit=app.output_unit, bands=[_band_out(b) for b in app.bands],
        examples=[AppExampleOut(label=lbl, x1=a, x2=b) for lbl, a, b in app.examples],
        hue=app.hue, budget=app.budget, status=st.status, runs=len(st.vals), observations=len(st.readings),
        version=st.version, metrics=_metrics(st),
    )  # fmt: skip


def summary(session: Session, key: str) -> AppSummaryOut:
    st = ensure(session, key)
    with st.lock:
        return AppSummaryOut(**_summary_fields(st))


def _suggest(st: _State, k: int = 3) -> list[AppPointOut]:
    """Where a new reading would teach the model most: the learner's own next picks, given all data."""
    if st.model is None or st.z is None:
        return []
    pts = st.pts
    vals = st.vals
    if st.readings:
        pts = np.vstack([pts, [[r.u, r.v] for r in st.readings]])
        vals = np.concatenate([vals, [r.value for r in st.readings]])
    fld = Field(st.model, st.z, st.feats, GRID, float(vals.max() - vals.min()))
    rng = np.random.default_rng([SEED, len(vals), 99])
    props = propose(pts, vals, np.empty((0, 2)), k, rng, depth_threshold(vals, DEPTH_REL, None), CFG, fld)
    out = []
    for p in props:
        x = [float(c) for c in st.app.to_real(p.u, p.v)]
        for i, inp in enumerate(st.app.inputs):
            if inp.fmt == "weekday":  # a reading is taken on a day, not between two
                x[i] = float(min(inp.high, max(inp.low, round(x[i] / inp.step) * inp.step)))
        u, v = st.app.to_unit(x[0], x[1])
        out.append(AppPointOut(x1=x[0], x2=x[1], u=float(u), v=float(v), reason=p.reason))
    return out


def state(session: Session, key: str) -> AppStateOut:
    st = ensure(session, key)
    with st.lock:
        app = st.app
        z = z_min = z_max = None
        if st.z is not None:
            z = base64.b64encode(st.z.astype("<f4").tobytes()).decode()
            z_min, z_max = float(st.z.min()), float(st.z.max())
        runs = []
        for (u, v), y, r in zip(st.pts, st.vals, st.reasons, strict=True):
            x1, x2 = app.to_real(u, v)
            runs.append(AppRunOut(x1=float(x1), x2=float(x2), u=float(u), v=float(v), value=float(y), reason=r))
        now = st.model(np.array([[r.u, r.v] for r in st.readings])) if st.readings and st.model else []
        readings = [
            AppObservationOut(id=r.id, x1=r.x1, x2=r.x2, u=r.u, v=r.v, value=r.value, kind=r.kind, source=r.source,
                              before=r.before, now=float(now[i]) if len(now) else None, created_at=r.created_at)
            for i, r in enumerate(st.readings)
        ][::-1]  # fmt: skip
        feats = []
        if st.z is not None:
            span = float(st.z.max() - st.z.min()) or 1.0
            for f in sorted(st.feats, key=lambda f: -f.depth):
                if f.depth < DEPTH_REL * span:
                    continue
                a, b = divmod(f.node, GRID)
                x1, x2 = app.to_real(a / (GRID - 1), b / (GRID - 1))
                feats.append(AppFeatureOut(kind=f.kind, x1=float(x1), x2=float(x2), value=f.value, depth=f.depth))
        if st.suggestions is None and st.status != "training":
            st.suggestions = _suggest(st)
        hist = [AppHistoryOut(**h) for h in st.history if h["rmse"] is not None]
        return AppStateOut(
            **_summary_fields(st), grid=GRID, z=z, z_min=z_min, z_max=z_max, sim_runs=runs, readings=readings[:300],
            features=feats[:12], suggestions=st.suggestions or [], history=hist,
            stop=stop_out(st.stop) if st.stop else None, train_ms=st.train_ms, trained_at=st.trained_at,
        )  # fmt: skip


# ---------------------------------------------------------------- predict
def _check_inside(app: Application, x1: float, x2: float) -> tuple[float, float]:
    a, b = app.inputs
    tol_a, tol_b = 1e-9 * (a.high - a.low), 1e-9 * (b.high - b.low)
    if not (a.low - tol_a <= x1 <= a.high + tol_a and b.low - tol_b <= x2 <= b.high + tol_b):
        raise HTTPException(
            422,
            f"({x1:g}, {x2:g}) is outside the model's range: {a.label} {a.low:g}-{a.high:g}, "
            f"{b.label} {b.low:g}-{b.high:g}",
        )
    u, v = app.to_unit(x1, x2)
    return float(np.clip(u, 0, 1)), float(np.clip(v, 0, 1))


def _nearest(st: _State, u: float, v: float) -> tuple[float, float]:
    """Distance from (u, v) to the closest data point, and the typical spacing between data points."""
    pts = st.pts
    if st.readings:
        pts = np.vstack([pts, [[r.u, r.v] for r in st.readings]])
    d = np.sqrt(((pts - (u, v)) ** 2).sum(axis=1)).min()
    spacing = 0.5 / np.sqrt(max(1, len(pts)))  # mean nearest-neighbour distance of a uniform scatter
    return float(d), float(spacing)


def predict(session: Session, key: str, x1: float, x2: float) -> AppPredictOut:
    st = ensure(session, key)
    app = st.app
    u, v = _check_inside(app, x1, x2)
    with st.lock:
        model = st.model
        if model is None:
            raise HTTPException(409, "the model is still taking its first reference runs; try again in a moment")
        q = np.array([[u, v]])
        reps = 200
        t0 = time.perf_counter()
        for _ in range(reps):
            value = float(model(q)[0])
        micros = (time.perf_counter() - t0) / reps * 1e6
        h = 1e-3
        du = (float(model(np.array([[min(1, u + h), v]]))[0]) - float(model(np.array([[max(0, u - h), v]]))[0])) / (
            min(1, u + h) - max(0, u - h)
        )
        dv = (float(model(np.array([[u, min(1, v + h)]]))[0]) - float(model(np.array([[u, max(0, v - h)]]))[0])) / (
            min(1, v + h) - max(0, v - h)
        )
        a, b = app.inputs
        sens = [du / (a.high - a.low), dv / (b.high - b.low)]
        typical = st.stop.typical_miss if st.stop and st.stop.typical_miss is not None else _allowed(st)
        d, spacing = _nearest(st, u, v)
        half = float(typical * min(3.0, max(0.6, 0.6 + d / max(spacing, 1e-9))))
        reference = float(app.truth_unit(q)[0])
        version = st.version
    return AppPredictOut(
        x1=x1, x2=x2, value=value, low=value - half, high=value + half, band=_band_out(app.band(value)),
        reference=reference, error=value - reference, sensitivity=sens,
        details=[AppDetailOut(label=lbl, value=val) for lbl, val in app.details(x1, x2, value)],
        nearest=d, micros=micros, version=version,
    )  # fmt: skip


# ---------------------------------------------------------------- new data
def add_readings(session: Session, key: str, readings: list[AppReadingIn], source: str) -> AppRetrainOut:
    st = ensure(session, key)
    app = st.app
    unit = [_check_inside(app, r.x1, r.x2) for r in readings]
    with st.lock:
        if st.model is None or st.z is None:
            raise HTTPException(409, "the model is still taking its first reference runs; try again in a moment")
        t0 = time.perf_counter()
        before_metrics = _metrics(st)
        z_before = st.z.copy()
        q = np.array(unit)
        before = st.model(q)
        rows = [
            AppObservation(app_key=key, x1=r.x1, x2=r.x2, value=r.value, kind=r.kind, source=source,
                           before=float(before[i]))
            for i, r in enumerate(readings)
        ]  # fmt: skip
        session.add_all(rows)
        session.commit()
        st.readings.extend(_reading(app, r) for r in rows)
        _refit(st)
        after = st.model(q)
        retrain_ms = (time.perf_counter() - t0) * 1000
        allowed = _allowed(st)
        st.suggestions = _suggest(st)
        # a sensor reading only surprises when it is further off than its own noise explains
        tol = [
            allowed if row.kind == "verified" else max(allowed, 2 * float(app.noise(np.array([row.value]))[0]))
            for row in rows
        ]
        items = [
            AppRetrainItemOut(
                id=row.id,
                x1=row.x1,
                x2=row.x2,
                value=row.value,
                before=float(before[i]),
                after=float(after[i]),
                tolerance=tol[i],
                surprise=bool(abs(before[i] - row.value) > tol[i]),
            )
            for i, row in enumerate(rows)
        ]  # fmt: skip
        return AppRetrainOut(
            items=items, version=st.version, retrain_ms=retrain_ms, metrics_before=before_metrics,
            metrics_after=_metrics(st), allowed_miss=allowed, max_shift=float(np.abs(st.z - z_before).max()),
            suggestions=st.suggestions,
        )  # fmt: skip


def sample_readings(session: Session, key: str, n: int, source: str) -> AppRetrainOut:
    """Simulate field sensors: readings at random places, the reference value plus realistic sensor noise."""
    app = _app(key)
    rng = np.random.default_rng()
    uv = rng.random((n, 2))
    truth = app.truth_unit(uv)
    noisy = truth + rng.standard_normal(n) * app.noise(truth)
    x1, x2 = app.to_real(uv[:, 0], uv[:, 1])
    a, b = app.inputs
    out = []
    for i in range(n):
        p1 = float(np.round(x1[i] / a.step) * a.step) if a.fmt == "weekday" else float(x1[i])
        p2 = float(np.round(x2[i] / b.step) * b.step) if b.fmt == "weekday" else float(x2[i])
        out.append(AppReadingIn(x1=min(a.high, max(a.low, p1)), x2=min(b.high, max(b.low, p2)),
                                value=float(noisy[i]), kind="sensor"))  # fmt: skip
    return add_readings(session, key, out, source)


def delete_reading(session: Session, key: str, reading_id: int) -> None:
    st = ensure(session, key)
    row = session.get(AppObservation, reading_id)
    if row is None or row.app_key != key:
        raise HTTPException(404, "reading not found")
    session.delete(row)
    session.commit()
    with st.lock:
        st.readings = [r for r in st.readings if r.id != reading_id]
        _refit(st)


def clear_readings(session: Session, key: str) -> int:
    st = ensure(session, key)
    n = session.execute(delete(AppObservation).where(AppObservation.app_key == key)).rowcount or 0
    session.commit()
    with st.lock:
        st.readings = []
        _refit(st)
    return n


# ---------------------------------------------------------------- model card
THUMB = 33


def _landscape(z_fine: np.ndarray, z_thumb: np.ndarray) -> AppLandscapeOut:
    span = float(z_fine.max() - z_fine.min()) or 1.0
    deep = [f for f in features(z_fine, GRID) if f.depth > DEPTH_REL * span]
    return AppLandscapeOut(
        peaks=sum(f.kind == "max" for f in deep),
        valleys=sum(f.kind == "min" for f in deep),
        thumb=base64.b64encode(np.asarray(z_thumb, dtype="<f4").tobytes()).decode(),
    )


@lru_cache(maxsize=8)
def model_card(key: str) -> AppModelOut:
    """The application's own function, explained, and how it compares with each benchmark function."""
    app = _app(key)
    card = CARDS[key]
    thumb_nodes = grid_points(THUMB)
    mine = _landscape(app.truth_unit(NODES), app.truth_unit(thumb_nodes))
    rows = []
    for sim in TEST_FUNCTIONS.values():
        land = _landscape(sim.at_unit(NODES), sim.at_unit(thumb_nodes))
        dist = float(np.hypot(land.peaks - mine.peaks, land.valleys - mine.valleys))
        rows.append((sim, land, dist))
    best = min(d for _, _, d in rows)
    return AppModelOut(
        function_name=card.function_name,
        formula=list(card.formula),
        terms=[AppTermOut(symbol=s, meaning=m) for s, m in card.terms],
        shape=card.shape,
        general=GENERAL,
        thumb_grid=THUMB,
        landscape=mine,
        benchmarks=[
            AppBenchmarkOut(key=sim.key, name=sim.name, note=sim.note, landscape=land, distance=dist,
                            closest=dist == best, reason=card.why_not.get(sim.key, ""))
            for sim, land, dist in sorted(rows, key=lambda r: r[2])
        ],
    )  # fmt: skip
