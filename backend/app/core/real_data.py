"""Real-data simulators: measured values on a regular grid, kept apart from the test functions.

Each dataset is one ``.npz`` file in ``app/data/real/`` holding ``z`` (rows south to north,
columns west to east), ``box`` (x low, x high, y low, y high, at the outer cell centres) and
``meta`` (a JSON string with the source and attribution). Between grid cells the value is
read by bilinear interpolation, so the learner can ask for any point inside the box, just
as it would of a live simulator.

To add one: write the ``.npz`` (``scripts/fetch_dem.py`` does this for elevation tiles) and
add a line to ``_CATALOGUE``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .simulators import Simulator

Array = np.ndarray
DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "real"


@dataclass(frozen=True)
class GridSurface:
    """Bilinear lookup into a regular grid. Points outside the box take the nearest edge value."""

    z: Array  # (ny, nx)
    box: tuple[float, float, float, float]

    def __call__(self, x: Array, y: Array) -> Array:
        ny, nx = self.z.shape
        fx = np.clip((np.asarray(x, float) - self.box[0]) / (self.box[1] - self.box[0]), 0.0, 1.0) * (nx - 1)
        fy = np.clip((np.asarray(y, float) - self.box[2]) / (self.box[3] - self.box[2]), 0.0, 1.0) * (ny - 1)
        i = np.minimum(fx.astype(int), nx - 2)
        j = np.minimum(fy.astype(int), ny - 2)
        tx, ty = fx - i, fy - j
        z = self.z
        return (
            z[j, i] * (1 - tx) * (1 - ty)
            + z[j, i + 1] * tx * (1 - ty)
            + z[j + 1, i] * (1 - tx) * ty
            + z[j + 1, i + 1] * tx * ty
        )


def load(path: Path, key: str, name: str, note: str, inputs: tuple[str, str], output: str) -> Simulator:
    with np.load(path, allow_pickle=False) as f:
        z = np.asarray(f["z"], dtype=float)
        box = tuple(float(b) for b in f["box"])
        meta = json.loads(str(f["meta"]))
    if z.ndim != 2 or min(z.shape) < 50 or not np.isfinite(z).all():
        raise ValueError(f"{path.name}: need a finite grid of at least 50x50 cells")
    surface = GridSurface(z, box)  # type: ignore[arg-type]
    source = f"{meta.get('dataset', '')}. {meta.get('attribution', '')}".strip(". ")
    return Simulator(key, name, note, box, surface, kind="real", inputs=inputs, output=output, source=source)  # type: ignore[arg-type]


# key, file, name, note, inputs, output
_CATALOGUE = [
    (
        "terrain-matterhorn",
        "matterhorn.npz",
        "Real terrain: Matterhorn",
        "Ground height around the Matterhorn and Theodul Pass, 200x200 cells of a Copernicus 30 m "
        "elevation tile. Summits, ridges, glacier valleys and passes, with real measurement roughness.",
        ("longitude", "latitude"),
        "elevation_m",
    ),
]


def _load_all() -> dict[str, Simulator]:
    out: dict[str, Simulator] = {}
    for key, file, name, note, inputs, output in _CATALOGUE:
        path = DATA_DIR / file
        if path.exists():  # a slim install without the data files still starts
            out[key] = load(path, key, name, note, inputs, output)
    return out


REAL_DATASETS: dict[str, Simulator] = _load_all()
