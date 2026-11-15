"""Peaks and valleys of a gridded surface, each with its depth (persistence).

Depth of a valley = how far the water level must rise before the valley merges into a
deeper one. Shallow wiggles get a small depth and can be ignored; that is the whole
point of ranking features this way.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

Array = np.ndarray


@dataclass(frozen=True)
class Feature:
    kind: str  # "min" or "max"
    node: int  # grid node of the extremum
    merge: int  # grid node where it merges into a neighbour (-1 for the global one)
    value: float  # surface value at the extremum
    depth: float  # persistence, always >= 0

    @property
    def ends(self) -> tuple[float, float]:
        """(bottom, top) of the feature on the value axis."""
        if self.kind == "min":
            return (self.value, self.value + self.depth)
        return (self.value - self.depth, self.value)


_OFFSETS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def _minima(z: Array, g: int) -> list[tuple[float, float, int, int]]:
    """Sub-level-set persistence of the minima of a flat g*g array (union-find, elder rule)."""
    zl = z.tolist()
    order = np.argsort(z, kind="stable").tolist()
    parent = [-1] * (g * g)
    birth = [0] * (g * g)
    out: list[tuple[float, float, int, int]] = []

    def find(i: int) -> int:
        root = i
        while parent[root] != root:
            root = parent[root]
        while parent[i] != root:
            parent[i], i = root, parent[i]
        return root

    for i in order:
        parent[i] = i
        birth[i] = i
        a, b = divmod(i, g)
        zi = zl[i]
        for da, db in _OFFSETS:
            na, nb = a + da, b + db
            if na < 0 or nb < 0 or na >= g or nb >= g:
                continue
            j = na * g + nb
            if parent[j] < 0:
                continue
            ri, rj = find(i), find(j)
            if ri == rj:
                continue
            bi, bj = birth[ri], birth[rj]
            if zl[bi] < zl[bj]:  # the younger component (higher birth) dies
                ri, rj, bi, bj = rj, ri, bj, bi
            if zl[bi] < zi:
                out.append((zl[bi], zi, bi, i))
            parent[ri] = rj
    root = find(order[0])
    out.append((zl[birth[root]], float(z.max()), birth[root], -1))
    return out


def features(z: Array, g: int) -> list[Feature]:
    """Every peak and valley of the surface with its depth."""
    z = np.asarray(z, dtype=float).ravel()
    if z.size != g * g:
        raise ValueError("z must have g*g entries")
    mins = [Feature("min", i, k, b, d - b) for b, d, i, k in _minima(z, g)]
    maxs = [Feature("max", i, k, -b, d - b) for b, d, i, k in _minima(-z, g)]
    return mins + maxs
