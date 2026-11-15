import { describe, expect, it } from 'vitest';
import { decodeGrid, displayGamma, errorField, ramp, sampleGrid } from './field';
import { ago, duration, int, num, pct } from './format';
import { createSseParser } from './sse';

describe('sse parser', () => {
  it('joins payloads split across chunks and ignores comments', () => {
    const feed = createSseParser();
    expect(feed('data: {"a":')).toEqual([]);
    expect(feed('1}\n\n: keep-alive\n\ndata: {"b":2}\n')).toEqual(['{"a":1}']);
    expect(feed('\n')).toEqual(['{"b":2}']);
  });
  it('handles CRLF line endings', () => {
    expect(createSseParser()('data: x\r\n\r\n')).toEqual(['x']);
  });
});

describe('field helpers', () => {
  it('decodes little-endian float32 grids', () => {
    const b64 = btoa(String.fromCharCode(...new Uint8Array(new Float32Array([1.5, -2, 0.25]).buffer)));
    expect(Array.from(decodeGrid(b64))).toEqual([1.5, -2, 0.25]);
  });
  it('keeps the ramp inside its colour range for any input', () => {
    for (const t of [-5, 0, 0.5, 1, 9, NaN]) {
      for (const c of ramp(t)) expect(c).toBeGreaterThanOrEqual(0), expect(c).toBeLessThanOrEqual(255);
    }
    expect(ramp(0)[2]).toBeGreaterThan(ramp(1)[2]);
  });
  it('picks a neutral gamma for a symmetric surface and a bounded one for a skewed surface', () => {
    expect(displayGamma(new Float32Array([0, 0.5, 1]), 0, 1)).toBeCloseTo(1, 5);
    const skew = displayGamma(new Float32Array([0, 0.001, 0.001, 0.002, 1]), 0, 1);
    expect(skew).toBeGreaterThanOrEqual(0.3);
    expect(skew).toBeLessThanOrEqual(3);
    expect(displayGamma(new Float32Array([2, 2]), 2, 2)).toBe(1);
  });
});

describe('surface sampling', () => {
  it('interpolates between nodes and clamps outside the square', () => {
    // grid 2: nodes (0,0)=0, (0,1)=1, (1,0)=2, (1,1)=3
    const z = new Float32Array([0, 1, 2, 3]);
    expect(sampleGrid(z, 2, 0, 0)).toBe(0);
    expect(sampleGrid(z, 2, 1, 1)).toBe(3);
    expect(sampleGrid(z, 2, 0.5, 0.5)).toBeCloseTo(1.5, 6);
    expect(sampleGrid(z, 2, 2, -1)).toBe(2);
  });
  it('scores errors from 0 to 1', () => {
    const e = errorField(new Float32Array([0, 0.25, 9]), new Float32Array([0, 0, 0]), 0, 1);
    expect(e[0]).toBe(0);
    expect(e[1]).toBeCloseTo(1, 6);
    expect(e[2]).toBe(1);
  });
});

describe('formatting', () => {
  it('formats durations, counts and relative times', () => {
    expect(duration(10033)).toBe('02:47:13');
    expect(duration(-4)).toBe('00:00:00');
    expect(int(12540)).toBe('12,540');
    expect(int(undefined)).toBe('–');
    const now = Date.parse('2026-11-14T12:00:00Z');
    expect(ago('2026-11-14T11:57:00Z', now)).toBe('3m ago');
    expect(ago('2026-11-14T09:00:00Z', now)).toBe('3h ago');
    expect(ago('2026-11-13T06:00:00Z', now)).toBe('yesterday');
  });
  it('formats shares and plain numbers', () => {
    expect(pct(0.0512, 2)).toBe('5.12%');
    expect(num(1234.5678)).toBe('1235');
    expect(num(0.00001234)).toBe('1.23e-5');
    expect(num(null)).toBe('–');
  });
});
