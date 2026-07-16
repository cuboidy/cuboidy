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

// Composes the §7.7 rest-pose transform down every parent chain:
//   W.pos  = parent.pos + rotate(parent.quat, part.position)
//   W.quat = parent.quat ⊗ (q_rotation ⊗ q_pivot)
// `pivotRots` carries each part's geometry-side `pivot.rot` (absent =
// identity); parts unknown to the map are fine. Renderer-grade
// leniency, matching the editor's rig tree: a parent that names no
// entry in `parts`, or a chain that loops, resolves the offending hop
// as a root instead of failing — validation owns rejecting those
// (§11.5), display layers must not hang on malformed input.
export function computeRestWorldTransforms(
  parts: readonly ManifestPart[],
  pivotRots: ReadonlyMap<string, Vec3Tuple>,
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
    const local: Vec3Tuple = mp.position ?? [0, 0, 0];
    const localQ = composePartRotation(mp.rotation, pivotRots.get(name));
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
