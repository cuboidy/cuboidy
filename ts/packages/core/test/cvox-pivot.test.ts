import { describe, expect, it } from 'vitest';
import { parsePivot } from '../src/cvox/pivot.js';

describe('parsePivot', () => {
  it('parses integer coords', () => {
    const r = parsePivot(['1', '0', '1']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ x: 1, y: 0, z: 1 });
  });

  it('parses fractional coords', () => {
    const r = parsePivot(['1.5', '0', '1.5']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ x: 1.5, y: 0, z: 1.5 });
  });

  it('accepts negative coords (warning is a lint concern, not parse error)', () => {
    const r = parsePivot(['-1', '0', '1']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ x: -1, y: 0, z: 1 });
  });

  it('E05: rejects too few args', () => {
    const r = parsePivot(['1', '0']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E05');
  });

  it('E05: rejects too many args', () => {
    const r = parsePivot(['1', '0', '1', '0']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E05');
  });

  it('E05: rejects non-numeric coord', () => {
    const r = parsePivot(['abc', '0', '1']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E05');
  });
});
