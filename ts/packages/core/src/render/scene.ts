import type { Material, Palette, Part } from '../geometry/types.js';
import { AIR } from '../geometry/voxel-row.js';
import { MATTE } from '../geometry/palette.js';
import {
  localPointToWorld,
  quatRotateVec3,
  type WorldTransform,
} from '../rig-transform.js';
import type { Rgb } from './framebuffer.js';
import type { Vec3 } from './vec.js';

// Turn resolved parts into renderable cube faces. A voxel occupies the
// unit cube spanning [x, x+1] on each axis in part-local space — the
// same convention as mesh.ts (corner offsets 0/1) — and every corner is
// pushed through the part's SPEC §7.7 rest world transform, so rest
// rotations render as true oriented cubes.
//
// Culling is per-part only: faces shared with a solid neighbour in the
// SAME part are dropped, cross-part seams stay in the quad list (with
// rotation the parts need not share a lattice). The z-buffer and
// back-face cull hide them; the only cost is a few extra fills.

export interface Quad {
  // Four world-space corners, CCW seen from outside (matches mesh.ts).
  corners: readonly [Vec3, Vec3, Vec3, Vec3];
  normal: Vec3;
  color: Rgb; // base sRGB color, 0..1
  // SPEC §7.4 opacity, 0..1. 1 for every face of an opaque color, so a
  // renderer that ignores it draws what it always did.
  alpha: number;
  // SPEC §7.4 material. Every face of a palette that says nothing about it
  // carries MATTE, so a renderer that ignores this field draws what it
  // always did — which is the point: shading these numbers is explicitly
  // NOT normative, only that they reach the renderer unchanged.
  material: Material;
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

// SPEC §7.4's opaque magenta, in the 0..1 sRGB this module carries. It has
// no palette entry to read a material from, so it is matte as well.
const UNRESOLVED_COLOR: Rgb = [1, 0, 1];

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

// One part ready for oriented rendering: its geometry, its palette
// remap into the effective palette (null = identity), and its rest
// world transform. assemble.ts's PlacedPart extends this with the name
// the rig uses.
export interface OrientedPart {
  part: Part;
  remap: readonly number[] | null;
  transform: WorldTransform;
  // The part's total scale — the rest `scale` of §6.2 times the animated
  // `scale` of §6.5 — applied to this part's own geometry about its pivot
  // and NOT inherited by children (§7.7 puts S_total inside the part's
  // local term). One field for both because they are one operator: same
  // axes, same pivot, same stopping point, so they commute into a single
  // product. Absent = [1, 1, 1].
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
  const srgb = palette.map(
    (e) => [e.color.r / 255, e.color.g / 255, e.color.b / 255] as Rgb,
  );
  const alphaOf = palette.map((e) => e.color.a / 255);
  const materialOf = palette.map((e): Material => e.material);
  const opaque = palette.map((e) => e.color.a === 255);

  const quads: Quad[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const { part, remap, transform, scale } of parts) {
    const { w, h, d } = part.size;
    // Absent is AIR, whether the cell is outside the declared size or
    // outside a row that is shorter than the size claims — mesh.ts's
    // `voxelAt` answers the same way, and mesh-scene-parity.test.ts holds
    // the two together.
    const at = (x: number, y: number, z: number): number =>
      x >= 0 && x < w && y >= 0 && y < h && z >= 0 && z < d
        ? (part.voxels[y]?.[z]?.[x] ?? AIR)
        : AIR;
    // The §7.4 hide rule, identical to mesh.ts's: a neighbour hides a face
    // when it is opaque or the very same index. Merely being solid is not
    // enough, or a wall behind glass would lose the face you look at.
    const hidden = (n: number, self: number): boolean => {
      if (n === AIR) return false;
      if (n === self) return true;
      const eff = remap === null ? n : (remap[n] ?? n);
      return opaque[eff] ?? true;
    };
    const piv: Vec3 = [part.pivot.pos.x, part.pivot.pos.y, part.pivot.pos.z];
    // §7.7 / §6.5, stated once in rig-transform.ts — the same call
    // socketFrameOn makes, so a socket cannot drift from the voxels it sits
    // among when the part is scaled.
    const toWorld = (x: number, y: number, z: number): Vec3 =>
      localPointToWorld([x, y, z], piv, scale, transform);

    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) {
          const idx = at(x, y, z);
          if (idx === AIR) continue;
          // SPEC §7.4: an index no palette entry defines renders as opaque
          // magenta, the same answer `mesh.ts` gives. The two non-null
          // assertions that used to stand here were both false for a short
          // palette: `remap[idx]` and `srgb[effIdx]` each returned
          // `undefined`, and `snapshot.ts` then multiplied it by a light
          // intensity. The CLI happens to reject such a model upstream, so
          // the renderer was defended by its caller — which is the shape
          // §7.4 exists to forbid, since a port's caller may not.
          const effIdx = remap === null ? idx : (remap[idx] ?? idx);
          const color = srgb[effIdx] ?? UNRESOLVED_COLOR;
          // An unresolved index is opaque magenta, so opaque here too.
          const alpha = alphaOf[effIdx] ?? 1;
          for (const f of FACES) {
            if (hidden(at(x + f.d[0], y + f.d[1], z + f.d[2]), idx)) continue;
            const corners = f.corners.map((c) =>
              toWorld(x + c[0], y + c[1], z + c[2]),
            ) as [Vec3, Vec3, Vec3, Vec3];
            quads.push({
              corners,
              normal: quatRotateVec3(transform.quat, f.normal),
              color,
              alpha,
              material: materialOf[effIdx] ?? MATTE,
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

  // No solid voxels → a finite, origin-anchored scene, so callers never
  // see a NaN center (callers reject empty models earlier; this keeps
  // the direct API NaN-safe).
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
