import type { Palette } from '../cvox/types.js';
import type { Rgb } from './framebuffer.js';
import type { Vec3 } from './vec.js';

// Turn an assembled, world-space voxel grid into renderable cube faces.
// A voxel at world coord (x, y, z) occupies the unit cube spanning
// [x, x+1] on each axis — the same convention as mesh.ts (corner
// offsets 0/1) and assemble.ts (integer voxel index → world offset).
//
// Faces shared with an occupied neighbour are culled, so only the
// model's outer shell is emitted. Culling uses an exact-coordinate
// occupancy set, so it composes across parts (an internal seam between
// two adjacent parts is removed) and is safe at half-voxel offsets:
// neighbours that don't line up on the integer grid simply aren't
// culled (the z-buffer still hides them; the only cost is extra fills).

export interface Voxel {
  x: number;
  y: number;
  z: number;
  idx: number; // palette index (never AIR)
}

export interface Quad {
  // Four world-space corners, CCW seen from outside (matches mesh.ts).
  corners: readonly [Vec3, Vec3, Vec3, Vec3];
  normal: Vec3;
  color: Rgb; // base sRGB color, 0..1
}

export interface Scene {
  quads: Quad[];
  center: Vec3; // geometric center of the occupied volume
  min: Vec3; // inclusive lower corner
  max: Vec3; // inclusive upper corner (voxel coord + 1)
}

interface FaceDef {
  readonly normal: Vec3;
  readonly d: readonly [number, number, number]; // neighbour offset
  readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
}

// Face order and winding identical to mesh.ts FACES so renders match the
// editor's geometry. +X, −X, +Y, −Y, +Z, −Z.
const FACES: readonly FaceDef[] = [
  { normal: [1, 0, 0], d: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { normal: [-1, 0, 0], d: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { normal: [0, 1, 0], d: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { normal: [0, -1, 0], d: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [0, 0, 1], d: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { normal: [0, 0, -1], d: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

export function buildScene(voxels: readonly Voxel[], palette: Palette): Scene {
  // No voxels → no geometry. Return a finite, origin-anchored scene so
  // callers never see a NaN center (min/max would otherwise stay at the
  // ±Infinity sentinels and average to NaN). The CLI rejects empty
  // models earlier; this keeps the direct buildScene/renderSnapshots
  // API safe too.
  if (voxels.length === 0) {
    return { quads: [], center: [0, 0, 0], min: [0, 0, 0], max: [0, 0, 0] };
  }

  const occupied = new Set<string>();
  for (const v of voxels) occupied.add(key(v.x, v.y, v.z));

  const srgb = palette.map((c) => [c.r / 255, c.g / 255, c.b / 255] as Rgb);

  const quads: Quad[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const v of voxels) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x + 1 > maxX) maxX = v.x + 1;
    if (v.y + 1 > maxY) maxY = v.y + 1;
    if (v.z + 1 > maxZ) maxZ = v.z + 1;

    const color = srgb[v.idx]!;
    for (const f of FACES) {
      if (occupied.has(key(v.x + f.d[0], v.y + f.d[1], v.z + f.d[2]))) continue;
      const corners = f.corners.map(
        (c) => [v.x + c[0], v.y + c[1], v.z + c[2]] as Vec3,
      ) as [Vec3, Vec3, Vec3, Vec3];
      quads.push({ corners, normal: f.normal, color });
    }
  }

  const min: Vec3 = [minX, minY, minZ];
  const max: Vec3 = [maxX, maxY, maxZ];
  const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  return { quads, center, min, max };
}
