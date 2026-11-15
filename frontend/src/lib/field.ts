/** Decoding, sampling and colouring of gridded surfaces. Node i = a*grid + b sits at (a, b)/(grid-1) on the unit square. */

export type Rgb = [number, number, number];

export function decodeGrid(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/** Output ramp, low to high: deep blue, cyan, green, amber, hot red. Reads like a CFD field on a dark bench. */
const OUTPUT: [number, Rgb][] = [
  [0.0, [14, 26, 96]],
  [0.16, [30, 74, 255]],
  [0.34, [0, 196, 255]],
  [0.52, [25, 232, 150]],
  [0.68, [196, 240, 60]],
  [0.84, [255, 168, 32]],
  [1.0, [255, 52, 72]],
];

/** Error ramp, none to large: near-black, violet, magenta, orange, white-hot. */
const ERROR: [number, Rgb][] = [
  [0.0, [10, 14, 30]],
  [0.25, [72, 30, 150]],
  [0.5, [200, 40, 180]],
  [0.75, [255, 120, 60]],
  [1.0, [255, 240, 200]],
];

function sample(stops: [number, Rgb][], t: number): Rgb {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  let i = 1;
  while (i < stops.length - 1 && stops[i][0] < x) i++;
  const [t0, a] = stops[i - 1];
  const [t1, b] = stops[i];
  const f = t1 > t0 ? (x - t0) / (t1 - t0) : 0;
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
}

/** Colour (0..255) for a value already scaled to 0..1. */
export function ramp(t: number, gamma = 1): Rgb {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return sample(OUTPUT, Math.pow(x, gamma));
}

export function errorRamp(t: number): Rgb {
  return sample(ERROR, t);
}

export const OUTPUT_GRADIENT = `linear-gradient(to top, ${OUTPUT.map(([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`).join(', ')})`;
export const ERROR_GRADIENT = `linear-gradient(to top, ${ERROR.map(([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`).join(', ')})`;

/** Exponent that puts the median of the surface in the middle of the colour scale. Display only. */
export function displayGamma(z: Float32Array, lo: number, hi: number): number {
  if (!(hi > lo)) return 1;
  const sorted = Float32Array.from(z).sort();
  const med = (sorted[sorted.length >> 1] - lo) / (hi - lo);
  const g = Math.log(0.5) / Math.log(Math.min(0.98, Math.max(0.02, med)));
  return Math.min(3, Math.max(0.3, g));
}

/** Bilinear value of a gridded surface at (u, v) on the unit square. */
export function sampleGrid(z: Float32Array, grid: number, u: number, v: number): number {
  const ga = Math.min(1, Math.max(0, u)) * (grid - 1);
  const gb = Math.min(1, Math.max(0, v)) * (grid - 1);
  const a0 = Math.min(grid - 2, Math.floor(ga));
  const b0 = Math.min(grid - 2, Math.floor(gb));
  const fa = ga - a0;
  const fb = gb - b0;
  return (
    z[a0 * grid + b0] * (1 - fa) * (1 - fb) +
    z[(a0 + 1) * grid + b0] * fa * (1 - fb) +
    z[a0 * grid + b0 + 1] * (1 - fa) * fb +
    z[(a0 + 1) * grid + b0 + 1] * fa * fb
  );
}

/** |learned - real| as a share of the real range, squashed to 0..1 so small errors stay visible. */
export function errorField(learned: Float32Array, real: Float32Array, lo: number, hi: number): Float32Array {
  const span = hi > lo ? hi - lo : 1;
  const out = new Float32Array(real.length);
  for (let i = 0; i < real.length; i++) out[i] = Math.min(1, Math.sqrt(Math.abs(learned[i] - real[i]) / span / 0.25));
  return out;
}
