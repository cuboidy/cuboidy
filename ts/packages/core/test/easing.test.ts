import { describe, expect, it } from 'vitest';
import { EASING_NAMES, applyEasing } from '../src/easing.js';

describe('applyEasing — endpoint exactness', () => {
  // SPEC §6.7: every preset maps 0→0 and 1→1 so keyed values are hit
  // exactly at their keyframes. (For `step`, u=1 is the arriving keyframe.)
  it.each(EASING_NAMES)('%s maps 0→0 and 1→1', (name) => {
    expect(applyEasing(name, 0)).toBeCloseTo(0, 9);
    expect(applyEasing(name, 1)).toBeCloseTo(1, 9);
  });
});

describe('applyEasing — known midpoints', () => {
  it('linear is the identity', () => {
    expect(applyEasing('linear', 0.25)).toBeCloseTo(0.25, 9);
    expect(applyEasing('linear', 0.75)).toBeCloseTo(0.75, 9);
  });

  it('step holds 0 across the whole open interval', () => {
    expect(applyEasing('step', 0.001)).toBe(0);
    expect(applyEasing('step', 0.999)).toBe(0);
  });

  it('in-quad is u² (slow start)', () => {
    expect(applyEasing('in-quad', 0.5)).toBeCloseTo(0.25, 9);
  });

  it('out-quad is 1-(1-u)² (fast start)', () => {
    expect(applyEasing('out-quad', 0.5)).toBeCloseTo(0.75, 9);
  });

  it('symmetric in-out variants pass through (0.5, 0.5)', () => {
    for (const name of [
      'in-out-sine',
      'in-out-quad',
      'in-out-cubic',
      'in-out-back',
      'in-out-elastic',
      'in-out-bounce',
    ] as const) {
      expect(applyEasing(name, 0.5)).toBeCloseTo(0.5, 6);
    }
  });
});

describe('applyEasing — overshoot families', () => {
  it('in-back dips below 0 early', () => {
    expect(applyEasing('in-back', 0.2)).toBeLessThan(0);
  });

  it('out-back overshoots past 1 late', () => {
    expect(applyEasing('out-back', 0.8)).toBeGreaterThan(1);
  });

  it('out-elastic oscillates above and below 1', () => {
    expect(applyEasing('out-elastic', 0.15)).toBeGreaterThan(1);
    expect(applyEasing('out-elastic', 0.35)).toBeLessThan(1);
  });

  it('out-bounce stays within [0,1] and bounces', () => {
    for (const u of [0.1, 0.3, 0.5, 0.7, 0.75, 0.9]) {
      const v = applyEasing('out-bounce', u);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Local dip after the first bounce lands (~u=0.727).
    expect(applyEasing('out-bounce', 0.76)).toBeLessThan(1);
  });
});
