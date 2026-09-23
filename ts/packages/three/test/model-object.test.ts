import { describe, expect, it } from 'vitest';
import {
  parseManifest,
  resolveProject,
  worldTransformsFor,
  type Manifest,
  type Pose,
  type ResolvedPart,
} from '@cuboidy/core';
import { Group, Vector3, type Object3D } from 'three';
import { buildModelObject, type ModelSource } from '../src/model-object.js';

// A two-part rig: an arm parented to a body, the arm carrying a published
// socket. Small enough to reason about by hand, and it exercises every
// branch that makes §7.7 non-trivial — a parent-relative position, a rest
// rotation, a non-zero pivot, and a socket that has to survive both.
function model(opts: { armScale?: [number, number, number] } = {}): ModelSource {
  const manifest = parseManifest({
    name: 'rigged',
    palette: ['#FF0000'],
    parts: [
      {
        name: 'body',
        geometry: { size: [2, 2, 2], voxels: [['00', '00'], ['00', '00']] },
      },
      {
        name: 'arm',
        parent: 'body',
        position: [2, 1, 0],
        ...(opts.armScale !== undefined && { scale: opts.armScale }),
        geometry: {
          size: [1, 3, 1],
          pivot: { pos: [0.5, 3, 0.5] },
          sockets: [{ name: 'grip', pos: [0.5, 0, 0.5] }],
          voxels: [['0'], ['0'], ['0']],
        },
      },
    ],
    sockets: { weapon: { part: 'arm', socket: 'grip' } },
  });
  if (!manifest.ok) throw new Error(manifest.message);
  const project = resolveProject(manifest.value, new Map());
  expect(project.unresolved).toEqual([]);
  return { manifest: manifest.value, parts: project.parts };
}

// Where a part's pivot group actually ends up, which is the number the rest
// of the toolchain states as that part's world transform.
function worldPosOf(
  built: { partObjects: ReadonlyMap<string, Group> },
  name: string,
): [number, number, number] {
  const group = built.partObjects.get(name);
  if (group === undefined) throw new Error(`no group for ${name}`);
  group.updateWorldMatrix(true, false);
  const v = new Vector3().setFromMatrixPosition(group.matrixWorld);
  return [v.x, v.y, v.z];
}

function expectClose(
  got: readonly number[],
  want: readonly number[],
): void {
  expect(got.length).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    expect(got[i]).toBeCloseTo(want[i]!, 6);
  }
}

describe('buildModelObject', () => {
  it('nests children under their parent and draws one mesh per part', () => {
    const built = buildModelObject(model());
    expect([...built.partObjects.keys()].sort()).toEqual(['arm', 'body']);
    // The arm's group is INSIDE the body's, not a sibling: that nesting is
    // what makes an animated parent carry its subtree (§6.2).
    const body = built.partObjects.get('body')!;
    const arm = built.partObjects.get('arm')!;
    expect(arm.parent?.parent === body || arm.parent === body).toBe(true);
    built.dispose();
  });

  // The claim this package makes is that a model looks the same however it
  // is drawn. The cheapest way to hold it: the tree's world positions must
  // be the world transforms core computes for the CLIs.
  it('places every part where core says it goes, at rest', () => {
    const source = model();
    const built = buildModelObject(source);
    const want = worldTransformsFor(
      source.manifest as Manifest,
      source.parts as ReadonlyMap<string, ResolvedPart>,
    );
    for (const [name, transform] of want) {
      expectClose(worldPosOf(built, name), transform.pos);
    }
    built.dispose();
  });

  it('places every part where core says it goes, under a pose', () => {
    const source = model();
    const built = buildModelObject(source);
    const poses = new Map<string, Pose>([
      ['body', { rot: [0, 90, 0], pos: [1, 0, 0], scale: [1, 1, 1], visible: true }],
      ['arm', { rot: [0, 0, 45], pos: [0, 0, 0], scale: [1, 1, 1], visible: true }],
    ]);
    built.setPose(poses);
    const want = worldTransformsFor(
      source.manifest as Manifest,
      source.parts as ReadonlyMap<string, ResolvedPart>,
      poses,
    );
    for (const [name, transform] of want) {
      expectClose(worldPosOf(built, name), transform.pos);
    }
    built.dispose();
  });

  it('hides a part the clip keys invisible, and shows it again', () => {
    const built = buildModelObject(model());
    const hidden: Pose = {
      rot: [0, 0, 0],
      pos: [0, 0, 0],
      scale: [1, 1, 1],
      visible: false,
    };
    built.setPose(new Map([['arm', hidden]]));
    const arm = built.partObjects.get('arm')!;
    // pivot → scaled → mesh: the flag is on the innermost group, so a
    // hidden part still carries its children.
    expect(arm.children[0]!.children[0]!.visible).toBe(false);
    built.setPose(null);
    expect(arm.children[0]!.children[0]!.visible).toBe(true);
    built.dispose();
  });
});

describe('setHiddenParts', () => {
  // pivot → scaled → mesh; the mask is on `scaled`, the clip's flag on mesh.
  const drawn = (built: { partObjects: ReadonlyMap<string, Group> }, name: string): boolean => {
    const scaled = built.partObjects.get(name)!.children[0]!;
    return scaled.visible && scaled.children[0]!.visible;
  };

  it("hides a part's own voxels and leaves its children and guests drawn", () => {
    const built = buildModelObject(model());
    const guest = new Group();
    built.attach('weapon', guest);
    built.setHiddenParts(['body']);
    expect(drawn(built, 'body')).toBe(false);
    expect(drawn(built, 'arm')).toBe(true);
    built.setHiddenParts(['arm']);
    expect(drawn(built, 'body')).toBe(true);
    expect(drawn(built, 'arm')).toBe(false);
    // The guest hangs off the arm's pivot, beside its voxels, not under them.
    let shown = true;
    for (let o: Object3D | null = guest; o !== null; o = o.parent) shown &&= o.visible;
    expect(shown).toBe(true);
    built.dispose();
  });

  it('survives a pose, and a clip cannot show what the mask hides', () => {
    const built = buildModelObject(model());
    built.setHiddenParts(['arm']);
    const shown: Pose = { rot: [0, 0, 0], pos: [0, 0, 0], scale: [1, 1, 1], visible: true };
    built.setPose(new Map([['arm', shown]]));
    expect(drawn(built, 'arm')).toBe(false);
    built.setHiddenParts([]);
    expect(drawn(built, 'arm')).toBe(true);
    // And the other way round: an empty mask does not show what the clip hides.
    built.setPose(new Map([['arm', { ...shown, visible: false }]]));
    expect(drawn(built, 'arm')).toBe(false);
    built.dispose();
  });
});

describe('attach', () => {
  it('puts the guest on the published socket, in world space', () => {
    const source = model();
    const built = buildModelObject(source);
    const guest = new Group();
    const detach = built.attach('weapon', guest);
    expect(detach).not.toBeNull();

    // The same point core's publishedSocketFrame states, reached by
    // parenting instead of by computing a world frame.
    guest.updateWorldMatrix(true, false);
    const at = new Vector3().setFromMatrixPosition(guest.matrixWorld);
    // arm pivot is at (0.5, 3, 0.5) of a part placed at (2, 1, 0); the
    // socket sits at (0.5, 0, 0.5), i.e. three voxels below the pivot.
    expectClose([at.x, at.y, at.z], [2, -2, 0]);

    detach!();
    expect(guest.parent).toBeNull();
    built.dispose();
  });

  it('carries the guest with the part it hangs on', () => {
    const built = buildModelObject(model());
    const guest = new Group();
    built.attach('weapon', guest);
    built.setPose(
      new Map([
        ['body', { rot: [0, 0, 0], pos: [0, 5, 0], scale: [1, 1, 1], visible: true }],
      ]),
    );
    guest.updateWorldMatrix(true, false);
    const at = new Vector3().setFromMatrixPosition(guest.matrixWorld);
    expectClose([at.x, at.y, at.z], [2, 3, 0]);
    built.dispose();
  });

  // §7.8: the socket rides the part's scale, the guest does not.
  it('follows an animated scale without resizing the guest', () => {
    const built = buildModelObject(model());
    const guest = new Group();
    built.attach('weapon', guest);
    built.setPose(
      new Map([
        ['arm', { rot: [0, 0, 0], pos: [0, 0, 0], scale: [1, 2, 1], visible: true }],
      ]),
    );
    guest.updateWorldMatrix(true, false);
    const at = new Vector3().setFromMatrixPosition(guest.matrixWorld);
    const scale = new Vector3().setFromMatrixScale(guest.matrixWorld);
    // Three voxels below the pivot, doubled: six.
    expectClose([at.x, at.y, at.z], [2, -5, 0]);
    expectClose([scale.x, scale.y, scale.z], [1, 1, 1]);
    built.dispose();
  });

  it('returns null for a name the model does not publish', () => {
    const built = buildModelObject(model());
    expect(built.attach('crest', new Group())).toBeNull();
    built.dispose();
  });
});
