"""Three strategies on the same budget, scored by the referee.

Random buys runs anywhere. Chase sends a Nelder-Mead optimizer up and down the real
simulator and keeps every step it pays for (a simplified version of the optimizer-directed
sampling in Diaw et al., 2024). Verify is the strategy in ``learner``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass

import numpy as np

from .learner import (
    Field,
    LearnerConfig,
    StopStatus,
    build_field,
    certify,
    depth_threshold,
    opening_design,
    propose,
)
from .referee import Audit, Truth, audit, make_truth
from .simulators import SIMULATORS, Simulator

Array = np.ndarray
KINDS = ("random", "chase", "verify")


def nelder_mead_trace(
    obj: Callable[[float, float], float], u0: float, v0: float, size: float, max_eval: int, ftol: float
) -> list[tuple[float, float]]:
    """Run Nelder-Mead on the unit square and return every point it asked for, in order."""
    trace: list[tuple[float, float]] = []

    def clip(t: float) -> float:
        return min(1.0, max(0.0, t))

    def ev(p: list[float]) -> float:
        q = (clip(p[0]), clip(p[1]))
        trace.append(q)
        return obj(q[0], q[1])

    s = [[clip(u0), clip(v0)], [clip(u0 + size), clip(v0)], [clip(u0), clip(v0 + size)]]
    if s[1][0] == s[0][0]:
        s[1][0] = clip(u0 - size)
    if s[2][1] == s[0][1]:
        s[2][1] = clip(v0 - size)
    f = [ev(p) for p in s]
    while len(trace) < max_eval:
        idx = sorted(range(3), key=lambda i: f[i])
        s = [s[i] for i in idx]
        f = [f[i] for i in idx]
        diam = max(np.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]), np.hypot(s[2][0] - s[0][0], s[2][1] - s[0][1]))
        if diam < 0.008 or abs(f[2] - f[0]) < ftol:
            break
        c = [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2]
        worst = s[2]

        def at(t: float, c: list[float] = c, worst: list[float] = worst) -> list[float]:
            return [c[0] + t * (worst[0] - c[0]), c[1] + t * (worst[1] - c[1])]

        xr = at(-1.0)
        fr = ev(xr)
        if fr < f[0]:
            xe = at(-2.0)
            fe = ev(xe)
            s[2], f[2] = (xe, fe) if fe < fr else (xr, fr)
        elif fr < f[1]:
            s[2], f[2] = xr, fr
        else:
            xc = at(-0.5) if fr < f[2] else at(0.5)
            fc = ev(xc)
            if fc < min(fr, f[2]):
                s[2], f[2] = xc, fc
            else:
                for i in (1, 2):
                    s[i] = [(s[0][0] + s[i][0]) / 2, (s[0][1] + s[i][1]) / 2]
                    f[i] = ev(s[i])
    return trace


@dataclass
class Frame:
    """One learner's state after one batch, ready to draw."""

    kind: str
    n: int
    z: Array
    new_points: list[tuple[float, float, str]]
    audit: Audit
    stop: StopStatus | None
    done_at: int | None
    declared_at: int | None
    declared_correct: bool | None


class RaceLearner:
    def __init__(self, kind: str, truth: Truth, seed: int, init: Array, cfg: LearnerConfig, tau: float) -> None:
        self.kind, self.truth, self.cfg, self.tau = kind, truth, cfg, tau
        self.rng = np.random.default_rng(seed)
        self.points = np.empty((0, 2))
        self.values = np.empty(0)
        self.tags: list[str] = []
        self.recent: list[float] = []
        self.random_misses: list[float] = []
        self._queue: list[tuple[float, float]] = []
        self._sign = 1.0
        self.done_at: int | None = None
        self.declared_at: int | None = None
        self.declared_correct: bool | None = None
        self._streak = 0
        self._prev_n = 0
        self.stop: StopStatus | None = None
        self._fresh: list[tuple[float, float, str]] = []
        for u, v in init:
            self._add(float(u), float(v), "init")
        self.field: Field = build_field(self.points, self.values, cfg)
        self.audit: Audit = self._score()

    # -- bookkeeping ---------------------------------------------------------
    @property
    def n(self) -> int:
        return len(self.values)

    def _min_dist(self, u: float, v: float) -> float:
        if not len(self.points):
            return float("inf")
        return float(np.sqrt(((self.points - (u, v)) ** 2).sum(axis=1).min()))

    def _add(self, u: float, v: float, tag: str) -> bool:
        if self._min_dist(u, v) < self.cfg.duplicate:
            return False
        y = float(self.truth.simulator.at_unit(np.array([[u, v]]))[0])
        self.points = np.vstack([self.points, [u, v]])
        self.values = np.append(self.values, y)
        self.tags.append(tag)
        self._fresh.append((u, v, tag))
        return True

    def _far_point(self, tries: int) -> tuple[float, float]:
        best, bd = (0.5, 0.5), -1.0
        for _ in range(tries):
            u, v = float(self.rng.random()), float(self.rng.random())
            d = self._min_dist(u, v)
            if d > bd:
                bd, best = d, (u, v)
        return best

    def _score(self) -> Audit:
        a = audit(self.n, self.field.z, self.field.features, self.truth)
        self._streak = self._streak + 1 if a.complete else 0
        if self._streak >= 2 and self.done_at is None:
            self.done_at = self._prev_n
        self._prev_n = self.n
        return a

    # -- one batch -----------------------------------------------------------
    def step(self, batch: int) -> Frame:
        self._fresh = []
        sim: Simulator = self.truth.simulator
        if self.kind == "random":
            for _ in range(batch):
                self._add(float(self.rng.random()), float(self.rng.random()), "explore")
        elif self.kind == "chase":
            added = guard = 0
            while added < batch and guard < 400:
                guard += 1
                if not self._queue:
                    u0, v0 = self._far_point(40)
                    sg = self._sign
                    self._sign = -self._sign
                    self._queue = nelder_mead_trace(
                        lambda u, v, sg=sg: sg * float(sim.at_unit(np.array([[u, v]]))[0]),
                        u0, v0, 0.07, 90, 1e-4 * self.truth.range,
                    )  # fmt: skip
                u, v = self._queue.pop(0)
                if self._add(u, v, "chase"):
                    added += 1
        else:
            depth = depth_threshold(self.values, self.tau, None)
            props = propose(self.points, self.values, np.empty((0, 2)), batch, self.rng, depth, self.cfg, self.field)
            for p in props:
                if self._add(p.u, p.v, p.reason) and p.predicted is not None:
                    miss = abs(p.predicted - float(self.values[-1]))
                    self.recent.append(miss)
                    if p.reason == "explore":
                        self.random_misses.append(miss)
        self.field = build_field(self.points, self.values, self.cfg)
        self.audit = self._score()
        if self.kind == "verify":
            depth = depth_threshold(self.values, self.tau, None)
            self.stop = certify(self.points, self.values, self.recent, self.random_misses, depth, self.cfg, self.field)
            if self.stop.ready and self.declared_at is None:
                self.declared_at = self.n
                self.declared_correct = self.audit.complete
        return Frame(
            self.kind, self.n, self.field.z, list(self._fresh), self.audit, self.stop,
            self.done_at, self.declared_at, self.declared_correct,
        )  # fmt: skip


@dataclass
class Race:
    truth: Truth
    learners: list[RaceLearner]
    budget: int
    batch: int

    def frames(self) -> Iterator[Frame]:
        """Advance the three learners in turn until everyone has spent the budget."""
        while any(lr.n < self.budget for lr in self.learners):
            for lr in self.learners:
                if lr.n < self.budget:
                    yield lr.step(min(self.batch, self.budget - lr.n))

    def summary(self) -> dict:
        return {
            lr.kind: {
                "captured": lr.audit.captured,
                "total": lr.audit.total,
                "ghosts": lr.audit.ghosts,
                "rmse": lr.audit.rmse,
                "at_features": lr.audit.at_features,
                "done_at": lr.done_at,
                "declared_at": lr.declared_at,
                "declared_correct": lr.declared_correct,
                "runs": lr.n,
            }
            for lr in self.learners
        }


def make_race(
    simulator: str, seed: int = 1, tau: float = 0.05, budget: int = 360, batch: int = 6,
    cfg: LearnerConfig | None = None,
) -> Race:  # fmt: skip
    cfg = cfg or LearnerConfig()
    truth = make_truth(SIMULATORS[simulator], cfg.grid, tau)
    init = opening_design(cfg.n_init, seed * 7919 + 13, cfg)  # shared by all three, so the start is fair
    learners = [RaceLearner(k, truth, seed * 101 + i * 17 + 1, init, cfg, tau) for i, k in enumerate(KINDS)]
    return Race(truth, learners, budget, batch)
