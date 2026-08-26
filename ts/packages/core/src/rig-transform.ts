import type { Pose } from './animation.js';
import { resolveHierarchy } from './forest.js';
import type { Part, Vec3Tuple } from './geometry/types.js';
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

// A rigid placement: where something sits and how it is turned. ONE shape,
// under the two names the two uses have — `WorldTransform` for a part,
// `SocketFrame` (socket-frame.ts) for an attachment point. They were two
// identical declarations, which TypeScript lets you pass interchangeably and
// C# does not: the port would have shipped two records that cannot be
// assigned to each other unless someone noticed they are the same thing.
export interface Frame {
  pos: [number, number, number];
  quat: QuatTuple;
}

// World-space placement of one part: where its pivot sits and how its local
// frame is oriented. A part-local point v lands at
//   v_world = pos + rotate(quat, v − pivot.pos)
export type WorldTransform = Frame;

// `Pose` (animation.ts) is what the functions below take. Only `rot` and
// `pos` reach the world transform: scale applies to the part's own geometry
// and does not propagate to children (§7.7), and visibility is a draw
// decision, so they ride along on the pose for the caller rather than being
// folded into the matrix. That used to be expressed as two narrower
// interfaces declared here, which TypeScript accepted a `Pose` for and C#
// would not — see the note on `Pose`.

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
  poses?: ReadonlyMap<string, Pose>,
): Map<string, WorldTransform> {
  const byName = new Map<string, ManifestPart>();
  for (const p of parts) {
    if (!byName.has(p.name)) byName.set(p.name, p);
  }

  // The shared lenient policy (forest.ts): a parent that is absent, names
  // this part, names no part, or would close a cycle makes the part a root.
  // `order` puts every part after its effective parent, so one pass down the
  // list composes the whole rig, and there is no way to compose a part into
  // itself. (The traversal still recurses, inside `resolveHierarchy`'s
  // ordering pass; a chain some tens of thousands deep overflows there. Both
  // walks did before, sooner.)
  const { parentOf, order } = resolveHierarchy(
    parts,
    (p) => p.name,
    (p) => p.parent,
  );

  const out = new Map<string, WorldTransform>();
  for (const name of order) {
    const mp = byName.get(name)!;
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

    const parentName = parentOf.get(name);
    const parent = parentName === undefined ? undefined : out.get(parentName)!;
    if (parent === undefined) {
      out.set(name, { pos: [local[0], local[1], local[2]], quat: localQ });
      continue;
    }
    const off = quatRotateVec3(parent.quat, local);
    out.set(name, {
      pos: [
        parent.pos[0] + off[0],
        parent.pos[1] + off[1],
        parent.pos[2] + off[2],
      ],
      quat: quatMultiply(parent.quat, localQ),
    });
  }
  return out;
}

// SPEC §7.7 / §6.5: where a point written in a part's LOCAL space lands in
// world space.
//
//   world.pos + world.quat · ((v − pivot) ⊙ scale)
//
// Scale acts on the pivot-relative offset, so a part grows about its pivot
// rather than about the grid origin, and it does NOT propagate to children —
// which is why it is applied here, per part, instead of being folded into
// WorldTransform.
//
// This is the one statement of that rule. It was written three times outside
// this module — the software rasterizer, the GIF runner and the editor's
// three.js tree — and a second implementation ports none of them, so `scale`
// would have arrived in C# as a field of `Pose` with its meaning left in
// code the port does not have.
// SPEC §6.2 + §6.5: the rest scale and the animated scale are the same
// operator reached twice — same axes, same pivot, and neither reaches the
// part's children — so a part's total scale is their per-axis product and
// the order they are written in does not matter. Stated here, next to the
// one place that consumes it, because a second implementation that gets
// this wrong produces a model that is subtly the wrong size only while an
// animation is playing.
//
// Undefined on either side reads as [1,1,1]; undefined on both stays
// undefined, so the overwhelmingly common case allocates nothing.
export function composeScale(
  rest: Vec3Tuple | undefined,
  anim: Vec3Tuple | undefined,
): Vec3Tuple | undefined {
  if (rest === undefined) return anim;
  if (anim === undefined) return rest;
  return [rest[0] * anim[0], rest[1] * anim[1], rest[2] * anim[2]];
}

export function localPointToWorld(
  local: Vec3Tuple,
  pivot: Vec3Tuple,
  scale: Vec3Tuple | undefined,
  world: WorldTransform,
): Vec3Tuple {
  const [sx, sy, sz] = scale ?? [1, 1, 1];
  const r = quatRotateVec3(world.quat, [
    (local[0] - pivot[0]) * sx,
    (local[1] - pivot[1]) * sy,
    (local[2] - pivot[2]) * sz,
  ]);
  return [world.pos[0] + r[0], world.pos[1] + r[1], world.pos[2] + r[2]];
}

// The rest pose: the transform chain with nothing sampled.
export function computeRestWorldTransforms(
  parts: readonly ManifestPart[],
  pivotRots: ReadonlyMap<string, Vec3Tuple>,
): Map<string, WorldTransform> {
  return computeWorldTransforms(parts, pivotRots);
}

// The geometry-side pivot.rot map the transform chain takes, keyed by
// the RIG's name for each part — which §6.13 renaming can make different
// from the part's own `name`, so callers pass explicit [rigName, part]
// pairs. Four call sites used to build this map by hand.
export function pivotRotsOf(
  parts: Iterable<readonly [string, Part]>,
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
  parts: Iterable<readonly [string, Part]>,
  transforms: ReadonlyMap<string, WorldTransform>,
  seed?: {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  },
  // Each part's total scale (§6.2 rest × §6.5 animated), by the same names
  // `transforms` is keyed by. Omitted or absent for a name reads as
  // [1,1,1] — the case every model without a rest `scale` is in. Passing
  // it matters because a scaled part's corners move: leave it out on a
  // model that uses `scale` and the box comes back too small, which a
  // caller framing a camera will see as the model cropped.
  scales?: ReadonlyMap<string, Vec3Tuple | undefined>,
): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] =
    seed === undefined ? [Infinity, Infinity, Infinity] : [...seed.min];
  const max: [number, number, number] =
    seed === undefined ? [-Infinity, -Infinity, -Infinity] : [...seed.max];
  const fallback: WorldTransform = { pos: [0, 0, 0], quat: QUAT_IDENTITY };
  for (const [name, part] of parts) {
    const wt = transforms.get(name) ?? fallback;
    const piv = part.pivot.pos;
    const [sx, sy, sz] = scales?.get(name) ?? [1, 1, 1];
    for (const cx of [0, part.size.w]) {
      for (const cy of [0, part.size.h]) {
        for (const cz of [0, part.size.d]) {
          const r = quatRotateVec3(wt.quat, [
            (cx - piv.x) * sx,
            (cy - piv.y) * sy,
            (cz - piv.z) * sz,
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
