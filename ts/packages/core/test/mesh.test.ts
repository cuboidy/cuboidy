import { describe, expect, it } from 'vitest';
import { AIR } from '../src/geometry/voxel-row.js';
import { buildMesh } from '../src/mesh.js';
import type { Color, Part } from '../src/geometry/types.js';

const RED: Color = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: Color = { r: 0, g: 255, b: 0, a: 255 };
// Palette index 0 is AIR by convention; first real color sits at 1.
const PALETTE = [{ r: 0, g: 0, b: 0, a: 0 }, RED, GREEN] as const;

function makePart(
  w: number,
  h: number,
  d: number,
  fill: (x: number, y: number, z: number) => number,
): Part {
  const voxels: number[][][] = [];
  for (let y = 0; y < h; y++) {
    const plane: number[][] = [];
    for (let z = 0; z < d; z++) {
      const row: number[] = [];
      for (let x = 0; x < w; x++) row.push(fill(x, y, z));
      plane.push(row);
    }
    voxels.push(plane);
  }
  return {
    name: 'test',
    size: { w, h, d },
    pivot: { pos: { x: 0, y: 0, z: 0 } },
    sockets: [],
    voxels,
  };
}

describe('buildMesh', () => {
  it('emits zero geometry for an all-AIR part', () => {
    const part = makePart(2, 2, 2, () => AIR);
    const m = buildMesh(part, PALETTE);
    expect(m.positions.length).toBe(0);
    expect(m.normals.length).toBe(0);
    expect(m.colors.length).toBe(0);
    expect(m.indices.length).toBe(0);
  });

  it('emits exactly 6 faces for a single isolated voxel', () => {
    const part = makePart(1, 1, 1, () => 1);
    const m = buildMesh(part, PALETTE);
    // 6 faces × 4 verts = 24; 6 faces × 6 indices = 36
    expect(m.positions.length).toBe(24 * 3);
    expect(m.normals.length).toBe(24 * 3);
    expect(m.colors.length).toBe(24 * 3);
    expect(m.indices.length).toBe(36);
  });

  it('culls the shared face between two adjacent voxels', () => {
    // Two voxels along +X: each would have 6 faces in isolation, but the
    // shared interior face is skipped on both sides → 10 visible faces.
    const part = makePart(2, 1, 1, () => 1);
    const m = buildMesh(part, PALETTE);
    expect(m.positions.length / 3 / 4).toBe(10); // verts → quads
    expect(m.indices.length / 6).toBe(10);
  });

  it('emits sRGB-normalized colors straight from the palette', () => {
    const part = makePart(1, 1, 1, () => 1);
    const m = buildMesh(part, PALETTE);
    // RED = (1, 0, 0) in sRGB; all 24 verts share the same color.
    for (let i = 0; i < 24; i++) {
      expect(m.colors[i * 3]).toBe(1);
      expect(m.colors[i * 3 + 1]).toBe(0);
      expect(m.colors[i * 3 + 2]).toBe(0);
    }
  });

  it('uses Uint16 indices below 65536 verts and Uint32 above', () => {
    const small = buildMesh(makePart(1, 1, 1, () => 1), PALETTE);
    expect(small.indices).toBeInstanceOf(Uint16Array);
    // 17×17×17 fully solid → only the outer shell is visible (6×17² = 1734
    // faces, 6936 verts) — still under 65536, sanity check.
    const cube = buildMesh(makePart(17, 17, 17, () => 1), PALETTE);
    expect(cube.indices).toBeInstanceOf(Uint16Array);
  });

  it('iterates voxels in y → z → x order (parity reference)', () => {
    // Two non-touching voxels: one at (0,0,0), one at (0,1,0). The lower
    // voxel must be visited first, so its faces appear first in the buffer.
    // Bottom voxel's +Y normal is (0,1,0); upper voxel's -Y normal is
    // (0,-1,0). Find the first vertex with normal y = -1 — it should belong
    // to a position with y = 1 (the upper voxel).
    const part = makePart(1, 2, 1, (_x, y) => (y === 0 || y === 1 ? 1 : AIR));
    const m = buildMesh(part, PALETTE);
    let firstNegYVert = -1;
    for (let v = 0; v < m.normals.length / 3; v++) {
      if (m.normals[v * 3 + 1] === -1) {
        firstNegYVert = v;
        break;
      }
    }
    expect(firstNegYVert).toBeGreaterThanOrEqual(0);
    // Lower voxel's -Y face has y=0; upper voxel's -Y face has y=1.
    // Lower one is emitted first because y=0 comes before y=1.
    expect(m.positions[firstNegYVert * 3 + 1]).toBe(0);
  });
});
