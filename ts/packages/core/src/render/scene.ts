import type { Palette, Part } from '../geometry/types.js';
import { AIR } from '../geometry/voxel-row.js';
import { quatRotateVec3, type WorldTransform } from '../rig-transform.js';
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
//
// buildSceneFromParts is the rotation-aware sibling: it emits faces per
// part in part-local space and pushes the corners through the part's
// SPEC §7.7 rest world transform, so rest rotations render as true
// oriented cubes. Culling there is per-part only (cross-part seams stay
// in the quad list — with rotation the parts need not share a lattice);
// the z-buffer and back-face cull hide them, so the image matches the
// grid path for unrotated models at the cost of a few extra fills.

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

// One part ready for oriented rendering: geometry geometry, its palette
// remap into the effective palette (null = identity), and its rest
// world transform. Mirrors assemble.ts's PlacedPart without depending
// on the CLI layer.
export interface OrientedPart {
  part: Part;
  remap: readonly number[] | null;
  transform: WorldTransform;
  // Animated §6.5 scale, applied to this part's own geometry about its
  // pivot and NOT inherited by children (§7.7 puts S_anim inside the
  // part's local term). Absent = [1, 1, 1].
  scale?: readonly [number, number, number] | undefined;
}

// Rotation-aware scene builder: per part, emit the faces its own solid
// neighbours don't cull, with every corner mapped by
//   v_world = transform.pos + rotate(transform.quat, v_local − pivot.pos)
// (SPEC §7.7 rest pose). Scene bounds accumulate over emitted corners —
// exact for the visible hull, since any extreme point of a solid volume
// lies on a face-exposed voxel.
export function buildSceneFromParts(
  parts: readonly OrientedPart[],
  palette: Palette,
): Scene {
  const srgb = palette.map((c) => [c.r / 255, c.g / 255, c.b / 255] as Rgb);

  const quads: Quad[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const { part, remap, transform, scale } of parts) {
    const { w, h, d } = part.size;
    const solid = (x: number, y: number, z: number): boolean =>
      x >= 0 && x < w && y >= 0 && y < h && z >= 0 && z < d &&
      part.voxels[y]![z]![x]! !== AIR;
    const piv = part.pivot.pos;
    const [sx, sy, sz] = scale ?? [1, 1, 1];
    const toWorld = (x: number, y: number, z: number): Vec3 => {
      // Scale acts on the pivot-relative offset, so the part grows about
      // its pivot rather than about the grid origin.
      const r = quatRotateVec3(transform.quat, [
        (x - piv.x) * sx,
        (y - piv.y) * sy,
        (z - piv.z) * sz,
      ]);
      return [
        transform.pos[0] + r[0],
        transform.pos[1] + r[1],
        transform.pos[2] + r[2],
      ];
    };

    for (let y = 0; y < h; y++) {
      const layer = part.voxels[y]!;
      for (let z = 0; z < d; z++) {
        const row = layer[z]!;
        for (let x = 0; x < w; x++) {
          const idx = row[x]!;
          if (idx === AIR) continue;
          const effIdx = remap === null ? idx : remap[idx]!;
          const color = srgb[effIdx]!;
          for (const f of FACES) {
            if (solid(x + f.d[0], y + f.d[1], z + f.d[2])) continue;
            const corners = f.corners.map((c) =>
              toWorld(x + c[0], y + c[1], z + c[2]),
            ) as [Vec3, Vec3, Vec3, Vec3];
            quads.push({
              corners,
              normal: quatRotateVec3(transform.quat, f.normal),
              color,
            });
            for (const c of corners) {
              if (c[0] < minX) minX = c[0];
              if (c[0] > maxX) maxX = c[0];
              if (c[1] < minY) minY = c[1];
              if (c[1] > maxY) maxY = c[1];
              if (c[2] < minZ) minZ = c[2];
              if (c[2] > maxZ) maxZ = c[2];
            }
          }
        }
      }
    }
  }

  // No solid voxels → same finite, origin-anchored scene buildScene
  // returns (callers reject empty models earlier; this keeps the direct
  // API NaN-safe).
  if (quads.length === 0) {
    return { quads: [], center: [0, 0, 0], min: [0, 0, 0], max: [0, 0, 0] };
  }
  return {
    quads,
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}
