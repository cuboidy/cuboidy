import { publishedSocketFrame, quatMultiply, quatRotateVec3 } from '@cuboidy/core';
import type { SocketFrame } from '@cuboidy/core';
import type { PlacedInstance } from './scene.js';

// Where a model dragged from the library will land.
//
// Resolved as the pointer moves, so the answer can be DRAWN before the
// drop commits — a gesture that says "put it here" and then puts it at
// the origin is worse than no gesture, which is what this replaces.
//
// Two outcomes, in priority order:
//   1. A published socket, if one is near the pointer on screen.
//   2. The ground, snapped to whole units.
//
// Screen proximity rather than a mesh raycast for the socket, on purpose.
// A model publishes a handful of sockets, so testing all of them costs
// nothing, and "near the hand" is a target a person can hit — where the
// hand's own surface, a few pixels of it at some angles, is not.

export const SOCKET_GRAB_PX = 44;

export type DropTarget =
  | { kind: 'socket'; host: string; socket: string; frame: SocketFrame }
  | { kind: 'ground'; pos: [number, number, number] };

// A key that changes only when the ANSWER changes. The 3D feedback
// re-renders on this rather than on pointer movement: the ground point is
// snapped, so crossing a cell boundary is an event and moving within one
// is not.
export function dropKey(t: DropTarget | null): string {
  if (t === null) return '';
  return t.kind === 'socket'
    ? `s:${t.host}/${t.socket}`
    : `g:${t.pos[0]},${t.pos[1]},${t.pos[2]}`;
}

export interface Ray {
  origin: [number, number, number];
  // Unit direction.
  dir: [number, number, number];
}

// One published socket of one placed instance, in world space.
export interface SocketCandidate {
  host: string;
  socket: string;
  frame: SocketFrame;
}

// Every published socket in the scene, in world space.
//
// At rest: what a model OFFERS does not depend on the clock, and a target
// that drifted away from under the pointer while an animation played
// would be a target you cannot hit. The guest still rides the animated
// socket once attached — that is placeScene's job, and it samples.
export function socketCandidates(
  placed: readonly PlacedInstance[],
  // Skip this instance's own sockets, when re-targeting an existing one.
  exclude?: string,
): SocketCandidate[] {
  const out: SocketCandidate[] = [];
  for (const p of placed) {
    if (p.instance.id === exclude) continue;
    for (const name of Object.keys(p.model.manifest.sockets ?? {})) {
      const local = publishedSocketFrame(p.model.manifest, p.model.parts, name);
      if (local === null) continue;
      out.push({
        host: p.instance.id,
        socket: name,
        // The socket frame is in the HOST MODEL's space; the instance may
        // be anywhere, so it has to be carried into the world.
        frame: carry(p.frame, local),
      });
    }
  }
  return out;
}

function carry(host: SocketFrame, local: SocketFrame): SocketFrame {
  const off = quatRotateVec3(host.quat, local.pos);
  return {
    pos: [host.pos[0] + off[0], host.pos[1] + off[1], host.pos[2] + off[2]],
    quat: quatMultiply(host.quat, local.quat),
  };
}

// Project a world point to pixels within the canvas, or null when it is
// behind the camera. Supplied by the view, which owns the camera.
export type ProjectToPixels = (
  p: readonly [number, number, number],
) => [number, number] | null;

export function resolveDrop(
  ray: Ray,
  pointerPx: readonly [number, number],
  candidates: readonly SocketCandidate[],
  project: ProjectToPixels,
): DropTarget | null {
  let best: SocketCandidate | null = null;
  let bestDist = SOCKET_GRAB_PX;
  for (const c of candidates) {
    const at = project(c.frame.pos);
    if (at === null) continue;
    const d = Math.hypot(at[0] - pointerPx[0], at[1] - pointerPx[1]);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (best !== null) {
    return {
      kind: 'socket',
      host: best.host,
      socket: best.socket,
      frame: best.frame,
    };
  }
  const ground = groundPoint(ray);
  return ground === null ? null : { kind: 'ground', pos: ground };
}

// Where the ray meets y = 0, snapped to whole units.
//
// Whole units because a scene is measured at voxel scale and a model
// dropped at 3.7194 is a number nobody chose. Null when the ray runs
// parallel to the ground or away from it — looking up at the horizon has
// no answer, and inventing one would drop models behind the camera.
export function groundPoint(ray: Ray): [number, number, number] | null {
  const dy = ray.dir[1];
  if (Math.abs(dy) < 1e-6) return null;
  const t = -ray.origin[1] / dy;
  if (t <= 0) return null;
  return [
    Math.round(ray.origin[0] + ray.dir[0] * t),
    0,
    Math.round(ray.origin[2] + ray.dir[2] * t),
  ];
}
