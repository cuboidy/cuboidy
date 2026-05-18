import { describe, expect, it } from 'vitest';
import { parsePivot } from '../src/cvox/pivot.js';

describe('parsePivot', () => {
  it('parses integer coords (pos only)', () => {
    const r = parsePivot(['1', '0', '1']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pos).toEqual({ x: 1, y: 0, z: 1 });
      expect(r.value.rot).toBeUndefined();
    }
  });

  it('parses fractional coords (pos only)', () => {
    const r = parsePivot(['1.5', '0', '1.5']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pos).toEqual({ x: 1.5, y: 0, z: 1.5 });
  });

  it('accepts negative coords (warning is a lint concern, not parse error)', () => {
    const r = parsePivot(['-1', '0', '1']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pos).toEqual({ x: -1, y: 0, z: 1 });
  });

  it('parses pivot with rotation (7 args)', () => {
    const r = parsePivot(['1', '0', '1', 'rot', '0', '90', '0']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pos).toEqual({ x: 1, y: 0, z: 1 });
      expect(r.value.rot).toEqual({ x: 0, y: 90, z: 0 });
    }
  });

  it('E05: rejects 4 args (neither 3 nor 7)', () => {
    const r = parsePivot(['1', '0', '1', 'rot']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it("E05: rejects 7 args without 'rot' marker", () => {
    const r = parsePivot(['1', '0', '1', 'foo', '0', '90', '0']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E05: rejects too few args', () => {
    const r = parsePivot(['1', '0']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E05: rejects too many args', () => {
    const r = parsePivot(['1', '0', '1', '0']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E05: rejects non-numeric coord', () => {
    const r = parsePivot(['abc', '0', '1']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});
