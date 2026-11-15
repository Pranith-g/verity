export const pct = (x: number, digits = 1): string => `${(100 * x).toFixed(digits)}%`;

/** A number with about four significant digits, without exponent noise for everyday magnitudes. */
export function num(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '–';
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return x.toExponential(2);
  return String(Number(x.toPrecision(4)));
}

export function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Whole numbers with thousands separators. */
export const int = (x: number | null | undefined): string => (x == null || !Number.isFinite(x) ? '–' : Math.round(x).toLocaleString('en-US'));

/** Seconds as HH:MM:SS, the way an instrument shows elapsed time. Days roll into the hours. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** "3m ago", "yesterday", "12 Nov": short relative time for lists. */
export function ago(iso: string, now = Date.now()): string {
  const d = new Date(iso).getTime();
  const m = Math.round((now - d) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  if (h < 48) return 'yesterday';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
