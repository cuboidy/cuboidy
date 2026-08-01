import type { Manifest } from './manifest.js';
import type { ResolvedPart } from './project.js';
import {
  computeWorldTransforms,
  quatFromEulerZXYDeg,
  quatMultiply,
  quatRotateVec3,
  type AnimPose,
  type QuatTuple,
  type Vec3Tuple,
  type WorldTransform,
} from './rig-transform.js';

// SPEC §7.8 + §6.12: where a published socket IS, in world space.
//
// This lives in core rather than in whichever app happens to need it
// first, because it is the join two packages meet at: a host offers a
// frame, a guest is placed on it, and both sides must compute the same
// point or the two models come apart. `cuboidy-snap --attach` will want
// exactly this, and a second implementation is how the halves drift.

export interface SocketFrame {
  // World position of the socket's origin.
  pos: [number, number, number];
  // World orientation: the host part's, composed with the socket's own
  // `rot` (§7.8). A guest's axes align to this.
  quat: QuatTuple;
}

// The frame of one socket declared on one part, given that part's world
// transform.
//
// A part's world transform places its PIVOT at `world.pos`, and a local
// point `v` lands at `world.pos + world.quat · (v − pivot.pos)`. A socket
// is a point in that same local space (§7.8: "in the host part's local
// space after the host part's own pivot transform has been applied"), so
// it goes through the identical mapping — which is the reason to write it
// once here rather than re-derive it per renderer.
export function socketFrameOn(
  part: ResolvedPart['part'],
  world: WorldTransform,
  socketName: string,
): SocketFrame | null {
  const socket = part.sockets.find((s) => s.name === socketName);
  if (socket === undefined) return null;
  const local: Vec3Tuple = [
    socket.pos.x - part.pivot.pos.x,
    socket.pos.y - part.pivot.pos.y,
    socket.pos.z - part.pivot.pos.z,
  ];
  const off = quatRotateVec3(world.quat, local);
  const rot: Vec3Tuple =
    socket.rot === undefined
      ? [0, 0, 0]
      : [socket.rot.x, socket.rot.y, socket.rot.z];
  return {
    pos: [world.pos[0] + off[0], world.pos[1] + off[1], world.pos[2] + off[2]],
    quat: quatMultiply(world.quat, quatFromEulerZXYDeg(rot)),
  };
}

// The frame a model offers under a PUBLISHED name (§6.12) — the only name
// a consumer is meant to use. Returns null when the model does not publish
// it, or when what it publishes does not resolve; both are the consumer-
// side `unknown` §11.6 describes, and the caller decides how loudly to say
// so.
//
// `poses` samples an animated host: a socket on a swinging arm moves with
// it, so anything attached does too. Omit it for the rest pose.
export function publishedSocketFrame(
  manifest: Manifest,
  parts: ReadonlyMap<string, ResolvedPart>,
  publishedName: string,
  poses?: ReadonlyMap<string, AnimPose>,
): SocketFrame | null {
  const target = manifest.sockets?.[publishedName];
  if (target === undefined) return null;
  const resolved = parts.get(target.part);
  if (resolved === undefined) return null;
  const world = worldTransformsFor(manifest, parts, poses).get(target.part);
  if (world === undefined) return null;
  return socketFrameOn(resolved.part, world, target.socket);
}

// Rest-or-posed world transforms for a resolved model. Separate so a
// caller placing several guests on one host computes the chain once.
export function worldTransformsFor(
  manifest: Manifest,
  parts: ReadonlyMap<string, ResolvedPart>,
  poses?: ReadonlyMap<string, AnimPose>,
): Map<string, WorldTransform> {
  const pivotRots = new Map<string, Vec3Tuple>();
  for (const [name, r] of parts) {
    const rot = r.part.pivot.rot;
    if (rot !== undefined) pivotRots.set(name, [rot.x, rot.y, rot.z]);
  }
  return computeWorldTransforms(manifest.parts, pivotRots, poses);
}
