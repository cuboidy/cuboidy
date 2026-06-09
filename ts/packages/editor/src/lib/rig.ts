import type { Cvox, Manifest, ManifestPart, Part } from '@cuboidy/core';
import type { ViewMode } from './types.js';

// Rig math shared by the static rig view (VoxelScene) and the animation
// view (AnimationView). Two concerns live here:
//   1. Camera framing — world-space part positions / scene bbox, computed
//      from the REST pose (manifest positions, no animation) so the camera
//      never jumps as an animation plays.
//   2. Hierarchy — the parent/child forest the animation view nests into
//      three.js groups so a parent's animated transform carries its children.

// Computes the rendering offset for each part (the world-space position that
// goes into <group position={...}>). Cvox view returns [0,0,0] for all parts
// (origin-stacked). Rig / anim views walk the manifest parent chain.
//
// SPEC §6.2 / §7.7: a part's `position` is where its **pivot** sits in the
// parent's local space. world pivot = parent world pivot + part.position;
// the rendering origin (where voxel [0,0,0] sits) is `world pivot − pivot`.
// Parts missing from the manifest fall back to origin.
export function computePartPositions(
  cvox: Cvox,
  manifest: Manifest | undefined,
  viewMode: ViewMode,
): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  if (viewMode === 'cvox' || manifest === undefined) {
    for (const p of cvox.parts) out.set(p.name, [0, 0, 0]);
    return out;
  }
  const mpByName = new Map<string, ManifestPart>();
  for (const mp of manifest.parts) mpByName.set(mp.name, mp);

  const worldPivots = new Map<string, [number, number, number]>();
  const resolveWorldPivot = (
    name: string,
    seen: ReadonlySet<string> = new Set(),
  ): [number, number, number] => {
    const cached = worldPivots.get(name);
    if (cached !== undefined) return cached;
    const mp = mpByName.get(name);
    if (mp === undefined) {
      const zero: [number, number, number] = [0, 0, 0];
      worldPivots.set(name, zero);
      return zero;
    }
    const local = mp.position ?? [0, 0, 0];
    let wp: [number, number, number];
    // Cycle guard: a parent chain that loops back resolves the offending
    // hop as a root (local offset only) rather than recursing forever.
    if (mp.parent === undefined || seen.has(name)) {
      wp = [local[0], local[1], local[2]];
    } else {
      const parent = resolveWorldPivot(mp.parent, new Set(seen).add(name));
      wp = [parent[0] + local[0], parent[1] + local[1], parent[2] + local[2]];
    }
    worldPivots.set(name, wp);
    return wp;
  };

  for (const p of cvox.parts) {
    const wp = resolveWorldPivot(p.name);
    const piv = p.pivot.pos;
    out.set(p.name, [wp[0] - piv.x, wp[1] - piv.y, wp[2] - piv.z]);
  }
  return out;
}

export interface Span {
  w: number;
  h: number;
  d: number;
}

export function computeSceneSpan(
  cvox: Cvox,
  manifest: Manifest | undefined,
  viewMode: ViewMode,
): Span {
  if (viewMode === 'cvox' || manifest === undefined) {
    return {
      w: Math.max(1, ...cvox.parts.map((p) => p.size.w)),
      h: Math.max(1, ...cvox.parts.map((p) => p.size.h)),
      d: Math.max(1, ...cvox.parts.map((p) => p.size.d)),
    };
  }
  const positions = computePartPositions(cvox, manifest, viewMode);
  let minX = 0;
  let minY = 0;
  let minZ = 0;
  let maxX = 1;
  let maxY = 1;
  let maxZ = 1;
  for (const p of cvox.parts) {
    const pos = positions.get(p.name) ?? [0, 0, 0];
    minX = Math.min(minX, pos[0]);
    minY = Math.min(minY, pos[1]);
    minZ = Math.min(minZ, pos[2]);
    maxX = Math.max(maxX, pos[0] + p.size.w);
    maxY = Math.max(maxY, pos[1] + p.size.h);
    maxZ = Math.max(maxZ, pos[2] + p.size.d);
  }
  return { w: maxX - minX, h: maxY - minY, d: maxZ - minZ };
}

export function computeSceneCenter(
  cvox: Cvox,
  manifest: Manifest | undefined,
  viewMode: ViewMode,
): [number, number, number] {
  if (viewMode === 'cvox' || manifest === undefined) {
    const maxW = Math.max(1, ...cvox.parts.map((p) => p.size.w));
    const maxH = Math.max(1, ...cvox.parts.map((p) => p.size.h));
    const maxD = Math.max(1, ...cvox.parts.map((p) => p.size.d));
    return [maxW / 2, maxH / 2, maxD / 2];
  }
  const positions = computePartPositions(cvox, manifest, viewMode);
  let minX = 0;
  let minY = 0;
  let minZ = 0;
  let maxX = 1;
  let maxY = 1;
  let maxZ = 1;
  for (const p of cvox.parts) {
    const pos = positions.get(p.name) ?? [0, 0, 0];
    minX = Math.min(minX, pos[0]);
    minY = Math.min(minY, pos[1]);
    minZ = Math.min(minZ, pos[2]);
    maxX = Math.max(maxX, pos[0] + p.size.w);
    maxY = Math.max(maxY, pos[1] + p.size.h);
    maxZ = Math.max(maxZ, pos[2] + p.size.d);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

// ─── Hierarchy ──────────────────────────────────────────────────────────

// A node in the rig forest: a cvox part plus its manifest entry (for the
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
  cvox: Cvox,
  manifest: Manifest | undefined,
): RigNode[] {
  const mpByName = new Map<string, ManifestPart>();
  if (manifest !== undefined) {
    for (const mp of manifest.parts) mpByName.set(mp.name, mp);
  }

  const nodes = new Map<string, RigNode>();
  for (const p of cvox.parts) {
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
  for (const p of cvox.parts) {
    const node = nodes.get(p.name)!;
    const par = effectiveParent(p.name);
    if (par === null) roots.push(node);
    else nodes.get(par)!.children.push(node);
  }
  return roots;
}
