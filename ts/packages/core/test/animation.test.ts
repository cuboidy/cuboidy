import { describe, expect, it } from 'vitest';
import {
  isInlineAnimation,
  sampleAnimation,
  samplePart,
  type AnimationTrack,
} from '../src/animation.js';
import { parseManifest } from '../src/manifest.js';
import { readFixtureJson } from './helpers/fixtures.js';

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

describe('sampleAnimation — wolf idle (real manifest)', () => {
  it('samples all animated parts of the wolf idle clip', async () => {
    const json = await readFixtureJson('models/wolf/cuboidy.json');
    const r = parseManifest(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const idle = r.value.animations?.['idle'];
    expect(idle).toBeDefined();
    if (idle === undefined || !isInlineAnimation(idle)) return;

    // At t=0.5 the tail is at its keyed peak (y=25); the head (keyed
    // 0.0→1.0 over rot.x 0→5) is halfway → x=2.5.
    const poses = sampleAnimation(idle, 0.5);
    expect(poses.get('tail')?.rot[1]).toBeCloseTo(25, 6);
    expect(poses.get('head')?.rot[0]).toBeCloseTo(2.5, 6);

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
  it('validates the neko model (two animations) through parseManifest', async () => {
    const json = await readFixtureJson('models/neko/cuboidy.json');
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
