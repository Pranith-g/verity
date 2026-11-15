"""Built-in simulators: cheap stand-ins for an expensive model.

Two separate groups, each a function of two inputs on a box:

* ``TEST_FUNCTIONS`` - the analytic textbook surfaces (Peaks, Himmelblau, ...).
* ``REAL_DATASETS`` - measured data on a grid, read from ``app/data/real/`` (see
  ``real_data.py``).

``SIMULATORS`` is both together, for code that just needs "a simulator by key". They exist
for the benchmark and for trying the service out; real studies bring their own simulator
through ask/tell.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

Array = np.ndarray


@dataclass(frozen=True)
class Simulator:
    key: str
    name: str
    note: str
    box: tuple[float, float, float, float]  # x1 low, x1 high, x2 low, x2 high
    fn: Callable[[Array, Array], Array]
    kind: str = "test"  # "test" (analytic function) or "real" (measured data)
    inputs: tuple[str, str] = ("x1", "x2")
    output: str = "output"
    source: str = ""  # where real data came from, with its required attribution

    def at_unit(self, uv: Array) -> Array:
        """Evaluate at points given on the unit square, shape (n, 2)."""
        uv = np.atleast_2d(np.asarray(uv, dtype=float))
        x = self.box[0] + uv[:, 0] * (self.box[1] - self.box[0])
        y = self.box[2] + uv[:, 1] * (self.box[3] - self.box[2])
        return np.asarray(self.fn(x, y), dtype=float)

    def at(self, x1: float, x2: float) -> float:
        return float(self.fn(np.array([x1], dtype=float), np.array([x2], dtype=float))[0])


def _peaks(x: Array, y: Array) -> Array:
    return (
        3 * (1 - x) ** 2 * np.exp(-(x**2) - (y + 1) ** 2)
        - 10 * (x / 5 - x**3 - y**5) * np.exp(-(x**2) - y**2)
        - np.exp(-((x + 1) ** 2) - y**2) / 3
    )


def _camel(x: Array, y: Array) -> Array:
    return (4 - 2.1 * x**2 + x**4 / 3) * x**2 + x * y + (-4 + 4 * y**2) * y**2


def _himmelblau(x: Array, y: Array) -> Array:
    return (x**2 + y - 11) ** 2 + (x + y**2 - 7) ** 2


def _rastrigin(x: Array, y: Array) -> Array:
    return 20 + x**2 - 10 * np.cos(2 * np.pi * x) + y**2 - 10 * np.cos(2 * np.pi * y)


def _easom(x: Array, y: Array) -> Array:
    return -np.cos(x) * np.cos(y) * np.exp(-((x - np.pi) ** 2) - (y - np.pi) ** 2)


def _michalewicz(x: Array, y: Array) -> Array:
    return -np.sin(x) * np.sin(x**2 / np.pi) ** 20 - np.sin(y) * np.sin(2 * y**2 / np.pi) ** 20


def _rosenbrock(x: Array, y: Array) -> Array:
    return 100 * (y - x**2) ** 2 + (1 - x) ** 2


_PI = float(np.pi)

TEST_FUNCTIONS: dict[str, Simulator] = {
    s.key: s
    for s in [
        Simulator("peaks", "Peaks", "Three hills, three hollows. A friendly start.", (-3, 3, -3, 3), _peaks),
        Simulator("camel", "Six-hump camel", "Six valleys, two of them equally deep.", (-2, 2, -1.1, 1.1), _camel),
        Simulator(
            "himmelblau", "Himmelblau", "Four identical minima around one central bump.", (-5, 5, -5, 5), _himmelblau
        ),
        Simulator(
            "rosenbrock",
            "Rosenbrock",
            "One minimum hidden in a curved, nearly flat valley.",
            (-2, 2, -1, 3),
            _rosenbrock,
        ),
        Simulator(
            "easom",
            "Easom",
            "Flat everywhere except one narrow well. Easy to miss.",
            (_PI - 5, _PI + 5, _PI - 5, _PI + 5),
            _easom,
        ),
        Simulator(
            "rastrigin",
            "Rastrigin",
            "An egg-box: nine valleys and sixteen peaks to find.",
            (-1.75, 1.75, -1.75, 1.75),
            _rastrigin,
        ),
        Simulator(
            "michalewicz",
            "Michalewicz",
            "Long thin channels. The original paper's hardest case.",
            (0, _PI, 0, _PI),
            _michalewicz,
        ),
    ]
}

# Imported last: real_data needs the Simulator class defined above.
from .real_data import REAL_DATASETS  # noqa: E402

SIMULATORS: dict[str, Simulator] = {**TEST_FUNCTIONS, **REAL_DATASETS}
