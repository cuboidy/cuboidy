import { describe, expect, it } from 'vitest';
import {
  buildScene,
  buildSceneFromParts,
  type OrientedPart,
  type Voxel,
} from '../src/render/scene.js';
import { QUAT_IDENTITY, quatFromEulerZXYDeg } from '../src/rig-transform.js';
import { AIR } from '../src/geometry/voxel-row.js';
import type { Palette, Part } from '../src/geometry/types.js';

const PALETTE: Palette = [
  { r: 255, g: 0, b: 0, a: 255 },
  { r: 0, g: 255, b: 0, a: 255 },
];

describe('buildScene', () => {
  it('emits six faces for a lone voxel', () => {
    const scene = buildScene([{ x: 0, y: 0, z: 0, idx: 0 }], PALETTE);
    expect(scene.quads).toHaveLength(6);
    expect(scene.min).toEqual([0, 0, 0]);
    expect(scene.max).toEqual([1, 1, 1]);
    expect(scene.center).toEqual([0.5, 0.5, 0.5]);
  });

  it('culls the shared face between two adjacent voxels', () => {
    const voxels: Voxel[] = [
      { x: 0, y: 0, z: 0, idx: 0 },
      { x: 1, y: 0, z: 0, idx: 0 },
    ];
    const scene = buildScene(voxels, PALETTE);
    // 12 faces total minus the two touching faces.
    expect(scene.quads).toHaveLength(10);
    expect(scene.max).toEqual([2, 1, 1]);
  });

  it('maps the palette index to an sRGB color in 0..1', () => {
    const scene = buildScene([{ x: 0, y: 0, z: 0, idx: 1 }], PALETTE);
    expect(scene.quads[0]!.color).toEqual([0, 1, 0]);
  });

  it('returns a finite origin-anchored scene for no voxels (no NaN center)', () => {
    const scene = buildScene([], PALETTE);
    expect(scene.quads).toHaveLength(0);
    expect(scene.center).toEqual([0, 0, 0]);
    expect(scene.min).toEqual([0, 0, 0]);
    expect(scene.max).toEqual([0, 0, 0]);
    expect(scene.center.every(Number.isFinite)).toBe(true);
  });

  it('keeps faces between voxels that are not grid-aligned (half offset)', () => {
    // A voxel at x=0 and one at x=0.5 do not share an integer face, so
    // none are culled — 12 faces survive.
    const voxels: Voxel[] = [
      { x: 0, y: 0, z: 0, idx: 0 },
      { x: 0.5, y: 0, z: 0, idx: 0 },
    ];
    expect(buildScene(voxels, PALETTE).quads).toHaveLength(12);
  });
});

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
  it('matches buildScene for an identity-transform lone voxel', () => {
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
