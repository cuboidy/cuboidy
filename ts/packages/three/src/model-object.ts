import {
  quatFromEulerZXYDeg,
  type Manifest,
  type Pose,
  type ResolvedPart,
  type Vec3Tuple,
} from '@cuboidy/core';
import { Group, Mesh, type Camera, type Object3D } from 'three';
import { buildPartGeometry } from './part-geometry.js';
import { buildPartMaterials, disposeMaterials } from './part-materials.js';
import { partPlacement, REST_POSE } from './part-placement.js';
import { buildRigTreeOf, type RigNode } from './rig.js';
import {
  makeTranslucentSorter,
  type SortTranslucent,
} from './translucent-order.js';

// A whole Cuboidy package as one three.js object — the entry point for a
// host that has no React: a thumbnail renderer, a game's asset loader, a
// page that loaded three.js from a CDN and wants to show a model.
//
// `@cuboidy/r3f`'s RiggedParts is the same tree declared as components.
// Both place their parts through `partPlacement`, so the two cannot
// disagree about SPEC §7.7 — which is why that function exists rather than
// the formula being written out twice.

// A model as `resolveProject` leaves it: the manifest, and every part's
// shape with the palette its indices mean something against.
export interface ModelSource {
  manifest: Manifest | undefined;
  // §6.13, keyed by the name the rig uses.
  parts: ReadonlyMap<string, ResolvedPart>;
}

export interface ModelObject {
  // Add this to a scene. Its origin is the model's origin (§6.12) — the
  // point a socket frame and a scene placement are both measured from.
  object: Group;
  // Per part, the group whose origin sits on that part's pivot and whose
  // orientation is the part's. Children of it ride the part without being
  // scaled by it. Exposed so a caller can hang its own marker on a part.
  partObjects: ReadonlyMap<string, Group>;
  // Sampled poses (core's `sampleAnimation`), or null for the rest pose. A
  // part absent from the map falls back to rest. Anything attached to a
  // socket moves with it.
  setPose(poses: ReadonlyMap<string, Pose> | null): void;
  // Parts this OBJECT does not draw, whatever the pose says — the
  // consumer's own mask over §6.5 `visible`, which only ever takes away.
  // The format has no rest-pose visibility, so a package holding three hairs
  // draws all three until a consumer chooses; a clip's `visible` key cannot
  // undo that choice, because the two are written on different nodes. Only
  // the part's OWN voxels go: its child parts and anything attached to its
  // sockets are left as they were, so hiding a torso does not take the arms
  // with it. Each call replaces the previous mask; an empty one shows every
  // part again. The same contract as the Godot addon's `SetHiddenParts`.
  setHiddenParts(names: Iterable<string>): void;
  // Hang `guest` on one of the PUBLISHED sockets (§6.12 — the only names a
  // consumer is meant to use). Returns the detach, or null when the model
  // does not publish that name, or what it publishes does not resolve:
  // the consumer-side `unknown` of §11.6, which the caller decides how
  // loudly to report.
  //
  // The guest is parented into this tree rather than placed at a computed
  // world frame, so it follows the host through an animation, a drag, or a
  // parent of its own moving, with no per-frame bookkeeping. It keeps its
  // own scale: a held sword travels to the right place at its own size
  // rather than being deformed by whatever the wielder is doing (§7.8).
  attach(publishedName: string, guest: Object3D): (() => void) | null;
  // Call once per frame, BEFORE `renderer.render`, with the camera the
  // frame is drawn from — see translucent-order.ts for why this cannot be
  // hung on `onBeforeRender`. A model with no translucent colour, which is
  // most of them, makes this a call that returns.
  sortTranslucent: SortTranslucent;
  // Frees every geometry and material this built. The caller still owns
  // whatever it attached.
  dispose(): void;
}

interface PartEntry {
  node: RigNode;
  // Origin on the pivot, carrying position + rotation. Child PARTS and
  // socket groups hang here, so neither inherits this part's scale — §7.7
  // scopes S_total to the part's own voxels, and a guest on a socket keeps
  // its own size (§7.8).
  pivot: Group;
  // Carries S_total.
  scaled: Group;
  // Carries −pivot, and the §6.5 `visible` flag.
  mesh: Group;
}

interface Attachment {
  part: PartEntry;
  // The socket's position in the part's voxel-local space.
  local: Vec3Tuple;
  group: Group;
}

export function buildModelObject(model: ModelSource): ModelObject {
  const root = new Group();
  const entries = new Map<string, PartEntry>();
  const sorters: SortTranslucent[] = [];
  const disposals: (() => void)[] = [];
  const attachments: Attachment[] = [];

  const build = (node: RigNode, parent: Group): void => {
    const pivot = new Group();
    const scaled = new Group();
    const meshGroup = new Group();
    const entry: PartEntry = { node, pivot, scaled, mesh: meshGroup };

    const resolved = model.parts.get(node.part.name);
    if (resolved !== undefined) {
      const built = buildPartGeometry(node.part, resolved.palette);
      // An all-air part draws nothing: a Mesh with an empty index buffer
      // is a draw call that produces no pixels.
      if ((built.geometry.getIndex()?.count ?? 0) > 0) {
        const materials = buildPartMaterials(built.materials);
        // A BARE material rather than a one-element array when there is
        // only one: an array against a geometry whose groups were left off
        // draws nothing at all in three.js, and the single-bucket case is
        // every model that says nothing about §7.4 materials.
        const mesh = new Mesh(
          built.geometry,
          materials.length === 1 ? materials[0]! : materials,
        );
        meshGroup.add(mesh);
        sorters.push(
          makeTranslucentSorter(
            () => mesh,
            built.geometry,
            built.opaqueIndexCount,
            built.translucentQuadMaterials,
          ),
        );
        disposals.push(() => {
          built.geometry.dispose();
          disposeMaterials(materials);
        });
      } else {
        built.geometry.dispose();
      }
    }

    scaled.add(meshGroup);
    pivot.add(scaled);
    parent.add(pivot);
    entries.set(node.part.name, entry);
    placeOne(entry, REST_POSE);
    // Children hang off the PIVOT group: they ride this part's position
    // and rotation but not its scale (§6.2 places a child at the pivot in
    // parent space).
    for (const child of node.children) build(child, pivot);
  };

  const parts = Array.from(model.parts.values(), (r) => r.part);
  for (const node of buildRigTreeOf(parts, model.manifest)) build(node, root);

  const setPose = (poses: ReadonlyMap<string, Pose> | null): void => {
    for (const [name, entry] of entries) {
      placeOne(entry, poses?.get(name) ?? REST_POSE);
    }
    for (const attachment of attachments) placeAttachment(attachment);
  };

  // On the SCALED group rather than the mesh group, which `placeOne` writes
  // the clip's `visible` to on every pose: two flags on two nodes, so neither
  // can overwrite the other and a part is drawn only while both allow it.
  const setHiddenParts = (names: Iterable<string>): void => {
    const hidden = new Set(names);
    for (const [name, entry] of entries) entry.scaled.visible = !hidden.has(name);
  };

  const attach = (
    publishedName: string,
    guest: Object3D,
  ): (() => void) | null => {
    const target = model.manifest?.sockets?.[publishedName];
    if (target === undefined) return null;
    const entry = entries.get(target.part);
    if (entry === undefined) return null;
    const socket = entry.node.part.sockets.find(
      (s) => s.name === target.socket,
    );
    if (socket === undefined) return null;

    const group = new Group();
    if (socket.rot !== undefined) {
      // core's quaternion, not three's Euler: §4 fixes ZXY intrinsic, which
      // is not three's default order, and `new Euler(x, y, z, 'ZXY')` means
      // a different composition than the spec's.
      const q = quatFromEulerZXYDeg([socket.rot.x, socket.rot.y, socket.rot.z]);
      group.quaternion.set(q[0], q[1], q[2], q[3]);
    }
    group.add(guest);
    entry.pivot.add(group);
    const attachment: Attachment = {
      part: entry,
      local: [socket.pos.x, socket.pos.y, socket.pos.z],
      group,
    };
    attachments.push(attachment);
    // Position it for the pose the host already holds — the socket group
    // has not been through a `setPose` yet.
    placeAttachment(attachment);

    return () => {
      const at = attachments.indexOf(attachment);
      if (at >= 0) attachments.splice(at, 1);
      guest.removeFromParent();
      group.removeFromParent();
    };
  };

  return {
    object: root,
    partObjects: new Map(
      Array.from(entries, ([name, entry]) => [name, entry.pivot] as const),
    ),
    setPose,
    setHiddenParts,
    attach,
    sortTranslucent: (camera: Camera) => {
      for (const sort of sorters) sort(camera);
    },
    dispose: () => {
      for (const free of disposals) free();
      disposals.length = 0;
      sorters.length = 0;
      root.removeFromParent();
    },
  };
}

function placeOne(entry: PartEntry, pose: Pose): void {
  const placement = partPlacement(entry.node, pose);
  entry.pivot.position.set(...placement.position);
  entry.pivot.quaternion.set(...placement.quaternion);
  entry.scaled.scale.set(...placement.scale);
  entry.mesh.position.set(...placement.pivotOffset);
  entry.mesh.visible = placement.visible;
}

// A socket is a point in the part's geometry, so an animated scale carries
// it — the socket on a 3x-lengthened arm stays at the tip instead of ending
// up a third of the way along it (§7.8). The guest itself is not resized,
// which is exactly why the socket group hangs off the UNSCALED pivot group
// and takes the factor by hand.
function placeAttachment({ part, local, group }: Attachment): void {
  const s = part.scaled.scale;
  const piv = part.node.part.pivot.pos;
  group.position.set(
    (local[0] - piv.x) * s.x,
    (local[1] - piv.y) * s.y,
    (local[2] - piv.z) * s.z,
  );
}
