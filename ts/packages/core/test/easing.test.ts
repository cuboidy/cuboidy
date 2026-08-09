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

// SPEC §6.7 calls the preset formulas a conformance requirement, and the
// port's runtime parity is numeric — so a wrong C1..C5, a wrong `outBounce`
// threshold, or an algebraically-equivalent rewrite has to be caught here.
// Endpoints were pinned for all twenty presets; interior values were pinned
// for four, so twelve presets could have been wrong and still passed.
//
// Values are exact doubles as produced by the formulas in easing.ts. A
// second implementation reproduces them by using the SAME expressions in the
// same order, not by matching to a tolerance.
// 0.05 and 0.95 are not decoration. `outBounce` is four parabolas, and
// 0.25 / 0.5 / 0.75 reach only the first three of them from either side: with
// the last threshold moved from 2.5/2.75 to 2.4/2.75, every value pinned on
// three points was unchanged, so a wrong bounce constant passed. The two
// outer points reach branch 4 in both directions — see the branch map below.
//
// Every number here was cross-checked against an independent transcription
// of the easings.net formulas: all 20 presets agree bit for bit at all five
// points. So this table is the formulas, not a snapshot of the code.
const US = [0.05, 0.25, 0.5, 0.75, 0.95] as const;
type Row = readonly [number, number, number, number, number];

const INTERIOR: ReadonlyArray<readonly [string, Row]> = [
  ['linear', [0.05, 0.25, 0.5, 0.75, 0.95]],
  ['step', [0, 0, 0, 0, 0]],
  ['in-sine', [0.003082666266872036, 0.07612046748871326, 0.2928932188134524, 0.6173165676349102, 0.921540904272155]],
  ['out-sine', [0.07845909572784494, 0.3826834323650898, 0.7071067811865475, 0.9238795325112867, 0.996917333733128]],
  ['in-out-sine', [0.006155829702431115, 0.1464466094067262, 0.49999999999999994, 0.8535533905932737, 0.9938441702975689]],
  ['in-quad', [0.0025000000000000005, 0.0625, 0.25, 0.5625, 0.9025]],
  ['out-quad', [0.09750000000000003, 0.4375, 0.75, 0.9375, 0.9974999999999999]],
  ['in-out-quad', [0.005000000000000001, 0.125, 0.5, 0.875, 0.995]],
  ['in-cubic', [0.00012500000000000003, 0.015625, 0.125, 0.421875, 0.8573749999999999]],
  ['out-cubic', [0.1426250000000001, 0.578125, 0.875, 0.984375, 0.999875]],
  ['in-out-cubic', [0.0005000000000000001, 0.0625, 0.5, 0.9375, 0.9994999999999999]],
  ['in-back', [-0.003916252500000001, -0.06413656250000001, -0.08769750000000004, 0.18259031249999969, 0.7805912024999997]],
  ['out-back', [0.21940879750000053, 0.8174096875000002, 1.0876975, 1.0641365625, 1.0039162525]],
  ['in-out-back', [-0.011177092750000001, -0.09968184375, 0.5, 1.09968184375, 1.0111770927500001]],
  ['in-elastic', [0.0006905339660024923, -0.005524271728019902, -0.015625000000000045, 0.08838834764831831, 0.35355339059327395]],
  ['out-elastic', [0.6464466094067263, 0.9116116523516816, 1.015625, 1.00552427172802, 0.9993094660339975]],
  ['in-out-elastic', [0.0009765625, 0.011969444423734044, 0.5, 0.988030555576266, 0.9990234375]],
  ['in-bounce', [0.015468750000000031, 0.02734375, 0.234375, 0.52734375, 0.98109375]],
  ['out-bounce', [0.018906250000000003, 0.47265625, 0.765625, 0.97265625, 0.98453125]],
  ['in-out-bounce', [0.00593750000000004, 0.1171875, 0.5, 0.8828125, 0.9940624999999998]],
];

describe('easing — interior values', () => {
  it('covers every preset exactly once', () => {
    expect(INTERIOR.map(([n]) => n).sort()).toEqual([...EASING_NAMES].sort());
  });

  it.each(INTERIOR)(`%s matches its formula at ${US.join(' / ')}`, (name, want) => {
    const got = US.map((u) =>
      applyEasing(name as (typeof EASING_NAMES)[number], u),
    );
    expect(got).toEqual([...want]);
  });

  // The sample points have to reach every branch of the one piecewise
  // preset, or a wrong constant hides in the branch nobody looks at.
  it('reaches all four bounce branches, from both directions', () => {
    const branch = (x: number): number =>
      x < 1 / 2.75 ? 1 : x < 2 / 2.75 ? 2 : x < 2.5 / 2.75 ? 3 : 4;
    // out-bounce(u) reads u; in-bounce(u) reads 1 − u.
    expect(new Set(US.map((u) => branch(u)))).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(US.map((u) => branch(1 - u)))).toEqual(new Set([1, 2, 3, 4]));
  });
});

// SPEC §6.7: "every preset maps 0 → 0 and 1 → 1, so keyed values are always
// hit exactly at their keyframes". The formulas do not deliver that on their
// own — five presets miss, one of them returning -0 — so applyEasing clamps.
describe('easing — endpoints are exact', () => {
  it.each(EASING_NAMES)('%s hits 0 and 1 exactly', (name) => {
    expect(Object.is(applyEasing(name, 0), 0)).toBe(true);
    expect(Object.is(applyEasing(name, 1), 1)).toBe(true);
  });
});
