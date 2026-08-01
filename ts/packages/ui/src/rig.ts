import {
  QUAT_IDENTITY,
  computeRestWorldTransforms,
  quatRotateVec3,
  type Geometry,
  type Manifest,
  type ManifestPart,
  type Part,
  type Vec3Tuple,
  type WorldTransform,
} from '@cuboidy/core';
import type { ViewMode } from './view-types.js';

// Rig math shared by the static rig view (VoxelScene) and the animation
// view (AnimationView). Two concerns live here:
//   1. Camera framing — the scene's world-space bbox, computed from the
//      REST pose (manifest positions + rotations, no animation) so the
//      camera never jumps as an animation plays.
//   2. Hierarchy — the parent/child forest the animation view nests into
//      three.js groups so a parent's animated transform carries its children.

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

// World-space rest bbox of the whole model (rig / anim views). Each part's
// eight local box corners are pushed through the shared SPEC §7.7 rest
// transform from @cuboidy/core — rotation-aware, so a part resting at 45°
// still frames correctly. Parts missing from the manifest fall back to an
// origin-anchored identity transform. The box always includes the unit
// cube at the origin (historical behavior: the camera stays anchored near
// the grid origin even for far-flung models).
function computeWorldBounds(geometry: Geometry, manifest: Manifest): Bounds {
  const pivotRots = new Map<string, Vec3Tuple>();
  for (const p of geometry.parts) {
    const rot = p.pivot.rot;
    if (rot !== undefined) pivotRots.set(p.name, [rot.x, rot.y, rot.z]);
  }
  const transforms = computeRestWorldTransforms(manifest.parts, pivotRots);
  const fallback: WorldTransform = { pos: [0, 0, 0], quat: QUAT_IDENTITY };

  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [1, 1, 1];
  for (const p of geometry.parts) {
    const wt = transforms.get(p.name) ?? fallback;
    const piv = p.pivot.pos;
    for (const cx of [0, p.size.w]) {
      for (const cy of [0, p.size.h]) {
        for (const cz of [0, p.size.d]) {
          const r = quatRotateVec3(wt.quat, [
            cx - piv.x,
            cy - piv.y,
            cz - piv.z,
          ]);
          for (let i = 0; i < 3; i++) {
            const w = wt.pos[i]! + r[i]!;
            if (w < min[i]!) min[i] = w;
            if (w > max[i]!) max[i] = w;
          }
        }
      }
    }
  }
  return { min, max };
}

export interface Span {
  w: number;
  h: number;
  d: number;
}

export function computeSceneSpan(
  geometry: Geometry,
  manifest: Manifest | undefined,
  viewMode: ViewMode,
): Span {
  if (viewMode === 'geometry' || manifest === undefined) {
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
  viewMode: ViewMode,
): [number, number, number] {
  if (viewMode === 'geometry' || manifest === undefined) {
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

// Builds the parent/child forest from the manifest. A part whose manifest
// `parent` is absent, unknown, self-referential, or would close a cycle is
// treated as a root — guaranteeing a finite tree the renderer can recurse
// safely (SPEC declares cycles an error; parseManifest doesn't yet reject
// them, so the viewer must not hang on malformed input).
export function buildRigTree(
  geometry: Geometry,
  manifest: Manifest | undefined,
): RigNode[] {
  const mpByName = new Map<string, ManifestPart>();
  if (manifest !== undefined) {
    for (const mp of manifest.parts) mpByName.set(mp.name, mp);
  }

  const nodes = new Map<string, RigNode>();
  for (const p of geometry.parts) {
    nodes.set(p.name, {
      part: p,
      manifestPart: mpByName.get(p.name),
      children: [],
    });
  }

  const effectiveParent = (name: string): string | null => {
    const par = mpByName.get(name)?.parent;
    if (par === undefined || par === name || !nodes.has(par)) return null;
    // Walk up from the proposed parent; if we return to `name`, the edge
    // would close a cycle — drop it (make `name` a root instead).
    const seen = new Set<string>([name]);
    let cur: string | undefined = par;
    while (cur !== undefined && nodes.has(cur)) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      cur = mpByName.get(cur)?.parent;
    }
    return par;
  };

  const roots: RigNode[] = [];
  for (const p of geometry.parts) {
    const node = nodes.get(p.name)!;
    const par = effectiveParent(p.name);
    if (par === null) roots.push(node);
    else nodes.get(par)!.children.push(node);
  }
  return roots;
}
