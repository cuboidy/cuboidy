import { describe, expect, it } from 'vitest';
import {
  clampToClip,
  isInlineAnimation,
  sampleAnimation,
  samplePart,
  sampleTimes,
  type AnimationTrack,
} from '../src/animation.js';
import { parseManifest } from '../src/manifest.js';
import { readFixtureJson } from './helpers/fixtures.js';
import { RIGGED } from './helpers/corpus.js';

// A tail-wag style track: only `rot` ever specified, so pos/scale/visible
// stay at their §6.5 defaults via carryover.
const TAIL: AnimationTrack = {
  '0.0': { rot: [0, 0, 0] },
  '0.5': { rot: [0, 25, 0] },
  '1.0': { rot: [0, 0, 0] },
};

describe('samplePart — interpolation', () => {
  it('returns the first keyframe exactly at t=0', () => {
    const p = samplePart(TAIL, 0, 1.0, true);
    expect(p.rot).toEqual([0, 0, 0]);
  });

  it('linearly interpolates rot at the segment midpoint', () => {
    // Halfway between 0.0 (y=0) and 0.5 (y=25) → y=12.5.
    const p = samplePart(TAIL, 0.25, 1.0, true);
    expect(p.rot[1]).toBeCloseTo(12.5, 6);
  });

  it('hits the keyed value exactly at an interior key', () => {
    const p = samplePart(TAIL, 0.5, 1.0, true);
    expect(p.rot[1]).toBeCloseTo(25, 6);
  });

  it('carries over unspecified fields (pos/scale/visible stay at defaults)', () => {
    const p = samplePart(TAIL, 0.3, 1.0, true);
    expect(p.pos).toEqual([0, 0, 0]);
    expect(p.scale).toEqual([1, 1, 1]);
    expect(p.visible).toBe(true);
  });
});

describe('samplePart — carryover of explicit values', () => {
  const track: AnimationTrack = {
    '0.0': { pos: [0, 0, 0], scale: [1, 1, 1] },
    '1.0': { pos: [0, 2, 0] }, // scale omitted → carries [1,1,1]
    '2.0': { scale: [2, 2, 2] }, // pos omitted → carries [0,2,0]
  };

  it('interpolates pos toward the next key while carried scale stays constant', () => {
    const p = samplePart(track, 0.5, 2.0, false);
    expect(p.pos[1]).toBeCloseTo(1, 6);
    expect(p.scale).toEqual([1, 1, 1]);
  });

  it('uses the carried-forward pos as the start of the next segment', () => {
    // Between 1.0 (pos [0,2,0], scale carried [1,1,1]) and 2.0 (scale
    // [2,2,2], pos carried [0,2,0]): pos constant at [0,2,0]; scale lerps.
    const p = samplePart(track, 1.5, 2.0, false);
    expect(p.pos).toEqual([0, 2, 0]);
    expect(p.scale[0]).toBeCloseTo(1.5, 6);
  });
});

describe('samplePart — visible steps (SPEC §6.7)', () => {
  const track: AnimationTrack = {
    '0.0': { visible: true },
    '1.0': { visible: false },
  };

  it('holds the earlier value across the open interval', () => {
    expect(samplePart(track, 0.999, 1.0, false).visible).toBe(true);
  });

  it('switches exactly at the later keyframe time', () => {
    expect(samplePart(track, 1.0, 1.0, false).visible).toBe(false);
  });
});

describe('samplePart — loop wrap (SPEC §6.7)', () => {
  // Last key (1.0) sits below duration (2.0): the tail interval interpolates
  // back toward the "0.0" keyframe across [1.0, 2.0].
  const track: AnimationTrack = {
    '0.0': { rot: [0, 0, 0] },
    '1.0': { rot: [0, 40, 0] },
  };

  it('interpolates toward the 0.0 key in the wrap interval', () => {
    // Midway through [1.0, 2.0]: halfway from 40 back to 0 → 20.
    const p = samplePart(track, 1.5, 2.0, true);
    expect(p.rot[1]).toBeCloseTo(20, 6);
  });

  it('wraps modulo duration', () => {
    const a = samplePart(track, 0.5, 2.0, true);
    const b = samplePart(track, 2.5, 2.0, true); // 2.5 % 2.0 = 0.5
    expect(b.rot[1]).toBeCloseTo(a.rot[1], 6);
  });

  it('clamps (no wrap) when loop is false', () => {
    const p = samplePart(track, 5.0, 2.0, false);
    expect(p.rot[1]).toBeCloseTo(40, 6); // held at last key
  });
});

describe('sampleAnimation — a real manifest clip', () => {
  it('samples all animated parts of the corpus idle clip', async () => {
    const json = await readFixtureJson(`${RIGGED}/cuboidy.json`);
    const r = parseManifest(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const idle = r.value.animations?.['idle'];
    expect(idle).toBeDefined();
    if (idle === undefined || !isInlineAnimation(idle)) return;

    // At t=0.5 the tail sits exactly on its keyed peak (y=14). The head is
    // halfway through its 0.0→1.0 segment (y 0→8) → y=4: the `in-out-sine`
    // on the 1.0 keyframe shapes the segment LEAVING it, not this one.
    const poses = sampleAnimation(idle, 0.5);
    expect(poses.get('tail')?.rot[1]).toBeCloseTo(14, 6);
    expect(poses.get('head')?.rot[1]).toBeCloseTo(4, 6);

    // Parts the animation does not target are simply absent.
    expect(poses.has('body')).toBe(false);
  });
});

describe('samplePart — degenerate tracks', () => {
  it('returns the rest pose for an empty track', () => {
    const p = samplePart({}, 1.0, 2.0, true);
    expect(p).toEqual({
      rot: [0, 0, 0],
      pos: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
    });
  });

  it('holds a single-keyframe track at its value everywhere', () => {
    const track: AnimationTrack = { '0.0': { rot: [10, 0, 0] } };
    expect(samplePart(track, 0, 2.0, true).rot[0]).toBeCloseTo(10, 6);
    expect(samplePart(track, 1.7, 2.0, true).rot[0]).toBeCloseTo(10, 6);
  });
});

describe('animation schema — parses real manifests with animations', () => {
  it('validates a two-animation manifest through parseManifest', async () => {
    const json = await readFixtureJson(`${RIGGED}/cuboidy.json`);
    const r = parseManifest(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const anims = r.value.animations ?? {};
    expect(Object.keys(anims).length).toBeGreaterThanOrEqual(2);
  });
});

describe('samplePart — easing (SPEC §6.7)', () => {
  it('shapes the segment by the OUTGOING key’s ease for that attribute', () => {
    const track: AnimationTrack = {
      '0.0': { rot: [0, 0, 0], ease: { rot: 'in-quad' } },
      '1.0': { rot: [0, 40, 0] },
    };
    // u=0.5 → in-quad 0.25 → y = 40·0.25.
    const p = samplePart(track, 0.5, 1.0, false);
    expect(p.rot[1]).toBeCloseTo(10, 6);
  });

  it('eases each attribute independently across the same segment', () => {
    const track: AnimationTrack = {
      '0.0': { rot: [0, 0, 0], pos: [0, 0, 0], ease: { rot: 'in-quad' } },
      '1.0': { rot: [0, 40, 0], pos: [0, 4, 0] },
    };
    const p = samplePart(track, 0.5, 1.0, false);
    expect(p.rot[1]).toBeCloseTo(10, 6); // in-quad
    expect(p.pos[1]).toBeCloseTo(2, 6); // linear — untouched by rot's ease
  });

  it('never propagates ease to later keyframes (no carryover)', () => {
    const track: AnimationTrack = {
      '0.0': { pos: [0, 0, 0], ease: { pos: 'in-quad' } },
      '1.0': { pos: [0, 4, 0] },
      '2.0': { pos: [0, 8, 0] },
    };
    // Segment [0,1] eased: u=0.5 → 0.25 → y = 1.
    expect(samplePart(track, 0.5, 2.0, false).pos[1]).toBeCloseTo(1, 6);
    // Segment [1,2] is plain linear — 1.0 carries no ease of its own.
    expect(samplePart(track, 1.5, 2.0, false).pos[1]).toBeCloseTo(6, 6);
  });

  it('still hits keyed values exactly at their keyframes', () => {
    const track: AnimationTrack = {
      '0.0': { rot: [0, 0, 0], ease: { rot: 'out-elastic' } },
      '1.0': { rot: [0, 40, 0] },
    };
    expect(samplePart(track, 0, 1.0, false).rot[1]).toBeCloseTo(0, 6);
    expect(samplePart(track, 1.0, 1.0, false).rot[1]).toBeCloseTo(40, 6);
  });

  it('applies the last key’s ease to the loop wrap interval', () => {
    const track: AnimationTrack = {
      '0.0': { rot: [0, 0, 0] },
      '1.0': { rot: [0, 40, 0], ease: { rot: 'in-quad' } },
    };
    // Wrap [1.0, 2.0] toward the "0.0" key: u=0.5 → 0.25 → 40 → 30.
    const p = samplePart(track, 1.5, 2.0, true);
    expect(p.rot[1]).toBeCloseTo(30, 6);
  });

  it('step ease holds the outgoing value across the open interval', () => {
    const track: AnimationTrack = {
      '0.0': { rot: [0, 0, 0], ease: { rot: 'step' } },
      '1.0': { rot: [0, 40, 0] },
    };
    expect(samplePart(track, 0.999, 1.0, false).rot[1]).toBeCloseTo(0, 6);
    expect(samplePart(track, 1.0, 1.0, false).rot[1]).toBeCloseTo(40, 6);
  });

  it('does not disturb visible’s step semantics', () => {
    const track: AnimationTrack = {
      '0.0': { rot: [0, 0, 0], visible: true, ease: { rot: 'out-quad' } },
      '1.0': { rot: [0, 40, 0], visible: false },
    };
    expect(samplePart(track, 0.999, 1.0, false).visible).toBe(true);
    expect(samplePart(track, 1.0, 1.0, false).visible).toBe(false);
  });
});

describe('animation schema — ease field (SPEC §6.5)', () => {
  const withEase = (ease: unknown) => ({
    name: 'wolf',
    parts: [{ name: 'body' }],
    animations: {
      idle: {
        duration: 1,
        loop: true,
        parts: { body: { '0.0': { rot: [0, 0, 0], ease } } },
      },
    },
  });

  it('accepts a per-attribute map of preset names', () => {
    expect(
      parseManifest(withEase({ rot: 'in-out-bounce', pos: 'linear' })).ok,
    ).toBe(true);
    expect(parseManifest(withEase({ scale: 'out-back' })).ok).toBe(true);
  });

  it('rejects an unknown preset name', () => {
    expect(parseManifest(withEase({ rot: 'zigzag' })).ok).toBe(false);
  });

  it('rejects the retired keyframe-level string form', () => {
    expect(parseManifest(withEase('out-elastic')).ok).toBe(false);
  });

  it('rejects non-interpolating attributes in the map', () => {
    expect(parseManifest(withEase({ visible: 'linear' })).ok).toBe(false);
  });
});

describe('animation schema — name validation (SPEC §5)', () => {
  const withAnimName = (animName: string) => ({
    name: 'wolf',
    parts: [{ name: 'body' }],
    animations: { [animName]: { duration: 1, loop: true, parts: {} } },
  });

  it('accepts a valid identifier animation name', () => {
    expect(parseManifest(withAnimName('idle')).ok).toBe(true);
  });

  it('rejects a reserved-keyword animation name', () => {
    expect(parseManifest(withAnimName('palette')).ok).toBe(false);
  });

  it('rejects an animation name that fails the identifier regex', () => {
    expect(parseManifest(withAnimName('1bad')).ok).toBe(false);
  });
});

// `clampToClip` is what a scrubber applies to place a monotonic clock inside
// a clip, and `samplePart` used to carry a second formula for the same rule.
// They agreed on round numbers and nowhere else, so the two could report
// different points in the same loop.
describe('clampToClip', () => {
  it('holds at the ends when the clip does not loop', () => {
    expect(clampToClip(-1, 2, false)).toBe(0);
    expect(clampToClip(0.5, 2, false)).toBe(0.5);
    expect(clampToClip(3, 2, false)).toBe(2);
  });

  it('wraps positively, including from negative time', () => {
    expect(clampToClip(2.5, 1, true)).toBe(0.5);
    expect(clampToClip(-0.5, 2, true)).toBe(1.5);
    expect(clampToClip(3, 1.5, true)).toBe(0);
  });

  it('returns 0 for a degenerate duration', () => {
    expect(clampToClip(1, 0, true)).toBe(0);
    expect(clampToClip(1, -1, false)).toBe(0);
  });

  it('agrees with the sampler on the times the two formulas disagreed', () => {
    // Each of these lands on a different keyframe under the old
    // `time - floor(time / duration) * duration`.
    const track: AnimationTrack = {
      '0.0': { pos: [0, 0, 0] },
      '0.05': { pos: [10, 0, 0] },
    };
    for (const time of [5, 0.7, 10]) {
      const duration = time === 10 ? 0.3 : 0.1;
      const wrapped = clampToClip(time, duration, true);
      expect(samplePart(track, time, duration, true).pos).toEqual(
        samplePart(track, wrapped, duration, true).pos,
      );
    }
    // The sharpest case. `%` puts 5s into a 0.1s clip at the very end of the
    // loop; the subtraction form put it at the start, because 5 / 0.1 rounds
    // up to exactly 50 and 50 * 0.1 rounds back to exactly 5. A full clip
    // apart, on the one value the scrubber and the sampler both read.
    expect(clampToClip(5, 0.1, true)).toBeCloseTo(0.1, 10);
    expect(5 - Math.floor(5 / 0.1) * 0.1).toBe(0);
  });
});

// SPEC §6.7: a wrapped time within a tolerance of a keyframe is that
// keyframe's time, for every attribute at once. The wrap is the exact IEEE
// remainder, and the double nearest `12.7` is 12.699999999999999289…, so a
// 6 s clip wraps it to 0.6999999999999993 — a few ULPs below the "0.7" key.
// Read exactly, `visible` said "not yet" while rot/pos were at u ≈ 1.
describe('samplePart — a wrap that lands just short of a keyframe', () => {
  const track: AnimationTrack = {
    '0.0': { pos: [0, 0, 0], visible: false },
    '0.7': { pos: [0, 0, 0], visible: true },
    '5.1': { pos: [0, 22, 0], visible: false },
  };

  it('holds one answer for the same phase of every loop', () => {
    // models/windmill's `sack` vanished from t = 12.7 onward.
    const seen = [0.7, 6.7, 12.7, 18.7, 24.7, 30.7].map(
      (t) => samplePart(track, t, 6, true).visible,
    );
    expect(seen).toEqual([true, true, true, true, true, true]);
  });

  it('keeps visible agreeing with the interpolating attributes', () => {
    // At the raw wrapped time the pos segment is at u ≈ 0.99999999999999905,
    // i.e. at the key. `visible` must read the same instant the same way.
    for (const t of [12.7, 18.7, 24.7]) {
      const p = samplePart(track, t, 6, true);
      expect(p.visible, `t=${t}`).toBe(true);
      expect(p.pos, `t=${t}`).toEqual([0, 0, 0]);
    }
  });

  it('still distinguishes a time genuinely before the key', () => {
    expect(samplePart(track, 0.69, 6, true).visible).toBe(false);
    expect(samplePart(track, 0.6999, 6, true).visible).toBe(false);
  });

  // The tolerance scales with the clock, because the wrap error does. Left
  // unbounded it overtakes the thing it is measuring — and the first attempt
  // at a bound, half the closest gap, did not help: half-gap intervals
  // centred on the keys TILE the timeline, so at that bound every sample is
  // within tolerance of something. It is a thousandth of a gap.
  //
  // The clocks below are the point. An earlier version of this test asserted
  // only at 1e6, where the bound is three orders from binding, so it passed
  // identically against the unbounded code it was written to pin.
  it('keeps interpolating at a clock that saturates the scaled tolerance', () => {
    const tight: AnimationTrack = {
      '0.0': { rot: [0, 0, 0] },
      '0.001': { rot: [0, 100, 0] },
      '0.002': { rot: [0, 0, 0] },
    };
    // The scaled term reaches g/1000 at |time| = 1e9 × g, i.e. 1e6 here; the
    // last three clocks are all past it.
    for (const base of [0, 1e6, 5e8, 1e9, 1e10]) {
      expect(
        samplePart(tight, base + 0.0005, 0.002, true).rot[1],
        `clock ${base}`,
      ).toBeCloseTo(50, 1);
    }
  });

  it('does not collapse a segment to its endpoints at a large clock', () => {
    const tight: AnimationTrack = {
      '0.0': { rot: [0, 0, 0] },
      '0.001': { rot: [0, 100, 0] },
      '0.002': { rot: [0, 0, 0] },
    };
    // The symptom the bound exists to prevent: with eps a whole gap wide,
    // every one of these lands on a key and the part steps instead of moving.
    for (const base of [0, 5e8, 1e9]) {
      const seen = new Set<number>();
      for (let i = 0; i < 200; i++) {
        seen.add(samplePart(tight, base + (0.002 * i) / 200, 0.002, true).rot[1]!);
      }
      expect(seen.size, `clock ${base}`).toBeGreaterThan(100);
    }
  });

  it('gives a tie to the earlier keyframe', () => {
    // At a saturating clock an exact midpoint is equidistant from both keys.
    // Taking the later one jumped a whole segment.
    const two: AnimationTrack = {
      '0.0': { rot: [0, 0, 0] },
      '1.0': { rot: [0, 100, 0] },
    };
    expect(samplePart(two, 5e11 + 0.5, 1, true).rot[1]).toBeCloseTo(50, 1);
  });

  it('holds the last keyframe past a non-looping clip, at any clock', () => {
    // There is no wrap error to tolerate here at all — the clamp is exact —
    // but the tolerance applied anyway: at 1e308 it was 1e296, so `duration`
    // snapped to "0.0" and the sampler returned the FIRST keyframe where
    // §6.7 requires the last to hold.
    const two: AnimationTrack = {
      '0.0': { rot: [0, 0, 0] },
      '1.0': { rot: [0, 90, 0] },
    };
    for (const t of [1.5, 1e6, 1e308, Infinity]) {
      expect(samplePart(two, t, 2, false).rot[1], `t=${t}`).toBe(90);
    }
  });
});

// SPEC §6.7 says a keyed value is hit exactly at its keyframe and means it
// literally. `applyEasing` clamping its endpoints was only half of that: the
// interpolation has to reproduce the endpoints too, and `a + (b − a)·u` does
// not at u = 1.
describe('samplePart — a keyed value survives its own keyframe', () => {
  it('reproduces the authored number bit for bit', () => {
    // models/fox keys the body at -0.02 and read back -0.01999999999999999.
    const track: AnimationTrack = {
      '0.0': { pos: [0, 0, 0] },
      '0.15': { pos: [0.25, -0.02, 0] },
      '0.3': { pos: [0, 0, 0] },
    };
    expect(samplePart(track, 0.15, 0.3, true).pos).toEqual([0.25, -0.02, 0]);
  });

  it('holds across every corpus value that used to drift', () => {
    // One case per authored constant an audit measured as lost: each is a
    // decimal whose double is not exactly representable, which is when the
    // two lerp forms disagree.
    for (const v of [-0.02, -0.05, 0.35, 1.6, 1.2, -0.4, 0.07]) {
      const track: AnimationTrack = {
        '0.0': { rot: [0, 0, 0] },
        '1.0': { rot: [v, v, v] },
      };
      const got = samplePart(track, 1, 1, false).rot;
      expect(got, `v=${v}`).toEqual([v, v, v]);
    }
  });
});

// A non-finite clock reached the segment search as a comparison that is
// false either way, and what happened next depended on how many keyframes
// the track had: a two-key track returned NaNs that poisoned the rig, a
// one-key track indexed past the end and threw. C# would raise on the
// second where JavaScript returned `undefined`.
describe('samplePart — a non-finite time is total', () => {
  const one: AnimationTrack = { '0.0': { rot: [0, 10, 0] } };
  const two: AnimationTrack = {
    '0.0': { rot: [0, 10, 0] },
    '1.0': { rot: [0, 90, 0] },
  };

  it('answers with the clip start rather than NaN or a throw', () => {
    for (const track of [one, two]) {
      for (const loop of [true, false]) {
        const p = samplePart(track, NaN, 2, loop);
        expect(p.rot).toEqual([0, 10, 0]);
        expect(p.pos.every(Number.isFinite)).toBe(true);
      }
    }
  });

  // A non-finite DURATION is the same hazard from the other side, and the
  // first guard missed it: `duration <= 0` is false for NaN, so both failure
  // modes came straight back — the one-key track threw, the two-key track
  // returned a pose of NaNs.
  it('treats a NaN or non-positive duration as a degenerate clip', () => {
    for (const track of [one, two]) {
      for (const duration of [NaN, -Infinity, 0, -1]) {
        const p = samplePart(track, 0.5, duration, true);
        expect(p.rot, `duration ${duration}`).toEqual([0, 10, 0]);
        expect(p.scale.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('lets an infinite duration simply never wrap', () => {
    // Not degenerate: `0.5 % Infinity` is 0.5, so the clip is sampled where
    // the clock says. Pinned so the NaN guard is never widened to catch it.
    expect(samplePart(two, 0.5, Infinity, true).rot[1]).toBe(50);
  });

  it('still lets ±Infinity clamp to an end when the clip does not loop', () => {
    expect(samplePart(two, Infinity, 2, false).rot[1]).toBe(90);
    expect(samplePart(two, -Infinity, 2, false).rot[1]).toBe(10);
    // A looping clip has no end to clamp to, and Infinity % d is NaN.
    expect(samplePart(two, Infinity, 2, true).rot[1]).toBe(10);
  });
});

describe('sampleTimes', () => {
  const clip = (duration: number, loop: boolean) => ({
    duration,
    loop,
    parts: {},
  });

  it('lands on the midpoint for an even step count', () => {
    // The property the two sweeping tools depend on. A clip that goes out
    // and comes back is furthest at the middle, and that is the pose worth
    // looking at.
    expect(sampleTimes(clip(2, true), 8)).toContain(1);
    expect(sampleTimes(clip(2, false), 8)).toContain(1);
  });

  it('misses the midpoint for an odd step count', () => {
    // Stated so the even default is not quietly changed to an odd one.
    expect(sampleTimes(clip(2, true), 7)).not.toContain(1);
    expect(sampleTimes(clip(2, false), 7)).not.toContain(1);
  });

  it('gives a one-shot clip its final pose', () => {
    // A lunge or a swing very often ENDS at its extreme; a sweep that stops
    // one step short inspects everything except the pose that was the point.
    expect(sampleTimes(clip(1, false), 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('does not repeat the end of a looping clip, which is its start', () => {
    expect(sampleTimes(clip(1, true), 4)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('always yields at least the rest of the clip', () => {
    expect(sampleTimes(clip(1, true), 1)).toEqual([0]);
    expect(sampleTimes(clip(1, false), 1)).toEqual([0, 1]);
    expect(sampleTimes(clip(1, true), 0)).toEqual([0]);
  });
});
