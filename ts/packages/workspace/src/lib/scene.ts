import {
  publishedSocketFrame,
  sampleAnimation,
  type AnimPose,
  type Pose,
  type SocketFrame,
} from '@cuboidy/core';
import type { Library, LibraryModel } from './library.js';

// A scene: several models placed together, some hanging off others'
// published sockets.
//
// This is the format the SPEC deliberately does not define. A model says
// what it offers (§6.12) and never what it is used in, so the arrangement
// belongs to the app that arranges — see tmp/composition-design.md. Keeping
// it here rather than in core is that decision made concrete.
//
// FLAT, not nested. An instance names its host by id; the tree is derived.
// Nesting reads well in a file and is worse to work with: re-parenting
// becomes a move between arrays, and a cycle becomes structurally
// unrepresentable in a way that hides the error instead of reporting it.

export interface Placement {
  // Where this instance's MODEL ORIGIN sits (SPEC §6.12), in the frame it
  // belongs to: the scene for a free instance, the socket for an attached
  // one — where it is an additional offset on top of the socket frame.
  pos: [number, number, number];
}

export interface Instance {
  id: string;
  // Which library model this is. Not a path: the library is the namespace.
  model: string;
  // Absent → a free instance, placed in scene space. Present → attached to
  // another instance's PUBLISHED socket, and carried by it.
  attach?: { to: string; socket: string };
  placement: Placement;
  // What this instance is playing (SPEC §6.11: at most one clip at a time,
  // per model). Per INSTANCE, not per model: two copies of one model in a
  // scene are two actors and need not be in step.
  anim?: { clip: string; playing: boolean };
}

export interface Scene {
  name: string;
  instances: Instance[];
}

export const emptyScene = (name = 'untitled'): Scene => ({ name, instances: [] });

// Ids are per-scene and human-legible (`knight`, `knight-2`), because they
// show up in the tree and in the saved file, and a uuid would make both
// unreadable for no benefit at this scale.
export function freshId(scene: Scene, model: string): string {
  const taken = new Set(scene.instances.map((i) => i.id));
  if (!taken.has(model)) return model;
  for (let n = 2; ; n += 1) {
    const candidate = `${model}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function addInstance(scene: Scene, model: string): Scene {
  return {
    ...scene,
    instances: [
      ...scene.instances,
      { id: freshId(scene, model), model, placement: { pos: [0, 0, 0] } },
    ],
  };
}

export function removeInstance(scene: Scene, id: string): Scene {
  // Anything hanging off it is detached rather than deleted: removing one
  // model should not silently take others with it.
  return {
    ...scene,
    instances: scene.instances
      .filter((i) => i.id !== id)
      .map((i) => (i.attach?.to === id ? detachOne(i) : i)),
  };
}

function detachOne(i: Instance): Instance {
  const { attach: _drop, ...rest } = i;
  return rest;
}

// Set (or clear) what an instance plays. §6.11 allows one clip at a time,
// which is why this replaces rather than adds.
export function setAnimation(
  scene: Scene,
  id: string,
  anim: { clip: string; playing: boolean } | null,
): Scene {
  return {
    ...scene,
    instances: scene.instances.map((i) => {
      if (i.id !== id) return i;
      if (anim === null) {
        const { anim: _drop, ...rest } = i;
        return rest;
      }
      return { ...i, anim };
    }),
  };
}

// Is anything in the scene playing? The clock only runs when something
// needs it, so a still scene costs no frames.
export function anyPlaying(scene: Scene): boolean {
  return scene.instances.some((i) => i.anim?.playing === true);
}

// Attach `id` to `host`'s published socket, or detach it (`target` null).
// Refuses a cycle: an instance cannot end up carried by itself, directly
// or through a chain.
export function setAttachment(
  scene: Scene,
  id: string,
  target: { to: string; socket: string } | null,
): Scene {
  if (target !== null && wouldCycle(scene, id, target.to)) return scene;
  return {
    ...scene,
    instances: scene.instances.map((i) =>
      i.id !== id ? i : target === null ? detachOne(i) : { ...i, attach: target },
    ),
  };
}

function wouldCycle(scene: Scene, id: string, host: string): boolean {
  const byId = new Map(scene.instances.map((i) => [i.id, i]));
  let cur: string | undefined = host;
  const seen = new Set<string>();
  while (cur !== undefined) {
    if (cur === id) return true;
    if (seen.has(cur)) return true; // already-broken scene; do not add to it
    seen.add(cur);
    cur = byId.get(cur)?.attach?.to;
  }
  return false;
}

// ── resolution ────────────────────────────────────────────────────────

// One instance ready to draw: its model and where its origin goes.
export interface PlacedInstance {
  instance: Instance;
  model: LibraryModel;
  // World position of the model's ORIGIN (§6.12) and the orientation its
  // axes take.
  frame: SocketFrame;
  // This instance's sampled pose, or null for the rest pose. Passed
  // straight to the renderer, AND used to place anything attached to it —
  // a socket on a swinging arm moves, so its guest moves.
  poses: Map<string, Pose> | null;
  // Why it is not attached where it says. Shown against the instance
  // rather than thrown: a scene referencing a socket a model has since
  // stopped publishing must still open.
  problem?: string;
}

// Resolve every instance to a world frame, hosts before guests.
//
// The guest's MODEL ORIGIN goes on the socket (§6.12) — not its root
// part's pivot, since §6.2 permits several roots and there may be no
// single such point.
export function placeScene(
  scene: Scene,
  library: Library,
  // Seconds since playback started. One clock for the whole scene, so two
  // instances playing the same clip stay in step rather than drifting
  // apart by however long apart they were started.
  time = 0,
): PlacedInstance[] {
  const models = new Map(library.models.map((m) => [m.dir, m]));
  const byId = new Map(scene.instances.map((i) => [i.id, i]));
  const done = new Map<string, PlacedInstance>();

  const place = (inst: Instance, seen: ReadonlySet<string>): PlacedInstance | null => {
    const cached = done.get(inst.id);
    if (cached !== undefined) return cached;
    const model = models.get(inst.model);
    if (model === undefined) return null; // library no longer offers it

    let frame: SocketFrame = {
      pos: [...inst.placement.pos],
      quat: [0, 0, 0, 1],
    };
    let problem: string | undefined;

    // §6.11: one clip at a time. A paused instance holds its pose at t=0
    // rather than snapping to rest, so pausing shows you the frame you
    // were looking at.
    const clip =
      inst.anim === undefined ? undefined : model.animations.get(inst.anim.clip);
    const poses =
      clip === undefined
        ? null
        : sampleAnimation(clip, inst.anim?.playing === true ? time : 0);

    if (inst.attach !== undefined && !seen.has(inst.id)) {
      const host = byId.get(inst.attach.to);
      const hostPlaced =
        host === undefined ? null : place(host, new Set(seen).add(inst.id));
      if (hostPlaced === null) {
        problem = `attached to '${inst.attach.to}', which is not in the scene`;
      } else {
        // Sampled with the HOST's poses: the whole point of attaching to
        // a socket rather than to a position is that the socket moves.
        const socket = publishedSocketFrame(
          hostPlaced.model.manifest,
          hostPlaced.model.parts,
          inst.attach.socket,
          hostPlaced.poses === null ? undefined : toAnimPoses(hostPlaced.poses),
        );
        if (socket === null) {
          problem = `'${hostPlaced.model.dir}' does not publish a socket called '${inst.attach.socket}'`;
        } else {
          frame = composeOnto(hostPlaced.frame, socket, inst.placement.pos);
        }
      }
    }

    const placed: PlacedInstance = {
      instance: inst,
      model,
      frame,
      poses,
      ...(problem !== undefined && { problem }),
    };
    done.set(inst.id, placed);
    return placed;
  };

  const out: PlacedInstance[] = [];
  for (const inst of scene.instances) {
    const placed = place(inst, new Set());
    if (placed !== null) out.push(placed);
  }
  return out;
}

// The rig transform only needs rot/pos; `scale` and `visible` are the
// renderer's business (§7.7 — scale does not propagate to children).
function toAnimPoses(poses: ReadonlyMap<string, Pose>): Map<string, AnimPose> {
  const out = new Map<string, AnimPose>();
  for (const [name, p] of poses) out.set(name, { rot: p.rot, pos: p.pos });
  return out;
}

// The socket frame is computed in the HOST MODEL's own space, so it has to
// be carried into the host's world frame before a guest sits on it.
function composeOnto(
  hostFrame: SocketFrame,
  socket: SocketFrame,
  offset: readonly [number, number, number],
): SocketFrame {
  const quat = quatMul(hostFrame.quat, socket.quat);
  const rotated = rotate(hostFrame.quat, socket.pos);
  const local = rotate(quat, offset);
  return {
    pos: [
      hostFrame.pos[0] + rotated[0] + local[0],
      hostFrame.pos[1] + rotated[1] + local[1],
      hostFrame.pos[2] + rotated[2] + local[2],
    ],
    quat,
  };
}

type Q = readonly [number, number, number, number];

function quatMul(a: Q, b: Q): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function rotate(q: Q, v: readonly [number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

// The tree the model panel shows: free instances at the top, each with
// whatever hangs off it.
export interface SceneNode {
  placed: PlacedInstance;
  children: SceneNode[];
}

export function sceneTree(placed: readonly PlacedInstance[]): SceneNode[] {
  const nodes = new Map<string, SceneNode>();
  for (const p of placed) nodes.set(p.instance.id, { placed: p, children: [] });
  const roots: SceneNode[] = [];
  for (const p of placed) {
    const node = nodes.get(p.instance.id)!;
    const hostId = p.instance.attach?.to;
    const host = hostId === undefined ? undefined : nodes.get(hostId);
    // An unresolved attachment shows at the top rather than vanishing —
    // the problem is reported on the row.
    if (host === undefined || host === node) roots.push(node);
    else host.children.push(node);
  }
  return roots;
}
