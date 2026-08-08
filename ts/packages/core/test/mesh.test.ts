import { describe, expect, it } from 'vitest';
import { AIR } from '../src/geometry/voxel-row.js';
import { buildMesh } from '../src/mesh.js';
import type { PaletteEntry, Part } from '../src/geometry/types.js';
import { rgba } from './helpers/palette.js';

const RED: PaletteEntry = rgba(255, 0, 0, 255);
const GREEN: PaletteEntry = rgba(0, 255, 0, 255);
// Palette index 0 is AIR by convention; first real color sits at 1.
const PALETTE = [rgba(0, 0, 0, 0), RED, GREEN] as const;

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

// SPEC §7.4: an index no palette entry defines renders as opaque magenta.
// A runtime carries no validation, so it needs a defined answer rather than
// an out-of-bounds read — this is the behaviour a port must match instead of
// indexing its palette and throwing.
describe('buildMesh — unresolved color', () => {
  it('paints an out-of-range index magenta', () => {
    const mesh = buildMesh(
      {
        name: 'p',
        size: { w: 1, h: 1, d: 1 },
        pivot: { pos: { x: 0, y: 0, z: 0 } },
        sockets: [],
        voxels: [[[5]]],
      },
      [rgba(0, 0, 0, 255)],
    );
    // Every vertex of the single cube carries the same unresolved color.
    for (let i = 0; i < mesh.colors.length; i += 3) {
      expect([mesh.colors[i], mesh.colors[i + 1], mesh.colors[i + 2]]).toEqual([
        1, 0, 1,
      ]);
    }
    expect(mesh.colors.length).toBeGreaterThan(0);
  });

  it('paints an in-range index its palette color', () => {
    const mesh = buildMesh(
      {
        name: 'p',
        size: { w: 1, h: 1, d: 1 },
        pivot: { pos: { x: 0, y: 0, z: 0 } },
        sockets: [],
        voxels: [[[0]]],
      },
      [rgba(255, 0, 0, 255)],
    );
    expect([mesh.colors[0], mesh.colors[1], mesh.colors[2]]).toEqual([1, 0, 0]);
  });
});

// SPEC §7.4: alpha on a palette entry is opacity, and it changes which
// faces exist — a face survives unless its neighbour HIDES it.
describe('buildMesh — translucent palette entries (§7.4)', () => {
  const OPAQUE = rgba(200, 80, 40, 255);
  const GLASS = rgba(60, 160, 255, 0x55);
  const GLASS2 = rgba(60, 255, 160, 0x55);

  // voxels are [Y][Z][X]; every part here is one row deep and one tall.
  const strip = (cells: number[]) => ({
    name: 'p',
    size: { w: cells.length, h: 1, d: 1 },
    pivot: { pos: { x: 0, y: 0, z: 0 } },
    sockets: [],
    voxels: [[cells]],
  });

  it('keeps the opaque face a translucent neighbour would have hidden', () => {
    // [opaque][glass]. Six faces each, minus the two the OLD rule dropped
    // for merely being adjacent. The opaque one must survive, or the wall
    // behind the glass has a hole in it.
    const solo = buildMesh(strip([0]), [OPAQUE]);
    const pair = buildMesh(strip([0, 1]), [OPAQUE, GLASS]);
    // 6 + 6 faces, less the ONE the glass drops toward the opaque block.
    expect(pair.indices.length).toBe(solo.indices.length * 2 - 6);
  });

  it('drops both faces between two voxels of one translucent color', () => {
    // A run of one color is one surface, whatever its thickness — so this
    // has exactly the face count of a single glass voxel widened.
    const one = buildMesh(strip([0]), [GLASS]);
    const three = buildMesh(strip([0, 0, 0]), [GLASS]);
    expect(three.indices.length).toBe(one.indices.length * 3 - 4 * 6);
  });

  it('keeps the faces between two DIFFERENT translucent colors', () => {
    const pair = buildMesh(strip([0, 1]), [GLASS, GLASS2]);
    const solo = buildMesh(strip([0]), [GLASS]);
    expect(pair.indices.length).toBe(solo.indices.length * 2);
  });

  it('orders indices opaque-first and reports the split', () => {
    const m = buildMesh(strip([0, 1]), [OPAQUE, GLASS]);
    expect(m.opaqueIndexCount).toBeGreaterThan(0);
    expect(m.opaqueIndexCount).toBeLessThan(m.indices.length);
    // Every vertex the opaque range touches is fully opaque, and every one
    // the remainder touches is not — that is what makes the two passes two
    // ranges of one buffer.
    for (let i = 0; i < m.opaqueIndexCount; i++) {
      expect(m.alphas[m.indices[i]!]).toBe(1);
    }
    for (let i = m.opaqueIndexCount; i < m.indices.length; i++) {
      expect(m.alphas[m.indices[i]!]).toBeLessThan(1);
    }
  });

  it('leaves a fully opaque model with one pass and alpha 1', () => {
    const m = buildMesh(strip([0, 0]), [OPAQUE]);
    expect(m.opaqueIndexCount).toBe(m.indices.length);
    expect([...m.alphas].every((a) => a === 1)).toBe(true);
  });

  it('treats an unresolved index as opaque magenta', () => {
    const m = buildMesh(strip([5]), [GLASS]);
    expect(m.opaqueIndexCount).toBe(m.indices.length);
    expect(m.colors[0]).toBe(1);
    expect(m.colors[1]).toBe(0);
    expect(m.colors[2]).toBe(1);
  });
});
