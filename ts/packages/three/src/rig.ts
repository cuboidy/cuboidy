import {
  buildForest,
  computeRestWorldTransforms,
  partsWorldBounds,
  pivotRotsOf,
  type ForestNode,
  type Geometry,
  type Manifest,
  type ManifestPart,
  type Part,
} from '@cuboidy/core';

// Rig math shared by every surface that draws a model. Two concerns live
// here:
//   1. Camera framing — the scene's world-space bbox, computed from the
//      REST pose (manifest positions + rotations, no animation) so the
//      camera never jumps as an animation plays.
//   2. Hierarchy — the parent/child forest a renderer nests into three.js
//      groups so a parent's animated transform carries its children.

// How the parts are laid out, which is the one thing the framing functions
// below branch on.
//
// This used to be the editor's `ViewMode` ('geometry' | 'rig' | 'anim'),
// passed down from the view toggle — a rendering layer holding the name of
// a button in one app, and two of whose three values behaved identically.
// The distinction that actually exists is whether the manifest places the
// parts or not, so that is what is asked for.
export type PartLayout =
  // Every part drawn at the origin, its own voxel grid and nothing else —
  // the editor's geometry view, and the only case where no coordinate is
  // negative.
  | 'stacked'
  // Parts placed by the manifest rig, which is every other case.
  | 'rigged';

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

// World-space rest bbox of the whole model (rig / anim views), through
// core's rotation-aware partsWorldBounds — a part resting at 45° still
// frames correctly. The seed unions in the unit cube at the origin
// (historical behavior: the camera stays anchored near the grid origin
// even for far-flung models).
// The same bounds `computeSceneSpan` and `computeSceneCenter` are derived
// from. Exported because the ground grid needs the extremes themselves, not
// a span: a grid centred on the origin has to reach whichever direction the
// model actually goes, and rig positions are signed.
export function computeSceneBounds(
  geometry: Geometry,
  manifest: Manifest | undefined,
  layout: PartLayout,
): Bounds {
  if (layout === 'stacked' || manifest === undefined) {
    // Geometry view stacks every part at the origin, so the model occupies
    // 0..size on each axis — the one case where nothing is negative.
    return {
      min: [0, 0, 0],
      max: [
        Math.max(1, ...geometry.parts.map((p) => p.size.w)),
        Math.max(1, ...geometry.parts.map((p) => p.size.h)),
        Math.max(1, ...geometry.parts.map((p) => p.size.d)),
      ],
    };
  }
  return computeWorldBounds(geometry, manifest);
}

function computeWorldBounds(geometry: Geometry, manifest: Manifest): Bounds {
  const entries = geometry.parts.map((p) => [p.name, p] as const);
  const transforms = computeRestWorldTransforms(
    manifest.parts,
    pivotRotsOf(entries),
  );
  return partsWorldBounds(entries, transforms, {
    min: [0, 0, 0],
    max: [1, 1, 1],
  });
}

export interface Span {
  w: number;
  h: number;
  d: number;
}

export function computeSceneSpan(
  geometry: Geometry,
  manifest: Manifest | undefined,
  layout: PartLayout,
): Span {
  if (layout === 'stacked' || manifest === undefined) {
    return {
      w: Math.max(1, ...geometry.parts.map((p) => p.size.w)),
      h: Math.max(1, ...geometry.parts.map((p) => p.size.h)),
      d: Math.max(1, ...geometry.parts.map((p) => p.size.d)),
    };
  }
  const { min, max } = computeWorldBounds(geometry, manifest);
  return { w: max[0] - min[0], h: max[1] - min[1], d: max[2] - min[2] };
}

export function computeSceneCenter(
  geometry: Geometry,
  manifest: Manifest | undefined,
  layout: PartLayout,
): [number, number, number] {
  if (layout === 'stacked' || manifest === undefined) {
    const maxW = Math.max(1, ...geometry.parts.map((p) => p.size.w));
    const maxH = Math.max(1, ...geometry.parts.map((p) => p.size.h));
    const maxD = Math.max(1, ...geometry.parts.map((p) => p.size.d));
    return [maxW / 2, maxH / 2, maxD / 2];
  }
  const { min, max } = computeWorldBounds(geometry, manifest);
  return [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
}

// ─── Hierarchy ──────────────────────────────────────────────────────────

// A node in the rig forest: a geometry part plus its manifest entry (for the
// parent-relative `position`) and its child parts. The animation view nests
// each node into a three.js <group> so a parent's animated rotation/scale
// carries the whole subtree (SPEC §6.2 rigid hierarchy).
export interface RigNode {
  part: Part;
  manifestPart: ManifestPart | undefined;
  children: RigNode[];
}

// Builds the parent/child forest from the manifest, through core's
// cycle-safe buildForest: a part whose manifest `parent` is absent,
// unknown, self-referential, or would close a cycle is treated as a
// root — guaranteeing a finite tree the renderer can recurse safely
// (SPEC declares cycles an error; parseManifest doesn't yet reject
// them, so the viewer must not hang on malformed input).
export function buildRigTree(
  geometry: Geometry,
  manifest: Manifest | undefined,
): RigNode[] {
  return buildRigTreeOf(geometry.parts, manifest);
}

// The same forest from the parts alone. `resolveProject` hands back a
// `ReadonlyMap<string, ResolvedPart>` and no `Geometry`, so a caller
// holding one used to synthesize a throwaway `Geometry` — with a file-level
// palette that was a lie — purely to get through the door.
export function buildRigTreeOf(
  parts: readonly Part[],
  manifest: Manifest | undefined,
): RigNode[] {
  const mpByName = new Map<string, ManifestPart>();
  if (manifest !== undefined) {
    for (const mp of manifest.parts) mpByName.set(mp.name, mp);
  }
  const toRig = (n: ForestNode<Part>): RigNode => ({
    part: n.value,
    manifestPart: mpByName.get(n.value.name),
    children: n.children.map(toRig),
  });
  return buildForest(
    parts,
    (p) => p.name,
    (p) => mpByName.get(p.name)?.parent,
  ).map(toRig);
}
