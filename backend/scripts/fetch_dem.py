"""Crop one Copernicus GLO-30 elevation tile into a real-data simulator file.

One-off, offline tool. The app never runs it; it only reads the ``.npz`` this writes.
It needs ``tifffile`` and ``imagecodecs`` (not app dependencies), so run it from a
throwaway environment:

    uv venv .dem && uv pip install --python .dem numpy tifffile imagecodecs
    curl -o tile.tif https://copernicus-dem-30m.s3.amazonaws.com/\
Copernicus_DSM_COG_10_N45_00_E007_00_DEM/Copernicus_DSM_COG_10_N45_00_E007_00_DEM.tif
    .dem/Scripts/python scripts/fetch_dem.py tile.tif app/data/real/matterhorn.npz \
        --lat 45.9763 --lon 7.6586 --cells 200 --stride 2

The output grid is stored south-to-north (row 0 is the southern edge) and west-to-east,
with the box given at pixel centres, so it plugs straight into ``Simulator.box``.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

ATTRIBUTION = (
    "Copernicus DEM GLO-30. © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, "
    "provided under COPERNICUS by the European Union and ESA; all rights reserved."
)


def read_tile(path: Path) -> tuple[np.ndarray, float, float, float, float]:
    """Return heights (north row first) and the lon/lat of the top-left pixel centre plus spacing."""
    import tifffile  # noqa: PLC0415 - optional tool dependency

    with tifffile.TiffFile(path) as tif:
        page = tif.pages[0]
        z = page.asarray().astype(np.float64)
        scale = page.tags["ModelPixelScaleTag"].value
        tie = page.tags["ModelTiepointTag"].value
        nodata = page.tags.get("GDAL_NODATA")
        raster_type = 1  # PixelIsArea unless the GeoKey says otherwise
        geo = tif.geotiff_metadata or {}
        if str(geo.get("GTRasterTypeGeoKey", "")).endswith("Point") or geo.get("GTRasterTypeGeoKey") == 2:
            raster_type = 2
    dx, dy = float(scale[0]), float(scale[1])
    i0, j0, lon0, lat0 = float(tie[0]), float(tie[1]), float(tie[3]), float(tie[4])
    lon0 -= i0 * dx
    lat0 += j0 * dy
    if raster_type == 1:  # tie point is the pixel's corner: move to its centre
        lon0 += dx / 2
        lat0 -= dy / 2
    if nodata is not None:
        bad = z == float(nodata.value)
        if bad.any():
            raise SystemExit(f"tile has {int(bad.sum())} no-data cells; pick another area")
    return z, lon0, lat0, dx, dy


def crop(
    z: np.ndarray, lon0: float, lat0: float, dx: float, dy: float, lat: float, lon: float, cells: int, stride: int
):
    col = round((lon - lon0) / dx)
    row = round((lat0 - lat) / dy)
    half = cells * stride // 2
    r0, c0 = row - half, col - half
    r1, c1 = r0 + cells * stride, c0 + cells * stride
    if r0 < 0 or c0 < 0 or r1 > z.shape[0] or c1 > z.shape[1]:
        raise SystemExit("crop window runs off the tile; move the centre or shrink it")
    sub = z[r0:r1:stride, c0:c1:stride][::-1]  # south row first
    west, east = lon0 + c0 * dx, lon0 + (c1 - stride) * dx
    north, south = lat0 - r0 * dy, lat0 - (r1 - stride) * dy
    return sub, (west, east, south, north)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tile", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--cells", type=int, default=200)
    ap.add_argument("--stride", type=int, default=1, help="keep every n-th source cell")
    ap.add_argument("--source", default="", help="tile file name or URL, recorded in the output")
    args = ap.parse_args()

    z, lon0, lat0, dx, dy = read_tile(args.tile)
    sub, box = crop(z, lon0, lat0, dx, dy, args.lat, args.lon, args.cells, args.stride)
    meta = {
        "dataset": "Copernicus DEM GLO-30",
        "source": args.source or args.tile.name,
        "attribution": ATTRIBUTION,
        "units": "metres above sea level (EGM2008)",
        "x": "longitude, degrees east",
        "y": "latitude, degrees north",
        "spacing_arcsec": [dx * 3600 * args.stride, dy * 3600 * args.stride],
        "centre": [args.lon, args.lat],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, z=sub.astype(np.float32), box=np.array(box), meta=json.dumps(meta))
    print(f"wrote {args.out}: {sub.shape[1]}x{sub.shape[0]} cells, box {tuple(round(b, 5) for b in box)}")
    print(f"height {sub.min():.0f} to {sub.max():.0f} m")


if __name__ == "__main__":
    main()
