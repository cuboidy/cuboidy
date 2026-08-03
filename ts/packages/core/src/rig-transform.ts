import type { ManifestPart } from './manifest.js';

// SPEC §7.7 rig transform math, renderer-agnostic. This module is the
// single implementation of "where does a part sit and how is it turned"
// — the editor's three.js view derives its per-group transforms from
// these helpers, and the CLI assembly layer composes world placement
// through computeRestWorldTransforms, so the two renderers can never
// disagree on §7.7 semantics.
//
// Rotations use the SPEC's native convention (§4): Euler degrees, ZXY
// intrinsic order, right-handed. Quaternions are [x, y, z, w] tuples —
// the same component order three.js uses, so the editor can feed them
// to a <group quaternion={...}> prop verbatim.

export type Vec3Tuple = readonly [number, number, number];
export type QuatTuple = readonly [number, number, number, number];

export const QUAT_IDENTITY: QuatTuple = [0, 0, 0, 1];

// Euler degrees (ZXY intrinsic, §4) → quaternion. The expansion is the
// closed form of q_z ⊗ q_x ⊗ q_y and matches three.js
// Quaternion.setFromEuler(new Euler(x, y, z, 'ZXY')) exactly — the
// editor previously used that call, and rig-transform.test.ts pins the
// equivalence with hand-computed vectors.
export function quatFromEulerZXYDeg(e: Vec3Tuple): QuatTuple {
  const hx = (e[0] * Math.PI) / 360; // deg → rad, halved
  const hy = (e[1] * Math.PI) / 360;
  const hz = (e[2] * Math.PI) / 360;
  const c1 = Math.cos(hx);
  const s1 = Math.sin(hx);
  const c2 = Math.cos(hy);
  const s2 = Math.sin(hy);
  const c3 = Math.cos(hz);
  const s3 = Math.sin(hz);
  return [
    s1 * c2 * c3 - c1 * s2 * s3,
    c1 * s2 * c3 + s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

// Hamilton product a ⊗ b: the rotation that applies b first, then a
// (same operand order as three.js `a.multiply(b)`).
export function quatMultiply(a: QuatTuple, b: QuatTuple): QuatTuple {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

// Rotate a vector by a unit quaternion: q v q⁻¹, expanded via the
// standard t = 2(q_v × v) shortcut.
export function quatRotateVec3(q: QuatTuple, v: Vec3Tuple): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ];
}

// A part's local orientation in parent space (§7.7):
//   q_local = q_rotation ⊗ q_pivot ⊗ q_anim
// where `rotation` is the manifest part's rest rotation (parent-space,
// around the pivot), `pivotRot` is the geometry file's `pivot ... rot`,
// and `animRot` is the sampled keyframe rotation. Any absent input is
// identity; each is Euler degrees ZXY. The animation rotates first in
// the rest-local frame, then the two rest terms bring it to the rest
// orientation — so keyframe `rot: [0,0,0]` always reproduces the rest
// pose regardless of how the rest orientation was authored.
export function composePartRotation(
  rotation: Vec3Tuple | undefined,
  pivotRot: Vec3Tuple | undefined,
  animRot?: Vec3Tuple,
): QuatTuple {
  let q = QUAT_IDENTITY;
  if (rotation !== undefined) q = quatFromEulerZXYDeg(rotation);
  if (pivotRot !== undefined) q = quatMultiply(q, quatFromEulerZXYDeg(pivotRot));
  if (animRot !== undefined) q = quatMultiply(q, quatFromEulerZXYDeg(animRot));
  return q;
}

// World-space rest placement of one part: where its pivot sits and how
// its local frame is oriented. A part-local point v lands at
//   v_world = pos + rotate(quat, v − pivot.pos)
export interface WorldTransform {
  pos: [number, number, number];
  quat: QuatTuple;
}

// The animated part of a pose, as SPEC §6.5 defines it. `scale` and
// `visible` are NOT part of the world transform — scale applies to the
// part's own geometry and does not propagate to children (§7.7), and
// visibility is a draw decision — so they ride along here for the
// caller rather than being folded into the matrix.
export interface AnimPose {
  rot: Vec3Tuple;
  pos: Vec3Tuple;
}

// Composes the §7.7 transform down every parent chain:
//   W.pos  = parent.pos + rotate(parent.quat, part.position + anim.pos)
//   W.quat = parent.quat ⊗ (q_rotation ⊗ q_pivot ⊗ q_anim)
// `pivotRots` carries each part's geometry-side `pivot.rot` (absent =
// identity); parts unknown to the map are fine. Renderer-grade
// leniency, matching the editor's rig tree: a parent that names no
// entry in `parts`, or a chain that loops, resolves the offending hop
// as a root instead of failing — validation owns rejecting those
// (§11.5), display layers must not hang on malformed input.
//
// `poses` is optional so the rest pose is literally this function with
// nothing sampled — one implementation of the hierarchy math, which is
// the property that keeps the still renderer and the animated one from
// drifting apart on §7.7.
export function computeWorldTransforms(
  parts: readonly ManifestPart[],
  pivotRots: ReadonlyMap<string, Vec3Tuple>,
  poses?: ReadonlyMap<string, AnimPose>,
): Map<string, WorldTransform> {
  const byName = new Map<string, ManifestPart>();
  for (const p of parts) {
    if (!byName.has(p.name)) byName.set(p.name, p);
  }

  const out = new Map<string, WorldTransform>();
  const resolve = (
    name: string,
    seen: ReadonlySet<string>,
  ): WorldTransform => {
    const cached = out.get(name);
    if (cached !== undefined) return cached;
    const mp = byName.get(name);
    if (mp === undefined) {
      const root: WorldTransform = { pos: [0, 0, 0], quat: QUAT_IDENTITY };
      out.set(name, root);
      return root;
    }
    const base = mp.position ?? [0, 0, 0];
    const pose = poses?.get(name);
    // §6.5: keyframe `pos` is a DELTA on `position`, so it lives in the
    // same (parent) frame and rides the ancestors' rotations with it.
    const local: Vec3Tuple =
      pose === undefined
        ? base
        : [base[0] + pose.pos[0], base[1] + pose.pos[1], base[2] + pose.pos[2]];
    const localQ = composePartRotation(
      mp.rotation,
      pivotRots.get(name),
      pose?.rot,
    );
    let wt: WorldTransform;
    if (mp.parent === undefined || seen.has(name)) {
      wt = { pos: [local[0], local[1], local[2]], quat: localQ };
    } else {
      const parent = resolve(mp.parent, new Set(seen).add(name));
      const off = quatRotateVec3(parent.quat, local);
      wt = {
        pos: [
          parent.pos[0] + off[0],
          parent.pos[1] + off[1],
          parent.pos[2] + off[2],
        ],
        quat: quatMultiply(parent.quat, localQ),
      };
    }
    out.set(name, wt);
    return wt;
  };

  for (const p of parts) resolve(p.name, new Set());
  return out;
}

// The rest pose: the transform chain with nothing sampled.
export function computeRestWorldTransforms(
  parts: readonly ManifestPart[],
  pivotRots: ReadonlyMap<string, Vec3Tuple>,
): Map<string, WorldTransform> {
  return computeWorldTransforms(parts, pivotRots);
}

// The slices of a geometry Part the helpers below read. Structural, so
// this module keeps its single manifest.js dependency.
interface PartExtent {
  size: { w: number; h: number; d: number };
  pivot: {
    pos: { x: number; y: number; z: number };
    rot?: { x: number; y: number; z: number } | undefined;
  };
}

// The geometry-side pivot.rot map the transform chain takes, keyed by
// the RIG's name for each part — which §6.13 renaming can make different
// from the part's own `name`, so callers pass explicit [rigName, part]
// pairs. Four call sites used to build this map by hand.
export function pivotRotsOf(
  parts: Iterable<readonly [string, PartExtent]>,
): Map<string, Vec3Tuple> {
  const out = new Map<string, Vec3Tuple>();
  for (const [name, part] of parts) {
    const rot = part.pivot.rot;
    if (rot !== undefined) out.set(name, [rot.x, rot.y, rot.z]);
  }
  return out;
}

// One AABB over every part's eight world-space box corners. A part's
// world transform places its PIVOT at wt.pos, so each corner goes
// through (corner − pivot) rotated; a part with no transform falls back
// to an origin-anchored identity. `seed` is the caller's empty box:
// camera framing unions in the unit cube at the origin, a selection
// outline starts at ±Infinity and checks finiteness itself.
export function partsWorldBounds(
  parts: Iterable<readonly [string, PartExtent]>,
  transforms: ReadonlyMap<string, WorldTransform>,
  seed?: {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  },
): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] =
    seed === undefined ? [Infinity, Infinity, Infinity] : [...seed.min];
  const max: [number, number, number] =
    seed === undefined ? [-Infinity, -Infinity, -Infinity] : [...seed.max];
  const fallback: WorldTransform = { pos: [0, 0, 0], quat: QUAT_IDENTITY };
  for (const [name, part] of parts) {
    const wt = transforms.get(name) ?? fallback;
    const piv = part.pivot.pos;
    for (const cx of [0, part.size.w]) {
      for (const cy of [0, part.size.h]) {
        for (const cz of [0, part.size.d]) {
          const r = quatRotateVec3(wt.quat, [
            cx - piv.x,
            cy - piv.y,
            cz - piv.z,
          ]);
          for (let i = 0; i < 3; i++) {
            const w = wt.pos[i]! + r[i]!;
            if (w < min[i]!) min[i] = w;
            if (w > max[i]!) max[i] = w;
          }
        }
      }
    }
  }
  return { min, max };
}
