import type { AppBand, AppInput } from '../types';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 8.5 -> "08:30". 24 reads as "24:00" so the end of the range is still recognisable. */
export function hourLabel(h: number): string {
  const total = Math.round(Math.min(24, Math.max(0, h)) * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Day of year (1..365) -> "15 May". */
export function doyLabel(d: number): string {
  let day = Math.round(Math.min(365, Math.max(1, d)));
  for (let m = 0; m < 12; m++) {
    if (day <= MONTH_LEN[m]) return `${day} ${MONTHS[m]}`;
    day -= MONTH_LEN[m];
  }
  return '31 Dec';
}

/** 4 -> "Fri". Between two days reads "Thu–Fri"; within a quarter day of one, that day. */
export function weekdayLabel(d: number): string {
  const day = (i: number) => WEEKDAYS[Math.min(6, Math.max(0, i))];
  const i = Math.round(d);
  if (Math.abs(d - i) <= 0.25) return day(i);
  return `${day(Math.floor(d))}–${day(Math.floor(d) + 1)}`;
}

/** An input value the way a person would write it. */
export function inputLabel(input: AppInput, x: number): string {
  switch (input.fmt) {
    case 'hour':
      return hourLabel(x);
    case 'weekday':
      return weekdayLabel(x);
    case 'doy':
      return doyLabel(x);
    default:
      return `${Number(x.toFixed(input.step < 1 ? 1 : 0))}${input.unit ? ` ${input.unit}` : ''}`;
  }
}

/** Output values: one decimal under 100, whole numbers above. */
export function outLabel(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

/** The step of a "+1 unit" sensitivity, named for people: "+1 h", "+1 day", "+1 m/s". */
export function perUnit(input: AppInput): string {
  if (input.fmt === 'hour') return '+1 h';
  if (input.fmt === 'weekday' || input.fmt === 'doy') return '+1 day';
  return `+1 ${input.unit}`;
}

/** Where a value sits on the band scale (0..1): equal-width segments, one per band. The open ends borrow the width of their neighbour. */
export function bandPosition(bands: AppBand[], v: number): number {
  const n = bands.length;
  const edge = (i: number) => bands[i]?.upto ?? 0;
  for (let i = 0; i < n; i++) {
    const lo = i === 0 ? edge(0) - (edge(1) - edge(0)) : edge(i - 1);
    const hi = bands[i].upto ?? lo + (lo - (i >= 2 ? edge(i - 2) : 0));
    if (v <= hi || i === n - 1) return (i + (hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0)) / n;
  }
  return 1;
}

/** Parse "x1, x2, value[, kind]" lines. Blank lines and lines starting with # are skipped; a header row is allowed. */
export function parseCsv(text: string): { rows: { x1: number; x2: number; value: number; kind: 'sensor' | 'verified' }[]; errors: string[] } {
  const rows: { x1: number; x2: number; value: number; kind: 'sensor' | 'verified' }[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split(/[,;\t]/).map((p) => p.trim());
    const nums = parts.slice(0, 3).map(Number);
    if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) {
      if (i === 0 && /[a-z]/i.test(line)) return; // header
      errors.push(`line ${i + 1}: expected three numbers`);
      return;
    }
    const kind = (parts[3] ?? '').toLowerCase().startsWith('v') ? 'verified' : 'sensor';
    rows.push({ x1: nums[0], x2: nums[1], value: nums[2], kind });
  });
  return { rows, errors };
}

/** A standard normal draw (Box-Muller). */
export function gauss(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
