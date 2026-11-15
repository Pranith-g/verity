"""The Verify strategy, written as two stateless functions.

``propose`` looks at everything measured so far and names the next runs to buy.
``certify`` looks at the same data and says whether it is safe to stop.

Neither keeps state between calls, so a study can be resumed from its stored samples at
any time, by any process.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

from .surrogate import ThinPlate, grid_points
from .topology import Feature, features

Array = np.ndarray


@dataclass(frozen=True)
class LearnerConfig:
    grid: int = 49  # resolution used to list the surrogate's features
    explore: float = 0.35  # share of each batch spent on fresh random points
    n_init: int = 12  # opening runs before the first fit
    init_design: str = "lhs"  # "lhs": maximin Latin hypercube opening runs; "random": uniform random
    on_feature: float = 0.0125  # a sample this close to an extremum counts as "on it"
    polish_radius: float = 0.0625  # a trusted extremum has >= 4 samples inside this radius (3 grid cells)
    polish_count: int = 4
    max_gap: float = 0.07  # no blind spot may be wider than this share of the map
    miss_window: int = 24  # how many recent runs the "surprise" test looks at
    min_misses: int = 18  # runs needed before that test can pass
    duplicate: float = 2e-3  # never pay twice for (nearly) the same point


@dataclass(frozen=True)
class Proposal:
    u: float
    v: float
    reason: str  # init | explore | verify | fill
    predicted: float | None  # what the surrogate expects there (None before the first fit)


@dataclass
class Field:
    """The current surrogate, evaluated on the grid, with its features listed."""

    surrogate: ThinPlate
    z: Array  # flat, grid*grid
    features: list[Feature]
    grid: int
    observed_range: float

    def node_uv(self, node: int) -> tuple[float, float]:
        a, b = divmod(node, self.grid)
        return a / (self.grid - 1), b / (self.grid - 1)


@dataclass(frozen=True)
class StopStatus:
    ready: bool
    features_checked: bool
    surprises_small: bool
    no_blind_spot: bool
    unchecked: int
    worst_recent_miss: float | None  # output units
    typical_miss: float | None  # 95% level on fresh random points, output units
    allowed_miss: float  # half the depth that matters, output units
    largest_gap: float  # share of the map
    depth: float  # depth threshold in output units
    deep_features: int = 0
    notes: list[str] = field(default_factory=list)


def depth_threshold(values: Array, rel: float, absolute: float | None) -> float:
    """Depth below which a feature is ignored, in output units.

    Uses only what has been measured: the learner never knows the true output range.
    """
    if absolute is not None:
        return float(absolute)
    values = np.asarray(values, dtype=float)
    if values.size == 0:
        return 0.0
    return float(rel * (values.max() - values.min()))


def build_field(points: Array, values: Array, cfg: LearnerConfig) -> Field:
    surrogate = ThinPlate(points, values)
    z = surrogate(grid_points(cfg.grid))
    values = np.asarray(values, dtype=float)
    return Field(surrogate, z, features(z, cfg.grid), cfg.grid, float(values.max() - values.min()))


class _Taken:
    """Points that are already paid for, pending, or chosen in this batch."""

    def __init__(self, points: Array) -> None:
        self._pts = [np.asarray(points, dtype=float).reshape(-1, 2)]
        self._cache: Array | None = None

    @property
    def array(self) -> Array:
        if self._cache is None:
            self._cache = np.vstack(self._pts)
        return self._cache

    def add(self, u: float, v: float) -> None:
        self._pts.append(np.array([[u, v]]))
        self._cache = None

    def min_dist(self, u: float, v: float) -> float:
        a = self.array
        if a.size == 0:
            return float("inf")
        return float(np.sqrt(((a - (u, v)) ** 2).sum(axis=1).min()))

    def count_near(self, u: float, v: float, r: float) -> int:
        a = self.array
        return int((((a - (u, v)) ** 2).sum(axis=1) <= r * r).sum())


_PHI_P = 15.0  # Morris-Mitchell exponent: large enough that phi ranks designs like maximin does


def _inv_pow(pts: Array, row: Array) -> Array:
    """d^-p from one point to every point (0 for itself), with d the Euclidean distance."""
    d2 = ((pts - row) ** 2).sum(axis=1)
    out = np.zeros_like(d2)
    nz = d2 > 0
    out[nz] = d2[nz] ** (-_PHI_P / 2)
    return out


@lru_cache(maxsize=256)
def _lhs_maximin(n: int, seed: int, dim: int, starts: int) -> Array:
    """Local search on the Morris-Mitchell score sum(d^-p) over all pairs, which is smooth enough
    to climb, unlike the bare minimum distance."""
    rng = np.random.default_rng(seed)
    best: Array | None = None
    best_phi = float("inf")
    for _ in range(starts):
        # one point per row and per column of an n x n grid, placed at the cell centre
        ranks = np.column_stack([rng.permutation(n) for _ in range(dim)])
        pts = (ranks + 0.5) / n
        P = np.array([_inv_pow(pts, pts[i]) for i in range(n)])
        improved = True
        while improved:  # swap one coordinate between two points while that spreads them out
            improved = False
            for k in range(dim):
                for i in range(n - 1):
                    for j in range(i + 1, n):
                        pts[[i, j], k] = pts[[j, i], k]  # the i-j distance itself is unchanged
                        ri, rj = _inv_pow(pts, pts[i]), _inv_pow(pts, pts[j])
                        if ri.sum() + rj.sum() < P[i].sum() + P[j].sum() - 1e-9 * (P[i].sum() + P[j].sum()):
                            P[i], P[j] = ri, rj
                            P[:, i], P[:, j] = ri, rj
                            improved = True
                        else:
                            pts[[i, j], k] = pts[[j, i], k]
        cur = float(P.sum())
        if cur < best_phi:
            best, best_phi = pts.copy(), cur
    assert best is not None
    best.setflags(write=False)
    return best


def lhs_maximin(n: int, seed: int, dim: int = 2, starts: int = 4) -> Array:
    """A maximin Latin hypercube: ``n`` points, one in every row and every column of an n x n
    grid, arranged so the closest pair is as far apart as possible (Euclidean).

    Deterministic for a given seed, so a study can hand its opening runs out over several
    calls, or to parallel workers, without regenerating a different design each time.
    """
    if n <= 0:
        return np.empty((0, dim))
    return _lhs_maximin(int(n), int(seed), int(dim), int(starts)).copy()


def min_pair_distance(points: Array) -> float:
    """Smallest Euclidean distance between any two points (the maximin score of a design)."""
    pts = np.asarray(points, dtype=float).reshape(-1, 2)
    if len(pts) < 2:
        return float("inf")
    d = ((pts[:, None, :] - pts[None, :, :]) ** 2).sum(axis=2)
    return float(np.sqrt(d[np.triu_indices(len(pts), 1)].min()))


def opening_design(n: int, seed: int, cfg: LearnerConfig) -> Array:
    """The opening runs for a study or race, by ``cfg.init_design``."""
    if cfg.init_design == "lhs":
        return lhs_maximin(n, seed)
    if cfg.init_design == "random":
        return np.random.default_rng(seed).random((n, 2))
    raise ValueError(f"unknown init_design {cfg.init_design!r}")


def largest_gap(points: Array, grid: int) -> tuple[float, tuple[float, float]]:
    """Radius and centre of the biggest hole in the sampling."""
    nodes = grid_points(grid)
    pts = np.asarray(points, dtype=float).reshape(-1, 2)
    if pts.size == 0:
        return 1.0, (0.5, 0.5)
    d2 = ((nodes[:, None, :] - pts[None, :, :]) ** 2).sum(axis=2).min(axis=1)
    i = int(d2.argmax())
    return float(np.sqrt(d2[i])), (float(nodes[i, 0]), float(nodes[i, 1]))


def bowl_vertex(
    kind: str, node_uv: tuple[float, float], points: Array, values: Array, cfg: LearnerConfig
) -> tuple[float, float] | None:
    """Where a round bowl fitted to the runs around an extremum says the true bottom (or top) is.

    The surrogate can only place an extremum on a grid node, and with few runs nearby it tends to
    put it exactly on the best run so far. A least-squares paraboloid through the neighbouring runs
    gives a second opinion; if it points somewhere else, that spot deserves a run.
    """
    points = np.asarray(points, dtype=float).reshape(-1, 2)
    d = points - node_uv
    near = (d**2).sum(axis=1) <= cfg.polish_radius**2
    if int(near.sum()) < 4:
        return None
    d, y = d[near], np.asarray(values, dtype=float)[near]
    design = np.column_stack([np.ones(len(d)), d[:, 0], d[:, 1], (d**2).sum(axis=1)])
    coef, *_ = np.linalg.lstsq(design, y, rcond=None)
    curv = float(coef[3])
    if (kind == "min" and curv <= 0) or (kind == "max" and curv >= 0) or abs(curv) < 1e-12:
        return None
    step = np.array([-coef[1], -coef[2]]) / (2 * curv)
    cell = 1.0 / (cfg.grid - 1)
    length = float(np.hypot(*step))
    if length > 2 * cell:
        step *= 2 * cell / length
    u = min(1.0, max(0.0, node_uv[0] + float(step[0])))
    v = min(1.0, max(0.0, node_uv[1] + float(step[1])))
    return u, v


def _needs_vertex_run(
    f: Feature, fld: Field, points: Array, values: Array, taken: _Taken, cfg: LearnerConfig
) -> tuple[float, float] | None:
    node = fld.node_uv(f.node)
    vertex = bowl_vertex(f.kind, node, points, values, cfg)
    if vertex is None:
        return None
    cell = 1.0 / (cfg.grid - 1)
    if np.hypot(vertex[0] - node[0], vertex[1] - node[1]) <= 0.6 * cell:
        return None
    if taken.min_dist(*vertex) <= 0.6 * cell:
        return None
    return vertex


def propose(
    points: Array,
    values: Array,
    pending: Array,
    k: int,
    rng: np.random.Generator,
    depth: float,
    cfg: LearnerConfig,
    fld: Field | None = None,
    seed: int | None = None,
) -> list[Proposal]:
    """Name the next ``k`` runs to buy.

    points/values: completed runs on the unit square. pending: points already handed
    out but not reported back yet (so parallel workers never get the same point).
    seed: fixes the opening design for the whole study. Pass the same value on every call,
    so the opening runs come from one design however they are split across calls; without
    it the design is drawn from ``rng`` and only holds together within a single call.
    """
    points = np.asarray(points, dtype=float).reshape(-1, 2)
    pending = np.asarray(pending, dtype=float).reshape(-1, 2)
    taken = _Taken(np.vstack([points, pending]))
    out: list[Proposal] = []

    def take(u: float, v: float, reason: str, surrogate: ThinPlate | None) -> bool:
        if taken.min_dist(u, v) < cfg.duplicate:
            return False
        pred = None if surrogate is None else float(surrogate(np.array([[u, v]]))[0])
        out.append(Proposal(float(u), float(v), reason, pred))
        taken.add(u, v)
        return True

    # Before the first fit: the opening design. Its points are handed out in order; any that
    # are already paid for or pending are skipped by the duplicate check, so repeated or
    # parallel calls carry on through the same design instead of starting a new one.
    if len(points) < cfg.n_init:
        need = max(0, min(k, cfg.n_init - len(points) - len(pending)))
        if need:
            design_seed = int(rng.integers(2**31)) if seed is None else int(seed)
            for u, v in opening_design(cfg.n_init, design_seed, cfg):
                if len(out) >= need:
                    break
                take(float(u), float(v), "init", None)
        guard = 0
        while len(out) < need and guard < 20 * k:  # design used up (runs reported off-design)
            guard += 1
            take(float(rng.random()), float(rng.random()), "init", None)
        if out or len(points) < 3:
            return out
    if fld is None:
        fld = build_field(points, values, cfg)
    s = fld.surrogate

    # 1) fresh random points keep the error estimate unbiased
    n_explore = max(1, round(k * cfg.explore))
    guard = 0
    while len(out) < min(k, n_explore) and guard < 20 * k:
        guard += 1
        take(float(rng.random()), float(rng.random()), "explore", s)

    # 2) the surrogate's own peaks and valleys, deepest first: one run on top, a few beside it,
    #    and one more wherever a bowl fitted to those runs says the real bottom/top is
    cell = 1.0 / (cfg.grid - 1)
    cands = sorted((f for f in fld.features if f.depth > 0.25 * depth), key=lambda f: -f.depth)
    for f in cands:
        if len(out) >= k:
            break
        u, v = fld.node_uv(f.node)
        if taken.min_dist(u, v) >= cfg.on_feature:
            take(u, v, "verify", s)
            continue
        if f.depth <= depth:
            continue
        if taken.count_near(u, v, cfg.polish_radius) < cfg.polish_count:
            th = float(rng.random()) * 2 * np.pi
            pu = min(1.0, max(0.0, u + 1.5 * cell * np.cos(th)))
            pv = min(1.0, max(0.0, v + 1.5 * cell * np.sin(th)))
            take(pu, pv, "verify", s)
            continue
        vertex = _needs_vertex_run(f, fld, points, values, taken, cfg)
        if vertex is not None:
            take(vertex[0], vertex[1], "verify", s)

    # 3) then the passes between them (where each feature merges into its neighbour)
    for f in cands:
        if len(out) >= k:
            break
        if f.merge < 0:
            continue
        u, v = fld.node_uv(f.merge)
        if taken.min_dist(u, v) < 2 * cfg.on_feature:
            continue
        take(u, v, "verify", s)

    # 4) nothing left to check: put a run in the middle of the biggest blind spot
    guard = 0
    while len(out) < k and guard < 4 * k:
        guard += 1
        _, (u, v) = largest_gap(taken.array, cfg.grid)
        if not take(u, v, "fill", s):
            take(float(rng.random()), float(rng.random()), "fill", s)
    return out


def certify(
    points: Array,
    values: Array,
    recent_misses: list[float],
    random_misses: list[float],
    depth: float,
    cfg: LearnerConfig,
    fld: Field,
) -> StopStatus:
    """The stop rule. Uses no ground truth.

    recent_misses: |predicted - measured| for the latest runs of any kind, oldest first.
    random_misses: the same, for runs placed at fresh random points only.
    """
    points = np.asarray(points, dtype=float).reshape(-1, 2)
    taken = _Taken(points)
    window = recent_misses[-cfg.miss_window :]
    worst = max(window) if len(window) >= cfg.min_misses else None
    rand = sorted(random_misses[-40:])
    typical = None
    if len(rand) >= 12:
        typical = rand[min(len(rand) - 1, int(np.ceil(0.95 * (len(rand) + 1))) - 1)]
    deep = [f for f in fld.features if f.depth > depth]
    unchecked = 0
    for f in deep:
        u, v = fld.node_uv(f.node)
        if (
            taken.min_dist(u, v) >= cfg.on_feature
            or taken.count_near(u, v, cfg.polish_radius) < cfg.polish_count
            or _needs_vertex_run(f, fld, points, values, taken, cfg) is not None
        ):
            unchecked += 1
    gap, _ = largest_gap(points, cfg.grid)
    allowed = 0.5 * depth
    a = unchecked == 0
    b = worst is not None and worst <= allowed
    c = gap <= cfg.max_gap
    notes: list[str] = []
    if depth <= 0:
        notes.append("Output has no spread yet, so no depth threshold can be set.")
    return StopStatus(
        ready=bool(a and b and c and depth > 0),
        features_checked=a,
        surprises_small=bool(b),
        no_blind_spot=bool(c),
        unchecked=unchecked,
        worst_recent_miss=worst,
        typical_miss=typical,
        allowed_miss=allowed,
        largest_gap=gap,
        depth=depth,
        deep_features=len(deep),
        notes=notes,
    )
