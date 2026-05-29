import { describe, expect, it } from 'vitest';
import { buildScene, type Voxel } from '../src/render/scene.js';
import type { Palette } from '../src/cvox/types.js';

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
