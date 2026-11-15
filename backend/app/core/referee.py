"""The referee: compares a surrogate with the truth. Benchmarks only.

A true feature counts as captured when the surrogate has a feature of the same kind
whose bottom and top both sit within half the chosen depth of the real ones. A ghost is
a deep surrogate feature that matches nothing real.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .simulators import Simulator
from .surrogate import grid_points
from .topology import Feature, features

Array = np.ndarray


@dataclass
class Truth:
    simulator: Simulator
    grid: int
    tau: float
    z: Array
    lo: float
    hi: float
    all: list[Feature]
    significant: list[Feature]

    @property
    def range(self) -> float:
        return self.hi - self.lo

    @property
    def depth(self) -> float:
        return self.tau * self.range


def make_truth(simulator: Simulator, grid: int, tau: float) -> Truth:
    z = simulator.at_unit(grid_points(grid))
    lo, hi = float(z.min()), float(z.max())
    feats = features(z, grid)
    return Truth(simulator, grid, tau, z, lo, hi, feats, [f for f in feats if f.depth > tau * (hi - lo)])


def _match(a: list[Feature], b: list[Feature], delta: float) -> list[bool]:
    """Maximum bipartite matching; returns which members of ``a`` found a partner in ``b``."""
    adj: list[list[int]] = []
    for p in a:
        pe = p.ends
        adj.append(
            [
                j
                for j, q in enumerate(b)
                if q.kind == p.kind and abs(pe[0] - q.ends[0]) <= delta and abs(pe[1] - q.ends[1]) <= delta
            ]
        )
    owner = [-1] * len(b)

    def try_row(i: int, seen: list[bool]) -> bool:
        for j in adj[i]:
            if seen[j]:
                continue
            seen[j] = True
            if owner[j] < 0 or try_row(owner[j], seen):
                owner[j] = i
                return True
        return False

    for i in range(len(a)):
        try_row(i, [False] * len(b))
    got = [False] * len(a)
    for i in owner:
        if i >= 0:
            got[i] = True
    return got


@dataclass
class Audit:
    n: int
    rmse: float  # share of the true output range
    worst: float  # share of the true output range
    at_features: float  # mean error at the true features, share of range
    captured: int
    total: int
    ghosts: int
    hit: list[bool]
    ghost_nodes: list[int]

    @property
    def complete(self) -> bool:
        return self.captured == self.total and self.ghosts == 0


def audit(n: int, z: Array, feats: list[Feature], truth: Truth) -> Audit:
    r = truth.range
    delta = 0.5 * truth.depth
    tiny = 0.02 * truth.depth
    err = np.abs(z - truth.z)
    at = float(np.mean([err[f.node] for f in truth.significant])) if truth.significant else 0.0
    hit = _match(truth.significant, [f for f in feats if f.depth > tiny], delta)
    deep = [f for f in feats if f.depth > truth.depth]
    real = _match(deep, [f for f in truth.all if f.depth > tiny], delta)
    ghosts = [f.node for f, ok in zip(deep, real, strict=True) if not ok]
    return Audit(
        n=n,
        rmse=float(np.sqrt(np.mean(err**2)) / r),
        worst=float(err.max() / r),
        at_features=at / r,
        captured=sum(hit),
        total=len(truth.significant),
        ghosts=len(ghosts),
        hit=hit,
        ghost_nodes=ghosts,
    )
