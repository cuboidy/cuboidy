import {
  QUAT_IDENTITY,
  composeFrames,
  publishedSocketFrame,
  quatFromEulerZXYDeg,
  quatMultiply,
  quatRotateVec3,
  sampleAnimation,
  type Pose,
  type SocketFrame,
} from '@cuboidy/core';
import type { Library, LibraryModel } from './library.js';
import type { Instance, Placement, Scene } from './scene-doc.js';

// Resolution: every instance of the scene document taken to a world
// frame, hosts before guests. Pure placement math over scene-doc's types
// — nothing here reads or writes the document.

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
        // A Pose is structurally an AnimPose (rot/pos plus fields the
        // rig ignores), so the sampled map passes straight through.
        const socket = publishedSocketFrame(
          hostPlaced.model.manifest,
          hostPlaced.model.parts,
          inst.attach.socket,
          hostPlaced.poses ?? undefined,
        );
        if (socket === null) {
          problem = `'${hostPlaced.model.dir}' does not publish a socket called '${inst.attach.socket}'`;
        } else {
          attachAt = socket;
          // The socket frame is in the HOST MODEL's own space; carry it
          // into the host's world frame for the guest's BASE — where its
          // placement is measured from.
          base = composeFrames(hostPlaced.frame, socket);
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
