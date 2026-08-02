import { describe, expect, it } from 'vitest';
import { clampToClip } from '../src/lib/clip.js';

// SPEC §6.7: a looping clip wraps, a non-looping one holds its last
// frame. The scene clock is monotonic — one clock for every actor — so
// whatever shows a position in a clip applies the rule itself.
describe('clampToClip', () => {
  it('wraps a looping clip', () => {
    expect(clampToClip(2.5, 2, true)).toBeCloseTo(0.5, 6);
    expect(clampToClip(4, 2, true)).toBeCloseTo(0, 6);
  });

  it('holds the end of a non-looping clip', () => {
    expect(clampToClip(3, 2, false)).toBe(2);
  });

  it('never reports a negative position', () => {
    expect(clampToClip(-0.5, 2, true)).toBeCloseTo(1.5, 6);
    expect(clampToClip(-0.5, 2, false)).toBe(0);
  });

  it('survives a zero-length clip instead of dividing by it', () => {
    expect(clampToClip(1, 0, true)).toBe(0);
  });
});
