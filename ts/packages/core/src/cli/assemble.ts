import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseManifest } from '../manifest.js';
import type { Manifest, ManifestPart } from '../manifest.js';
import type { Color, Palette, Part, Vec3 } from '../cvox/types.js';
import { AIR } from './../cvox/voxel-row.js';
import { MAX_PALETTE } from '../cvox/palette.js';
import {
  projectFilePaths,
  resolveProject,
  type GeometryFile,
} from '../project.js';

// Shared assembly layer used by cuboidy-view (2D projection),
// cuboidy-query (coordinate lookup) and cuboidy-snap (PNG rendering).
// Reads a model directory THROUGH the shared project-resolution layer
// (SPEC §6.9 geometry list, §6.10 palette binding, cross-file reuse), so
// these tools interpret a package exactly like lint and the editor do.
// The result is a world-space voxel grid keyed by **fractional**
// coordinates. Rounding (if any) is the consumer's responsibility —
// query mode wants exact fractional matching, projection mode rounds at
// projection time. Keeping the grid fractional lets a half-voxel offset
// (a part whose pivot is 0.5 or whose position contains 0.5) survive
// assembly intact.

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
  // Resolved geometry files in manifest list order (§6.9); cross-file
  // clone/mirror parts are already materialized. The first entry is the
  // model's primary file (its header labels view output).
  geometries: readonly GeometryFile[];
  // Effective palette for `grid` values: the §6.10 bound palette when the
  // manifest has one, otherwise the geometry files' inline palettes merged
  // (per-file indices remapped, duplicate colors deduped across files).
  palette: Palette;
  // Topologically-sorted parts so consumers iterating in order see
  // parents before children. Useful when emitting per-part diagnostics.
  order: readonly ManifestPart[];
  // World-space voxel grid. Key is `${X},${Y},${Z}` where X/Y/Z are the
  // raw fractional world coords (no rounding). Use stringifyCoord() to
  // build keys, parseCoordKey() to read them back. Values index into
  // `palette`.
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

// Load + resolve + assemble in one go. Errors are returned (not thrown)
// so CLI shells can map them to the right exit code: 2 for unreadable
// files (setup failure), 1 for parse/validation problems.
export async function loadAndAssemble(dir: string): Promise<LoadResult | LoadError> {
  const root = resolve(dir);
  const manifestPath = join(root, MANIFEST_FILE);

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
  const manifest = mR.value;

  // Read every referenced file (§6.9 geometry list, §6.10 palette, §6.3
  // external animations). An unreadable reference is a setup failure
  // (exit 2) — same policy the fixed voxels.cvox had before the manifest
  // could name other files.
  const paths = projectFilePaths(manifest);
  const refs = [
    ...paths.geometry,
    ...(paths.palette !== undefined ? [paths.palette] : []),
    ...paths.animations,
  ];
  const files = new Map<string, string>();
  for (const ref of refs) {
    const text = await tryReadText(join(root, ref));
    if (text === null) {
      return { ok: false, message: `cannot read ${join(root, ref)}`, exitCode: 2 };
    }
    files.set(ref, text);
  }

  const project = resolveProject(manifest, files);
  if (!project.complete) {
    const first = project.diagnostics[0]!;
    return {
      ok: false,
      message: `${join(root, first.file)}: ${first.diag.message}`,
      exitCode: 1,
    };
  }

  const orderResult = topoSortParts(manifest);
  if ('error' in orderResult) {
    return { ok: false, message: `${manifestPath}: ${orderResult.error}`, exitCode: 1 };
  }

  const pal = buildEffectivePalette(
    project.geometries,
    project.externalPalette,
  );
  if (!pal.ok) {
    return { ok: false, message: pal.message, exitCode: 1 };
  }

  const assembly = assembleWorld(
    manifest,
    project.geometries,
    pal.value,
    orderResult.order,
  );
  return { ok: true, assembly };
}

// The effective palette for the assembled grid, plus a per-file index
// remap into it (null = identity). With a §6.10 binding the bound palette
// IS the effective palette (it takes precedence over inline ones). With
// no binding, each file keeps its inline colors: the first palette-bearing
// file maps identically and later files are appended with duplicate
// colors deduped, so single-file models are byte-identical to the
// pre-v0.7 behavior.
interface EffectivePalette {
  palette: Palette;
  remap: Map<string, readonly number[] | null>;
  warnings: string[];
}

type PaletteResult =
  | { ok: true; value: EffectivePalette }
  | { ok: false; message: string };

function buildEffectivePalette(
  geometries: readonly GeometryFile[],
  external: Palette | undefined,
): PaletteResult {
  const warnings: string[] = [];
  const maxIdxByFile = maxIndexByFile(geometries);

  if (external !== undefined) {
    const remap = new Map<string, readonly number[] | null>();
    for (const g of geometries) {
      const maxIdx = maxIdxByFile.get(g.path) ?? AIR;
      if (maxIdx !== AIR && maxIdx >= external.length) {
        return {
          ok: false,
          message: `${g.path} references palette index ${maxIdx}, but the bound palette has ${external.length} color(s)`,
        };
      }
      remap.set(g.path, null);
    }
    return { ok: true, value: { palette: external, remap, warnings } };
  }

  const merged: Color[] = [];
  const byKey = new Map<string, number>();
  const remap = new Map<string, readonly number[] | null>();
  let first = true;
  for (const g of geometries) {
    const inline = g.cvox.palette;
    if (inline.length === 0) {
      // §6.10: a palette-less file may only use color indices when a
      // binding exists. Indices contributed by cross-file reuse don't
      // count — they resolve against the referent file's palette.
      const maxIdx = maxIdxByFile.get(g.path) ?? AIR;
      if (maxIdx !== AIR) {
        return {
          ok: false,
          message: `${g.path} uses color indices but no palette is available (no inline palette and no manifest palette binding)`,
        };
      }
      remap.set(g.path, null);
      continue;
    }
    if (first) {
      // First palette-bearing file: identity mapping, palette verbatim.
      for (const [i, c] of inline.entries()) {
        merged.push(c);
        const key = colorKey(c);
        if (!byKey.has(key)) byKey.set(key, i);
      }
      remap.set(g.path, null);
      first = false;
      continue;
    }
    const table: number[] = [];
    for (const c of inline) {
      const key = colorKey(c);
      let idx = byKey.get(key);
      if (idx === undefined) {
        idx = merged.length;
        merged.push(c);
        byKey.set(key, idx);
      }
      table.push(idx);
    }
    remap.set(g.path, table);
  }
  if (merged.length > MAX_PALETTE) {
    warnings.push(
      `merged inline palettes hold ${merged.length} colors (max ${MAX_PALETTE}) — consider a shared manifest palette binding`,
    );
  }
  return { ok: true, value: { palette: merged, remap, warnings } };
}

function colorKey(c: Color): string {
  return `${c.r},${c.g},${c.b},${c.a}`;
}

// Highest voxel index used per geometry file (its indices live in that
// file's palette space).
function maxIndexByFile(
  geometries: readonly GeometryFile[],
): Map<string, number> {
  const max = new Map<string, number>();
  for (const g of geometries) {
    let m = max.get(g.path) ?? AIR;
    for (const part of g.cvox.parts) {
      for (const layer of part.voxels) {
        for (const row of layer) {
          for (const idx of row) {
            if (idx > m) m = idx;
          }
        }
      }
    }
    max.set(g.path, m);
  }
  return max;
}

function assembleWorld(
  manifest: Manifest,
  geometries: readonly GeometryFile[],
  eff: EffectivePalette,
  order: readonly ManifestPart[],
): Assembly {
  const warnings: string[] = [...eff.warnings];

  // Part lookup across ALL geometry files (§6.9: names are model-wide).
  // Cross-file duplicates are a lint error; assembly stays lenient and
  // keeps the first definition, with a warning.
  const cvoxByName = new Map<
    string,
    { part: Part; remap: readonly number[] | null }
  >();
  for (const g of geometries) {
    for (const part of g.cvox.parts) {
      if (cvoxByName.has(part.name)) {
        warnings.push(
          `part "${part.name}" is defined in more than one geometry file — using the first definition`,
        );
        continue;
      }
      cvoxByName.set(part.name, {
        part,
        remap: eff.remap.get(g.path) ?? null,
      });
    }
  }

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
    const entry = cvoxByName.get(mp.name);
    if (entry === undefined) {
      warnings.push(`part "${mp.name}" in manifest has no matching cvox part — skipping`);
      continue;
    }
    const { part, remap } = entry;
    if (part.pivot.rot !== undefined) {
      warnings.push(`part "${mp.name}" has pivot rotation; rotation is ignored in this tool`);
    }
    if (mp.rotation !== undefined) {
      warnings.push(`part "${mp.name}" has manifest rotation; rotation is ignored in this tool`);
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
          const effIdx = remap === null ? idx : remap[idx]!;
          const wx = wp.x + x - px;
          const wy = wp.y + y - py;
          const wz = wp.z + z - pz;
          if (!Number.isInteger(wx) || !Number.isInteger(wy) || !Number.isInteger(wz)) {
            hasFractional = true;
          }
          grid.set(stringifyCoord(wx, wy, wz), effIdx);
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

  return {
    manifest,
    geometries,
    palette: eff.palette,
    order,
    grid,
    bbox,
    hasFractional,
    warnings,
  };
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
