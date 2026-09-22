import {
  composePartRotation,
  composeScale,
  type Pose,
  type Vec3Tuple,
} from '@cuboidy/core';
import type { RigNode } from './rig.js';

// SPEC §7.7, as three nested transforms — the one statement of it that both
// renderers in this repository read.
//
//   v_parent = part.position + anim.pos
//            + M_rot · M_pivot · M_anim · S_total · (v_local − pivot.pos)
//
// Expressed as groups: put a group at `position` (so its origin IS the
// part's pivot), turn it by `quaternion`, scale a group inside it by
// `scale`, and offset the mesh by `pivotOffset` within that. Children of
// the part hang off the FIRST group — they ride its position and rotation
// but not its scale, which §7.7 scopes to the part's own voxels and §6.2
// places at the pivot in parent space.
//
// It lives here, rather than in either renderer, because there are two: the
// r3f component tree (`@cuboidy/r3f`'s RiggedParts) and the imperative
// Object3D builder next door. Two spellings of a formula with a pivot
// rotation, an animated rotation and two multiplied scales in it is how one
// of them quietly stops agreeing with `cuboidy-snap`.

export interface PartPlacement {
  // Parent-relative, on the group whose origin is the part's pivot.
  position: [number, number, number];
  // q_rotation · q_pivot · q_anim (§7.7), as [x, y, z, w].
  quaternion: [number, number, number, number];
  // S_total = rest scale ⊙ animated scale (§6.2), about the pivot.
  scale: [number, number, number];
  // Where the voxel grid's own origin goes inside the scaled group: −pivot,
  // so the grid's `pivot.pos` lands on the group origin.
  pivotOffset: [number, number, number];
  // §6.5 `visible`, keyed by the animation. A part hidden by the VIEWER is
  // a separate matter and stays with the caller.
  visible: boolean;
}

// The pose a part holds when no clip is playing, and what a part absent
// from a sampled pose map falls back to (§6.5 defaults).
export const REST_POSE: Pose = {
  rot: [0, 0, 0],
  pos: [0, 0, 0],
  scale: [1, 1, 1],
  visible: true,
};

export function partPlacement(
  node: RigNode,
  pose: Pose = REST_POSE,
): PartPlacement {
  const basePos: Vec3Tuple = node.manifestPart?.position ?? [0, 0, 0];
  const pivotRot = node.part.pivot.rot;
  const piv = node.part.pivot.pos;

  // q_total = q_rotation · q_pivot · q_anim (§7.7): the animation rotation
  // applies first in the rest-local frame, then the geometry-side
  // pivot.rot, then the manifest part's parent-space `rotation`. All three
  // are Euler degrees, ZXY intrinsic (§4); three.js is right-handed like
  // the native frame, so no handedness flip (that's Unity-only, §4).
  const q = composePartRotation(
    node.manifestPart?.rotation,
    pivotRot === undefined ? undefined : [pivotRot.x, pivotRot.y, pivotRot.z],
    pose.rot,
  );

  // S_total = scale ⊙ anim.scale (§6.2). Both act per axis about the same
  // pivot and neither reaches the children, so they commute into one
  // product and the order they compose in is unobservable.
  const s = composeScale(node.manifestPart?.scale, pose.scale) ?? [1, 1, 1];

  return {
    position: [
      basePos[0] + pose.pos[0],
      basePos[1] + pose.pos[1],
      basePos[2] + pose.pos[2],
    ],
    quaternion: [q[0], q[1], q[2], q[3]],
    scale: [s[0], s[1], s[2]],
    pivotOffset: [-piv.x, -piv.y, -piv.z],
    visible: pose.visible,
  };
}
