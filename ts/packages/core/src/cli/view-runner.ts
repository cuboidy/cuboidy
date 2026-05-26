import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseCvox } from '../cvox/parse.js';
import { parseManifest } from '../manifest.js';
import type { Manifest, ManifestPart } from '../manifest.js';
import type { Cvox, Part, Palette, Vec3 } from '../cvox/types.js';
import { AIR, indexToChar } from '../cvox/voxel-row.js';

// cuboidy-view: assemble a model in rest pose, project to 2D from one or
// more cardinal view directions, and emit each view as a grid of palette
// index characters (the same alphabet used in voxels.cvox so a reader can
// directly compare the projection against source rows).
//
// Coordinate convention follows SPEC §4: +X right, +Y up, −Z forward
// (the model faces −Z). For each view we pick the camera position and
// the screen "up" axis so the output reads naturally:
//   - front  — camera at −Z looking +Z (we see the face)
//   - back   — camera at +Z looking −Z
//   - left   — camera at −X looking +X (model's left side)
//   - right  — camera at +X looking −X (model's right side)
//   - top    — camera at +Y looking −Y, screen-up = −Z (model's front on top)
//   - bottom — camera at −Y looking +Y, screen-up = +Z (model's back on top)
//
// Pivot rotations (SPEC §7.7) and animation rotations (§6.5) are NOT
// applied — this tool renders the assembled rest pose with translation
// only. A part declaring `pivot ... rot ...` emits a warning and the
// rotation is ignored.

const VOXELS_FILE = 'voxels.cvox';
const MANIFEST_FILE = 'cuboidy.json';

export const VIEW_NAMES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export interface ViewOptions {
  views: readonly ViewName[];
}

export interface RunResult {
  text: string;
  exitCode: 0 | 1 | 2;
}

export async function runView(
  dir: string,
  opts: ViewOptions,
): Promise<RunResult> {
  const root = resolve(dir);
  const voxelsPath = join(root, VOXELS_FILE);
  const manifestPath = join(root, MANIFEST_FILE);

  const voxelsText = await tryReadText(voxelsPath);
  if (voxelsText === null) {
    return fail(`cannot read ${voxelsPath}`, 2);
  }
  const manifestText = await tryReadText(manifestPath);
  if (manifestText === null) {
    return fail(`cannot read ${manifestPath}`, 2);
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestText);
  } catch (e) {
    return fail(`${manifestPath}: JSON parse: ${(e as Error).message}`, 1);
  }
  const mR = parseManifest(manifestJson);
  if (!mR.ok) return fail(`${manifestPath}: ${mR.message}`, 1);

  const cR = parseCvox(voxelsText);
  if (!cR.ok) return fail(`${voxelsPath}: ${cR.message}`, 1);

  return renderModel(mR.value, cR.value, opts);
}

function fail(message: string, exitCode: 1 | 2): RunResult {
  return { text: `cuboidy-view: ${message}\n`, exitCode };
}

// --- assembly + projection -------------------------------------------------

interface WorldCell {
  X: number;
  Y: number;
  Z: number;
}

interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface Assembly {
  grid: Map<string, number>; // "X,Y,Z" → palette index
  bbox: BBox;
  warnings: string[];
}

function renderModel(
  manifest: Manifest,
  cvox: Cvox,
  opts: ViewOptions,
): RunResult {
  const orderResult = topoSortParts(manifest);
  if ('error' in orderResult) {
    return fail(`${MANIFEST_FILE}: ${orderResult.error}`, 1);
  }

  const cvoxByName = new Map<string, Part>();
  for (const p of cvox.parts) cvoxByName.set(p.name, p);

  const warnings: string[] = [];
  const worldPositions = new Map<string, Vec3>();
  for (const mp of orderResult.order) {
    const local = mp.position ?? [0, 0, 0];
    let base: Vec3 = { x: 0, y: 0, z: 0 };
    if (mp.parent !== undefined) {
      const parent = worldPositions.get(mp.parent);
      if (parent === undefined) {
        // topoSort already validated parent existence; this is unreachable.
        return fail(`internal: parent "${mp.parent}" missing in world-position map`, 1);
      }
      base = parent;
    }
    worldPositions.set(mp.name, {
      x: base.x + local[0],
      y: base.y + local[1],
      z: base.z + local[2],
    });
  }

  const assembly = assembleWorld(orderResult.order, cvoxByName, worldPositions, warnings);
  if (assembly.grid.size === 0) {
    return fail('model has no visible voxels (all AIR or no parts assembled)', 1);
  }

  const out: string[] = [];
  out.push(`model: ${manifest.name}`);
  out.push(`parts: ${orderResult.order.map((p) => p.name).join(' ')}`);
  out.push(formatBBox(assembly.bbox));
  out.push('');
  if (cvox.header) {
    out.push('header (from voxels.cvox):');
    for (const line of cvox.header) out.push('  ' + line);
    out.push('');
  }
  out.push(formatPalette(cvox.palette));
  out.push('');
  out.push('voxel cell legend: each character is the palette index of the front-most voxel along the view direction; `.` = empty');
  out.push('');

  for (const view of opts.views) {
    out.push(`--- ${view} ---`);
    out.push(viewDescription(view));
    const grid2d = projectView(assembly, view);
    for (const row of grid2d) out.push(row);
    out.push('');
  }

  for (const w of warnings) out.push(`warning: ${w}`);

  return { text: out.join('\n'), exitCode: 0 };
}

function assembleWorld(
  order: readonly ManifestPart[],
  cvoxByName: ReadonlyMap<string, Part>,
  worldPositions: ReadonlyMap<string, Vec3>,
  warnings: string[],
): Assembly {
  const grid = new Map<string, number>();
  const bbox: BBox = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  };

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
          // Snap fractional pivots/positions to the integer world grid.
          // Math.round rounds .5 toward +∞ (JS spec), which is fine for
          // visualization — the resulting image may be off by a cell on
          // half-voxel pivots but stays deterministic.
          const wx = Math.round(wp.x + x - px);
          const wy = Math.round(wp.y + y - py);
          const wz = Math.round(wp.z + z - pz);
          grid.set(`${wx},${wy},${wz}`, idx);
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

  return { grid, bbox, warnings };
}

// --- view projection -------------------------------------------------------
//
// Each view is defined by three functions over a world cell (X, Y, Z):
//   sx — horizontal screen coord (smaller = left)
//   sy — vertical screen coord (smaller = top of screen)
//   d  — depth (smaller = closer to camera; front-most voxel wins)
//
// Functions return raw signed values; the renderer offsets to 0-based
// indices after collecting all visible cells.

interface Projection {
  sx(c: WorldCell): number;
  sy(c: WorldCell): number;
  d(c: WorldCell): number;
}

const PROJECTIONS: Record<ViewName, Projection> = {
  // camera at −Z, looking +Z; up = +Y, right = +X
  front: {
    sx: (c) => c.X,
    sy: (c) => -c.Y,
    d: (c) => c.Z,
  },
  // camera at +Z, looking −Z; up = +Y, right = −X
  back: {
    sx: (c) => -c.X,
    sy: (c) => -c.Y,
    d: (c) => -c.Z,
  },
  // camera at −X, looking +X; up = +Y, right = +Z (model's back to screen-right)
  left: {
    sx: (c) => c.Z,
    sy: (c) => -c.Y,
    d: (c) => c.X,
  },
  // camera at +X, looking −X; up = +Y, right = −Z (model's front to screen-right)
  right: {
    sx: (c) => -c.Z,
    sy: (c) => -c.Y,
    d: (c) => -c.X,
  },
  // camera at +Y, looking −Y; up = −Z (model's front at screen-top), right = +X
  top: {
    sx: (c) => c.X,
    sy: (c) => c.Z,
    d: (c) => -c.Y,
  },
  // camera at −Y, looking +Y; up = +Z (model's back at screen-top), right = +X
  bottom: {
    sx: (c) => c.X,
    sy: (c) => -c.Z,
    d: (c) => c.Y,
  },
};

function viewDescription(view: ViewName): string {
  switch (view) {
    case 'front':  return 'camera at −Z looking +Z; screen X = world +X, screen Y top→bottom = world +Y → −Y';
    case 'back':   return 'camera at +Z looking −Z; screen X = world −X, screen Y top→bottom = world +Y → −Y';
    case 'left':   return "camera at −X looking +X (model's left side); screen X = world +Z, screen Y top→bottom = world +Y → −Y";
    case 'right':  return "camera at +X looking −X (model's right side); screen X = world −Z, screen Y top→bottom = world +Y → −Y";
    case 'top':    return "camera at +Y looking −Y (top down); screen X = world +X, screen Y top→bottom = world −Z → +Z (model's front on top)";
    case 'bottom': return "camera at −Y looking +Y (bottom up); screen X = world +X, screen Y top→bottom = world +Z → −Z (model's back on top)";
  }
}

function projectView(asm: Assembly, view: ViewName): string[] {
  const proj = PROJECTIONS[view];
  const { bbox, grid } = asm;

  // Screen bbox: project each of the 8 world bbox corners. The screen
  // bbox is rectangular, so corners suffice to find min/max in each
  // screen axis.
  let minSx = Infinity, maxSx = -Infinity;
  let minSy = Infinity, maxSy = -Infinity;
  for (const X of [bbox.minX, bbox.maxX]) {
    for (const Y of [bbox.minY, bbox.maxY]) {
      for (const Z of [bbox.minZ, bbox.maxZ]) {
        const c = { X, Y, Z };
        const sx = proj.sx(c);
        const sy = proj.sy(c);
        if (sx < minSx) minSx = sx;
        if (sx > maxSx) maxSx = sx;
        if (sy < minSy) minSy = sy;
        if (sy > maxSy) maxSy = sy;
      }
    }
  }
  const width = maxSx - minSx + 1;
  const height = maxSy - minSy + 1;

  // Per-pixel: keep the voxel with smallest depth.
  const winners: number[] = new Array(width * height).fill(AIR);
  const depths: number[] = new Array(width * height).fill(Infinity);

  for (const [key, idx] of grid) {
    const [Xs, Ys, Zs] = key.split(',');
    const c: WorldCell = { X: Number(Xs), Y: Number(Ys), Z: Number(Zs) };
    const sx = proj.sx(c) - minSx;
    const sy = proj.sy(c) - minSy;
    const d = proj.d(c);
    const i = sy * width + sx;
    if (d < depths[i]!) {
      depths[i] = d;
      winners[i] = idx;
    }
  }

  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let line = '';
    for (let x = 0; x < width; x++) {
      const idx = winners[y * width + x]!;
      line += idx === AIR ? '.' : indexToChar(idx);
    }
    rows.push(line);
  }
  return rows;
}

// --- helpers ---------------------------------------------------------------

interface TopoResult {
  order: ManifestPart[];
}

function topoSortParts(manifest: Manifest): TopoResult | { error: string } {
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

function formatBBox(b: BBox): string {
  return (
    `world bounds: ` +
    `X=${b.minX}..${b.maxX} (width ${b.maxX - b.minX + 1}) ` +
    `Y=${b.minY}..${b.maxY} (height ${b.maxY - b.minY + 1}) ` +
    `Z=${b.minZ}..${b.maxZ} (depth ${b.maxZ - b.minZ + 1})`
  );
}

function formatPalette(palette: Palette): string {
  const lines = ['palette:'];
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]!;
    const hex =
      '#' +
      toHex(c.r) +
      toHex(c.g) +
      toHex(c.b) +
      (c.a === 255 ? '' : toHex(c.a));
    lines.push(`  ${indexToChar(i)} = ${hex}`);
  }
  return lines.join('\n');
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0').toUpperCase();
}

async function tryReadText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}
