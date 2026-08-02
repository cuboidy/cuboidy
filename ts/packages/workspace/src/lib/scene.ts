import {
  QUAT_IDENTITY,
  publishedSocketFrame,
  quatFromEulerZXYDeg,
  quatMultiply,
  quatRotateVec3,
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
  // How it is turned within that same frame, in ZXY euler degrees.
  //
  // Degrees in the SPEC's convention (§4) even though a scene file is not
  // a Cuboidy file: using a second convention for angles, in a folder full
  // of files that use the first, would be a trap for whoever reads both.
  //
  // Applied about the model origin AFTER the offset, so turning something
  // never moves it. That order is what makes a sword in a hand adjustable
  // — the alternative is hand-editing the host model's socket, which is
  // what this replaces.
  rot?: [number, number, number];
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
  //
  // `at` is where a PAUSED instance is frozen. It has to be per instance:
  // the clock is shared, so a paused actor read from the shared time
  // would keep animating whenever some other actor was playing.
  anim?: { clip: string; playing: boolean; at?: number };
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

// Put a model in the scene. `at` is where the drop resolved to — a
// published socket, or a point on the ground. Omitted (double-click, or
// any caller with no opinion) it goes to the origin.
export function addInstance(
  scene: Scene,
  model: string,
  at?:
    | { kind: 'socket'; host: string; socket: string }
    | { kind: 'ground'; pos: [number, number, number] },
): Scene {
  const inst: Instance = {
    id: freshId(scene, model),
    model,
    placement: { pos: at?.kind === 'ground' ? at.pos : [0, 0, 0] },
  };
  if (at?.kind === 'socket') inst.attach = { to: at.host, socket: at.socket };
  return { ...scene, instances: [...scene.instances, inst] };
}

// Rename an instance, and everything that points at it.
//
// An id is not just a label: an attachment names its host by one. A
// rename that only touched the instance itself would silently detach
// whatever it was carrying — the guests would keep naming a host that no
// longer exists and quietly fall back to the scene root.
//
// Refuses a name another instance already has. parseScene rejects
// duplicate ids on the way in, so producing one here would write a file
// this app cannot read back.
export function renameInstance(scene: Scene, from: string, to: string): Scene {
  const next = to.trim();
  if (next === '' || next === from) return scene;
  if (scene.instances.some((i) => i.id === next)) return scene;
  if (!scene.instances.some((i) => i.id === from)) return scene;
  return {
    ...scene,
    instances: scene.instances.map((i) => ({
      ...i,
      ...(i.id === from && { id: next }),
      ...(i.attach?.to === from && { attach: { ...i.attach, to: next } }),
    })),
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

// Move or turn an instance within the frame it belongs to. A patch, so a
// move gizmo does not have to restate the rotation it is not editing.
//
// An all-zero rotation is DROPPED rather than stored: it is the default,
// and the serialized scene is meant to be read by hand — a file that
// spells out every identity is a file whose real values are hidden among
// them.
export function setPlacement(
  scene: Scene,
  id: string,
  patch: { pos?: [number, number, number]; rot?: [number, number, number] },
): Scene {
  return {
    ...scene,
    instances: scene.instances.map((i) => {
      if (i.id !== id) return i;
      const next: Placement = { pos: patch.pos ?? i.placement.pos };
      const rot = patch.rot ?? i.placement.rot;
      if (rot !== undefined && (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0)) {
        next.rot = rot;
      }
      return { ...i, placement: next };
    }),
  };
}

// Set (or clear) what an instance plays. §6.11 allows one clip at a time,
// which is why this replaces rather than adds.
export function setAnimation(
  scene: Scene,
  id: string,
  anim: { clip: string; playing: boolean; at?: number } | null,
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
  // axes take — `placement` already applied.
  frame: SocketFrame;
  // The socket this instance hangs from, in the HOST MODEL's own space —
  // not the world. Null when it is free, or when the attachment did not
  // resolve.
  //
  // Model space rather than world because the 3D view NESTS a guest under
  // its host: the host's group already carries the host into the world,
  // so what the guest needs on top is exactly this. Nesting is what makes
  // a guest follow while its host is being dragged, rather than jumping
  // to the new socket once the drag commits.
  attachAt: SocketFrame | null;
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
  // `rest: true` ignores every clip and shows the scene at rest. What the
  // rig view is: not "playback paused" (which is per instance and keeps
  // whatever frame each was stopped at) but the arrangement itself, with
  // no animation in the way of reading it.
  opts: { rest?: boolean } = {},
): PlacedInstance[] {
  const models = new Map(library.models.map((m) => [m.dir, m]));
  const byId = new Map(scene.instances.map((i) => [i.id, i]));
  const done = new Map<string, PlacedInstance>();

  const place = (inst: Instance, seen: ReadonlySet<string>): PlacedInstance | null => {
    const cached = done.get(inst.id);
    if (cached !== undefined) return cached;
    const model = models.get(inst.model);
    if (model === undefined) return null; // library no longer offers it

    // The frame the instance's placement is measured in. The world, until
    // an attachment says otherwise.
    let base: SocketFrame = { pos: [0, 0, 0], quat: QUAT_IDENTITY };
    let attachAt: SocketFrame | null = null;
    let problem: string | undefined;

    // §6.11: one clip at a time. Playing reads the shared clock; paused
    // reads the instance's own frozen point, so it shows the frame it was
    // stopped at and stays there while other actors keep moving.
    const clip =
      inst.anim === undefined || opts.rest === true
        ? undefined
        : model.animations.get(inst.anim.clip);
    const poses =
      clip === undefined
        ? null
        : sampleAnimation(
            clip,
            inst.anim?.playing === true ? time : (inst.anim?.at ?? 0),
          );

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
          attachAt = socket;
          base = carryOnto(hostPlaced.frame, socket);
        }
      }
    }

    const placed: PlacedInstance = {
      instance: inst,
      model,
      attachAt,
      frame: applyPlacement(base, inst.placement),
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
// be carried into the host's world frame before a guest sits on it. The
// result is the guest's BASE — where its placement is measured from.
function carryOnto(hostFrame: SocketFrame, socket: SocketFrame): SocketFrame {
  const off = quatRotateVec3(hostFrame.quat, socket.pos);
  return {
    pos: [
      hostFrame.pos[0] + off[0],
      hostFrame.pos[1] + off[1],
      hostFrame.pos[2] + off[2],
    ],
    quat: quatMultiply(hostFrame.quat, socket.quat),
  };
}

// base ∘ placement. Offset first, in the base's axes; the placement's own
// rotation composes on the right, so it turns the model about its origin
// without moving it.
function applyPlacement(base: SocketFrame, placement: Placement): SocketFrame {
  const off = quatRotateVec3(base.quat, placement.pos);
  return {
    pos: [base.pos[0] + off[0], base.pos[1] + off[1], base.pos[2] + off[2]],
    quat:
      placement.rot === undefined
        ? base.quat
        : quatMultiply(base.quat, quatFromEulerZXYDeg(placement.rot)),
  };
}

// A guest under its host.
export interface SceneNode {
  placed: PlacedInstance;
  children: SceneNode[];
}

// ── the panel's tree ──────────────────────────────────────────────────

// A row in the Instances panel. Sockets are rows of their own, between a
// host and whatever hangs off it:
//
//   knight            instance
//     weapon          socket
//       sword         instance
//     crest           socket, empty
//
// Three things fall out of that. An empty socket becomes visible, so what
// a model OFFERS (§6.12) can be read without opening another panel.
// Changing which socket something hangs from becomes a drag onto the
// socket row, instead of a dropdown in a different panel. And every
// instance can carry the same icon — before, a model got a different
// glyph depending on whether it happened to be attached, which made the
// icon say where a row SAT rather than what it WAS.
export type PanelRow =
  | {
      kind: 'instance';
      // Stable React key. Instance ids and socket names live in different
      // namespaces and could collide.
      key: string;
      placed: PlacedInstance;
      children: PanelRow[];
    }
  | {
      kind: 'socket';
      key: string;
      host: string;
      socket: string;
      // False when the host does not (or no longer) publishes it, but
      // something in the scene is attached to that name anyway. The row
      // exists so the guest under it has somewhere to be.
      published: boolean;
      children: PanelRow[];
    };

export function panelTree(placed: readonly PlacedInstance[]): PanelRow[] {
  // Nested by what the scene CLAIMS, not by what resolved: a guest whose
  // socket has gone missing still belongs under the host it names, or the
  // problem has nothing to sit against.
  const instances = buildTree(placed, (p) => p.instance.attach?.to);
  return instances.map(toPanelRow);
}

function toPanelRow(node: SceneNode): PanelRow {
  const host = node.placed.instance.id;
  const published = Object.keys(node.placed.model.manifest.sockets ?? {});
  // Every published socket gets a row, plus any name a guest claims that
  // the host does not publish — appended, so the model's own order (which
  // the author chose) is not disturbed by a broken reference.
  const claimed = node.children.map((c) => c.placed.instance.attach?.socket);
  const extra = [
    ...new Set(
      claimed.filter(
        (s): s is string => s !== undefined && !published.includes(s),
      ),
    ),
  ];

  const rows: PanelRow[] = [...published, ...extra].map((socket) => ({
    kind: 'socket',
    key: `sock:${host}/${socket}`,
    host,
    socket,
    published: published.includes(socket),
    children: node.children
      .filter((c) => c.placed.instance.attach?.socket === socket)
      .map(toPanelRow),
  }));

  return {
    kind: 'instance',
    key: `inst:${host}`,
    placed: node.placed,
    children: rows,
  };
}

// The tree the 3D view draws, nested by what actually RESOLVED.
//
// A guest is a real child of its host's group, which is what makes it
// follow while the host is dragged: a transform gizmo mutates one group's
// matrix imperatively, and a sibling would simply not hear about it until
// the drag committed and the whole scene re-resolved.
//
// An UNRESOLVED attachment is left at the root, because placeScene draws
// it at its own placement in world space; hanging it off the host would
// move it somewhere nothing asked for.
export function drawTree(placed: readonly PlacedInstance[]): SceneNode[] {
  return buildTree(placed, (p) =>
    p.attachAt === null ? undefined : p.instance.attach?.to,
  );
}

function buildTree(
  placed: readonly PlacedInstance[],
  hostOf: (p: PlacedInstance) => string | undefined,
): SceneNode[] {
  const nodes = new Map<string, SceneNode>();
  const hosts = new Map<string, string | undefined>();
  for (const p of placed) {
    nodes.set(p.instance.id, { placed: p, children: [] });
    hosts.set(p.instance.id, hostOf(p));
  }

  // Walking up from the proposed host must terminate. setAttachment
  // refuses a cycle, but a hand-edited scene file is not required to —
  // and a cycle here would leave BOTH instances as somebody's child and
  // neither in the roots, i.e. silently absent from the panel and, now
  // that the 3D view nests too, from the screen.
  const effectiveHost = (id: string): string | undefined => {
    const host = hosts.get(id);
    if (host === undefined || host === id || !nodes.has(host)) return undefined;
    const seen = new Set<string>([id]);
    let cur: string | undefined = host;
    while (cur !== undefined && nodes.has(cur)) {
      if (seen.has(cur)) return undefined; // would close a cycle
      seen.add(cur);
      cur = hosts.get(cur);
    }
    return host;
  };

  const roots: SceneNode[] = [];
  for (const p of placed) {
    const node = nodes.get(p.instance.id)!;
    const host = effectiveHost(p.instance.id);
    if (host === undefined) roots.push(node);
    else nodes.get(host)!.children.push(node);
  }
  return roots;
}
