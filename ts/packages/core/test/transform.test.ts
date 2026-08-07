import { describe, expect, it } from 'vitest';
import {
  duplicatePart,
  mirrorPart,
  remapPartPalette,
} from '../src/geometry/transform.js';
import type { Color, Part } from '../src/geometry/types.js';

const RED: Color = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: Color = { r: 0, g: 0, b: 255, a: 255 };
const GREEN: Color = { r: 0, g: 255, b: 0, a: 255 };

// 2×1×1 part, one row [0,1], asymmetric so a mirror is observable. A socket
// and a rotated pivot exercise the position/rotation reflection.
function sample(): Part {
  return {
    name: 'hand',
    size: { w: 2, h: 1, d: 1 },
    pivot: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 10, y: 20, z: 30 } },
    sockets: [{ name: 'tip', pos: { x: 0, y: 0, z: 0 }, rot: { x: 5, y: 6, z: 7 } }],
    voxels: [[[0, 1]]],
  };
}

describe('duplicatePart', () => {
  it('copies geometry under a new name, no reuse reference', () => {
    const d = duplicatePart(sample(), 'hand2');
    // What `expect(d.from).toBeUndefined()` was reaching for. `Part` has no
    // `from` field, so that assertion read an absent property and passed for
    // every possible implementation; this one fails if a duplicate ever
    // grows a back-reference instead of being a part in its own right.
    expect(Object.keys(d).sort()).toEqual([
      'name',
      'pivot',
      'size',
      'sockets',
      'voxels',
    ]);
    expect(d.name).toBe('hand2');
    expect(d.voxels).toEqual([[[0, 1]]]);
    expect(d.size).toEqual({ w: 2, h: 1, d: 1 });
    expect(d.pivot).toEqual(sample().pivot);
    expect(d.sockets).toEqual(sample().sockets);
  });
});

describe('mirrorPart', () => {
  it('reflects voxels across the x axis', () => {
    const m = mirrorPart(sample(), 'x', 'hand_r');
    expect(m.name).toBe('hand_r');
    expect(m.voxels).toEqual([[[1, 0]]]);
  });

  it('reflects pivot position and negates the off-axis rotation', () => {
    const m = mirrorPart(sample(), 'x', 'hand_r');
    // pos.x → w - x = 2 - 0; y/z unchanged.
    expect(m.pivot.pos).toEqual({ x: 2, y: 0, z: 0 });
    // x rotation kept (around the mirror axis); y/z negated.
    expect(m.pivot.rot).toEqual({ x: 10, y: -20, z: -30 });
    const s = m.sockets[0]!;
    expect(s.pos).toEqual({ x: 2, y: 0, z: 0 });
    expect(s.rot).toEqual({ x: 5, y: -6, z: -7 });
  });

  it('is an involution (mirroring twice restores the original)', () => {
    const once = mirrorPart(sample(), 'x', 'a');
    const twice = mirrorPart(once, 'x', 'b');
    expect(twice.voxels).toEqual(sample().voxels);
    expect(twice.pivot).toEqual(sample().pivot);
    expect(twice.sockets).toEqual(sample().sockets);
  });
});

describe('remapPartPalette', () => {
  it('remaps indices into the target palette, appending missing colors', () => {
    const part: Part = { ...sample(), voxels: [[[0, 1]]] };
    // from = [RED, BLUE]; to = [GREEN] lacks both → appended, indices shift.
    const { part: out, palette } = remapPartPalette(part, [RED, BLUE], [GREEN]);
    expect(palette).toEqual([GREEN, RED, BLUE]);
    expect(out.voxels).toEqual([[[1, 2]]]);
  });

  it('reuses a matching color already in the target palette', () => {
    const part: Part = { ...sample(), voxels: [[[0, 1]]] };
    // to already has RED at 0; BLUE appended at 2 (GREEN stays at 1).
    const { part: out, palette } = remapPartPalette(part, [RED, BLUE], [RED, GREEN]);
    expect(palette).toEqual([RED, GREEN, BLUE]);
    expect(out.voxels).toEqual([[[0, 2]]]);
  });

  it('passes AIR through and leaves an identical palette untouched', () => {
    const part: Part = { ...sample(), voxels: [[[0, -1]]] };
    const to = [RED, BLUE];
    const { part: out, palette } = remapPartPalette(part, [RED, BLUE], to);
    expect(palette).toBe(to); // same reference — no remap needed
    expect(out.voxels).toEqual([[[0, -1]]]);
  });
});
