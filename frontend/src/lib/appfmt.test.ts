import { describe, expect, it } from 'vitest';
import type { AppBand } from '../types';
import { bandPosition, doyLabel, hourLabel, inputLabel, parseCsv, weekdayLabel } from './appfmt';

const band = (upto: number | null, label: string): AppBand => ({ upto, label, color: '#fff', advice: '' });

describe('application formatting', () => {
  it('writes hours, days of year and weekdays the way people do', () => {
    expect(hourLabel(8.5)).toBe('08:30');
    expect(hourLabel(24)).toBe('24:00');
    expect(doyLabel(1)).toBe('1 Jan');
    expect(doyLabel(135)).toBe('15 May');
    expect(doyLabel(365)).toBe('31 Dec');
    expect(weekdayLabel(4)).toBe('Fri');
    expect(weekdayLabel(3.9)).toBe('Fri');
    expect(weekdayLabel(3.5)).toBe('Thu–Fri');
    expect(inputLabel({ key: 'wind', label: 'Wind', unit: 'm/s', low: 0.5, high: 12, step: 0.1, fmt: 'number' }, 3.25)).toBe('3.3 m/s');
  });

  it('places values on the band scale in equal segments', () => {
    const bands = [band(30, 'Good'), band(60, 'Fair'), band(null, 'Bad')];
    expect(bandPosition(bands, 0)).toBe(0);
    expect(bandPosition(bands, 30)).toBeCloseTo(1 / 3);
    expect(bandPosition(bands, 45)).toBeCloseTo(0.5);
    expect(bandPosition(bands, 1e6)).toBe(1);
  });

  it('parses pasted readings, skipping a header, comments and blank lines', () => {
    const { rows, errors } = parseCsv('hour,wind,pm25\n# note\n\n8.5, 1, 118\n14;8;22;verified\nbad line');
    expect(rows).toEqual([
      { x1: 8.5, x2: 1, value: 118, kind: 'sensor' },
      { x1: 14, x2: 8, value: 22, kind: 'verified' },
    ]);
    expect(errors).toEqual(['line 6: expected three numbers']);
  });
});
