import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseCvox } from '../cvox/parse.js';
import { parseManifest } from '../manifest.js';
import type { Manifest, ManifestPart } from '../manifest.js';
import type { Cvox, Part, Vec3 } from '../cvox/types.js';
import { AIR } from './../cvox/voxel-row.js';

// Shared assembly layer used by both cuboidy-view (2D projection) and
// cuboidy-query (coordinate lookup). Reads a model directory, resolves
// the rig hierarchy in rest pose, and emits a world-space voxel grid
// keyed by **fractional** coordinates. Rounding (if any) is the
// consumer's responsibility — query mode wants exact fractional
// matching, projection mode rounds at projection time. Keeping the
// grid fractional lets a half-voxel offset (a part whose pivot is
// 0.5 or whose position contains 0.5) survive assembly intact.

const VOXELS_FILE = 'voxels.cvox';
const MANIFEST_FILE = 'cuboidy.json';

export interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface Assembly {
  manifest: Manifest;
  cvox: Cvox;
  // Topologically-sorted parts so consumers iterating in order see
  // parents before children. Useful when emitting per-part diagnostics.
  order: readonly ManifestPart[];
  // World-space voxel grid. Key is `${X},${Y},${Z}` where X/Y/Z are the
  // raw fractional world coords (no rounding). Use stringifyCoord() to
  // build keys, parseCoordKey() to read them back.
  grid: Map<string, number>;
  bbox: BBox;
  // True if any voxel cell sits at a non-integer world coordinate. This
  // is the signal the consumer uses to decide whether to warn the user
  // or switch to a finer projection grid.
  hasFractional: boolean;
  warnings: string[];
}

export interface LoadResult {
  ok: true;
  assembly: Assembly;
}

export interface LoadError {
  ok: false;
  message: string;
  exitCode: 1 | 2;
}

// Load + parse + assemble in one go. Errors are returned (not thrown)
// so CLI shells can map them to the right exit code.
export async function loadAndAssemble(dir: string): Promise<LoadResult | LoadError> {
  const root = resolve(dir);
  const voxelsPath = join(root, VOXELS_FILE);
  const manifestPath = join(root, MANIFEST_FILE);

  const voxelsText = await tryReadText(voxelsPath);
  if (voxelsText === null) {
    return { ok: false, message: `cannot read ${voxelsPath}`, exitCode: 2 };
  }
  const manifestText = await tryReadText(manifestPath);
  if (manifestText === null) {
    return { ok: false, message: `cannot read ${manifestPath}`, exitCode: 2 };
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch (e) {
    return {
      ok: false,
      message: `${manifestPath}: JSON parse: ${(e as Error).message}`,
      exitCode: 1,
    };
  }
  const mR = parseManifest(manifestJson);
  if (!mR.ok) {
    return { ok: false, message: `${manifestPath}: ${mR.message}`, exitCode: 1 };
  }
  const cR = parseCvox(voxelsText);
  if (!cR.ok) {
    return { ok: false, message: `${voxelsPath}: ${cR.message}`, exitCode: 1 };
  }

  const orderResult = topoSortParts(mR.value);
  if ('error' in orderResult) {
    return { ok: false, message: `${manifestPath}: ${orderResult.error}`, exitCode: 1 };
  }

  const assembly = assembleWorld(mR.value, cR.value, orderResult.order);
  return { ok: true, assembly };
}

function assembleWorld(
  manifest: Manifest,
  cvox: Cvox,
  order: readonly ManifestPart[],
): Assembly {
  const cvoxByName = new Map<string, Part>();
  for (const p of cvox.parts) cvoxByName.set(p.name, p);

  const warnings: string[] = [];
  const worldPositions = new Map<string, Vec3>();
  for (const mp of order) {
    const local = mp.position ?? [0, 0, 0];
    let base: Vec3 = { x: 0, y: 0, z: 0 };
    if (mp.parent !== undefined) {
      // topoSort guarantees the parent was visited first.
      base = worldPositions.get(mp.parent)!;
    }
    worldPositions.set(mp.name, {
      x: base.x + local[0],
      y: base.y + local[1],
      z: base.z + local[2],
    });
  }

  const grid = new Map<string, number>();
  const bbox: BBox = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  };
  let hasFractional = false;

  for (const mp of order) {
    const part = cvoxByName.get(mp.name);
    if (part === undefined) {
      warnings.push(`part "${mp.name}" in manifest has no matching cvox part — skipping`);
      continue;
    }
    if (part.pivot.rot !== undefined) {
      warnings.push(`part "${mp.name}" has pivot rotation; rotation is ignored in this tool`);
    }
    const wp = worldPositions.get(mp.name)!;
    const px = part.pivot.pos.x;
    const py = part.pivot.pos.y;
    const pz = part.pivot.pos.z;
    const { w, h, d } = part.size;
    for (let y = 0; y < h; y++) {
      const layer = part.voxels[y]!;
      for (let z = 0; z < d; z++) {
        const row = layer[z]!;
        for (let x = 0; x < w; x++) {
          const idx = row[x]!;
          if (idx === AIR) continue;
          const wx = wp.x + x - px;
          const wy = wp.y + y - py;
          const wz = wp.z + z - pz;
          if (!Number.isInteger(wx) || !Number.isInteger(wy) || !Number.isInteger(wz)) {
            hasFractional = true;
          }
          grid.set(stringifyCoord(wx, wy, wz), idx);
          if (wx < bbox.minX) bbox.minX = wx;
          if (wx > bbox.maxX) bbox.maxX = wx;
          if (wy < bbox.minY) bbox.minY = wy;
          if (wy > bbox.maxY) bbox.maxY = wy;
          if (wz < bbox.minZ) bbox.minZ = wz;
          if (wz > bbox.maxZ) bbox.maxZ = wz;
        }
      }
    }
  }

  return { manifest, cvox, order, grid, bbox, hasFractional, warnings };
}

// Canonical coord-key encoding. JavaScript's String(n) is canonical for
// finite numbers (no trailing zeros, no leading +), so two assemblies of
// the same model produce byte-identical keys. Keep both halves of the
// encoding/decoding pair here so consumers can build queries the same
// way the assembler does.
export function stringifyCoord(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function parseCoordKey(key: string): Vec3 {
  const parts = key.split(',');
  return { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) };
}

interface TopoOk {
  order: ManifestPart[];
}

function topoSortParts(manifest: Manifest): TopoOk | { error: string } {
  const byName = new Map<string, ManifestPart>();
  for (const p of manifest.parts) {
    if (byName.has(p.name)) {
      return { error: `duplicate part name "${p.name}"` };
    }
    byName.set(p.name, p);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: ManifestPart[] = [];

  function visit(name: string): string | null {
    if (visited.has(name)) return null;
    if (visiting.has(name)) return `cycle detected involving part "${name}"`;
    const p = byName.get(name);
    if (!p) return `unknown part "${name}" referenced as parent`;
    visiting.add(name);
    if (p.parent !== undefined) {
      const e = visit(p.parent);
      if (e) return e;
    }
    visiting.delete(name);
    visited.add(name);
    order.push(p);
    return null;
  }

  for (const p of manifest.parts) {
    const e = visit(p.name);
    if (e) return { error: e };
  }
  return { order };
}

async function tryReadText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}
