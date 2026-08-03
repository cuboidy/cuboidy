// A scene: several models placed together, some hanging off others'
// published sockets. This module is the DOCUMENT — the types the file
// stores and the pure edits over them; resolution to world frames lives
// in scene-resolve.ts, the panels' trees in scene-tree.ts.
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
  //
  // NEVER WRITTEN TO THE FILE. A scene records an arrangement — where
  // things are and what they are hooked to. What is playing is a viewing
  // state, the same kind of thing as the camera angle, the view mode and
  // the selection, none of which are saved either. `playing: true` on
  // disk would also mean a file that starts something moving when it is
  // opened, and `at` is a scrubber position: both churn the diff every
  // time the transport is touched, in a format meant to be read by hand.
  anim?: { clip: string; playing: boolean; at?: number };
}

// A scene has no name of its own: its FILE is its name.
//
// It used to carry one, and the file was named after it — two identities
// for one document, with nothing obliging them to agree. Opening
// `sword-knight.scene.json`, editing the name field and saving wrote a
// different file and left the original untouched, which looks exactly
// like saving right up until you look in the folder. Which file is open
// is the app's state, not the document's content.
export interface Scene {
  instances: Instance[];
}

export const emptyScene = (): Scene => ({ instances: [] });

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
