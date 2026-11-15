"""Thin-plate-spline surrogate on the unit square."""

from __future__ import annotations

import numpy as np

Array = np.ndarray


def _phi(r2: Array) -> Array:
    """Thin-plate kernel r^2 log r, written in terms of r^2."""
    out = np.zeros_like(r2)
    mask = r2 > 0
    out[mask] = 0.5 * r2[mask] * np.log(r2[mask])
    return out


def _sqdist(a: Array, b: Array) -> Array:
    d = a[:, None, :] - b[None, :, :]
    return np.einsum("ijk,ijk->ij", d, d)


class ThinPlate:
    """Interpolating thin-plate spline through (points, values).

    The fit is exact at the training points, which is what lets a sample placed on a
    feature count as a check of that feature.
    """

    def __init__(self, points: Array, values: Array) -> None:
        points = np.asarray(points, dtype=float)
        values = np.asarray(values, dtype=float)
        if points.ndim != 2 or points.shape[1] != 2:
            raise ValueError("points must have shape (n, 2)")
        if len(points) != len(values):
            raise ValueError("points and values must have the same length")
        if len(points) < 3:
            raise ValueError("a thin-plate spline needs at least 3 points")
        n = len(values)
        a = np.zeros((n + 3, n + 3))
        a[:n, :n] = _phi(_sqdist(points, points))
        a[:n, n] = 1.0
        a[:n, n + 1 :] = points
        a[n, :n] = 1.0
        a[n + 1 :, :n] = points.T
        rhs = np.concatenate([values, np.zeros(3)])
        try:
            weights = np.linalg.solve(a, rhs)
        except np.linalg.LinAlgError:
            weights = np.linalg.lstsq(a, rhs, rcond=None)[0]
        self._points = points
        self._w = weights
        self._n = n

    def __call__(self, query: Array) -> Array:
        query = np.atleast_2d(np.asarray(query, dtype=float))
        k = _phi(_sqdist(query, self._points))
        return k @ self._w[: self._n] + self._w[self._n] + query @ self._w[self._n + 1 :]


def grid_points(g: int) -> Array:
    """All nodes of a g-by-g grid on the unit square. Node i = a*g + b sits at (a, b)/(g-1)."""
    t = np.linspace(0.0, 1.0, g)
    a, b = np.meshgrid(t, t, indexing="ij")
    return np.column_stack([a.ravel(), b.ravel()])
