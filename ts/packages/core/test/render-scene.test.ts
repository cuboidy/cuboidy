import { describe, expect, it } from 'vitest';
import { buildSceneFromParts, type OrientedPart } from '../src/render/scene.js';
import { QUAT_IDENTITY, quatFromEulerZXYDeg } from '../src/rig-transform.js';
import { AIR } from '../src/geometry/voxel-row.js';
import type { Palette, Part } from '../src/geometry/types.js';

const PALETTE: Palette = [
  { r: 255, g: 0, b: 0, a: 255 },
  { r: 0, g: 255, b: 0, a: 255 },
];

// A w×1×1 bar of palette-index-0 voxels with pivot at the origin corner.
function bar(w: number): Part {
  return {
    name: 'p',
    size: { w, h: 1, d: 1 },
    pivot: { pos: { x: 0, y: 0, z: 0 } },
    sockets: [],
    voxels: [[Array.from({ length: w }, () => 0)]],
  };
}

function oriented(part: Part, over: Partial<OrientedPart> = {}): OrientedPart {
  return {
    part,
    remap: null,
    transform: { pos: [0, 0, 0], quat: QUAT_IDENTITY },
    ...over,
  };
}

describe('buildSceneFromParts', () => {
  it('emits six faces for an identity-transform lone voxel', () => {
    const scene = buildSceneFromParts([oriented(bar(1))], PALETTE);
    expect(scene.quads).toHaveLength(6);
    expect(scene.min).toEqual([0, 0, 0]);
    expect(scene.max).toEqual([1, 1, 1]);
    expect(scene.center).toEqual([0.5, 0.5, 0.5]);
  });

  it('culls shared faces within a part', () => {
    const scene = buildSceneFromParts([oriented(bar(2))], PALETTE);
    expect(scene.quads).toHaveLength(10);
    expect(scene.max).toEqual([2, 1, 1]);
  });

  it('keeps cross-part seam faces (z-buffer hides them)', () => {
    const scene = buildSceneFromParts(
      [
        oriented(bar(1)),
        oriented(bar(1), { transform: { pos: [1, 0, 0], quat: QUAT_IDENTITY } }),
      ],
      PALETTE,
    );
    expect(scene.quads).toHaveLength(12);
    expect(scene.max).toEqual([2, 1, 1]);
  });

  it('applies the palette remap to quad colors', () => {
    const scene = buildSceneFromParts([oriented(bar(1), { remap: [1] })], PALETTE);
    expect(scene.quads[0]!.color).toEqual([0, 1, 0]);
  });

  it('subtracts the pivot before transforming (pivot lands at transform.pos)', () => {
    const part = bar(1);
    part.pivot = { pos: { x: 1, y: 0, z: 0 } };
    const scene = buildSceneFromParts(
      [oriented(part, { transform: { pos: [5, 0, 0], quat: QUAT_IDENTITY } })],
      PALETTE,
    );
    expect(scene.min).toEqual([4, 0, 0]);
    expect(scene.max).toEqual([5, 1, 1]);
  });

  it('rotates quads around the pivot (90° about Z turns the unit cube)', () => {
    const scene = buildSceneFromParts(
      [
        oriented(bar(1), {
          transform: { pos: [0, 0, 0], quat: quatFromEulerZXYDeg([0, 0, 90]) },
        }),
      ],
      PALETTE,
    );
    // Rz(90) maps (x, y) → (−y, x): the cube [0,1]³ lands at x ∈ [−1,0].
    expect(scene.quads).toHaveLength(6);
    expect(scene.min[0]).toBeCloseTo(-1, 10);
    expect(scene.max[0]).toBeCloseTo(0, 10);
    expect(scene.min[1]).toBeCloseTo(0, 10);
    expect(scene.max[1]).toBeCloseTo(1, 10);
    expect(scene.min[2]).toBeCloseTo(0, 10);
    expect(scene.max[2]).toBeCloseTo(1, 10);
  });

  it('returns the finite origin-anchored scene for all-AIR parts', () => {
    const part = bar(1);
    part.voxels = [[[AIR]]];
    const scene = buildSceneFromParts([oriented(part)], PALETTE);
    expect(scene.quads).toHaveLength(0);
    expect(scene.center).toEqual([0, 0, 0]);
  });
});

// SPEC §7.4: an index no palette entry defines renders as opaque magenta.
// The rasterizer used to assert its way past this with two non-null
// assertions and emit `color: undefined`, which `snapshot.ts` then
// multiplied by a light intensity. It was unreachable only because the CLI
// rejects such a model first — a renderer defended by its caller.
describe('buildSceneFromParts — unresolved color (§7.4)', () => {
  const onePart = (voxel: number) => ({
    part: {
      name: 'p',
      size: { w: 1, h: 1, d: 1 },
      pivot: { pos: { x: 0, y: 0, z: 0 } },
      sockets: [],
      voxels: [[[voxel]]],
    },
    remap: null,
    transform: { pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
  });

  it('paints an index past the palette magenta, never undefined', () => {
    const scene = buildSceneFromParts([onePart(5)], [
      { r: 0, g: 0, b: 0, a: 255 },
    ]);
    expect(scene.quads).toHaveLength(6);
    for (const q of scene.quads) expect(q.color).toEqual([1, 0, 1]);
  });

  it('survives a remap that does not cover the index', () => {
    const scene = buildSceneFromParts(
      [{ ...onePart(3), remap: [0] }],
      [{ r: 255, g: 0, b: 0, a: 255 }],
    );
    for (const q of scene.quads) expect(q.color).toEqual([1, 0, 1]);
  });

  it('still paints an in-range index its own color', () => {
    const scene = buildSceneFromParts([onePart(0)], [
      { r: 255, g: 0, b: 0, a: 255 },
    ]);
    for (const q of scene.quads) expect(q.color).toEqual([1, 0, 0]);
  });
});
