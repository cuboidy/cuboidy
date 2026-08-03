import { join, resolve } from 'node:path';
import { parseManifest } from '../manifest.js';
import { isInlineAnimation, type InlineAnimation } from '../animation.js';
import type { Manifest, ManifestPart } from '../manifest.js';
import type { Color, Palette, Part, Vec3 } from '../geometry/types.js';
import { AIR, maxPaletteIndex } from './../geometry/voxel-row.js';
import { MAX_PALETTE } from '../geometry/palette.js';
import { round6 } from '../num.js';
import type { OrientedPart } from '../render/scene.js';
import { computeRestWorldTransforms, pivotRotsOf } from '../rig-transform.js';
import {
  MANIFEST_FILE,
  palettePathsOf,
  projectFilePaths,
  resolveGeometries,
  resolveProject,
  type GeometryFile,
  type ResolvedPart as ProjectPart,
} from '../project.js';
import { tryReadText } from './fs.js';

// Shared assembly layer used by cuboidy-view (2D projection),
// cuboidy-query (coordinate lookup) and cuboidy-snap (PNG rendering).
// Reads a model directory THROUGH the shared project-resolution layer
// (SPEC §6.9 geometry list, §7.4 palette resolution), so
// these tools interpret a package exactly like lint and the editor do.
// The result is a world-space voxel grid keyed by **fractional**
// coordinates. Rounding (if any) is the consumer's responsibility —
// query mode wants exact fractional matching, projection mode rounds at
// projection time. Keeping the grid fractional lets a half-voxel offset
// (a part whose pivot is 0.5 or whose position contains 0.5) survive
// assembly intact.

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
  // Resolved geometry files in manifest list order (§6.9). The first
  // entry is the model's primary file (its header labels view output).
  // EMPTY for an all-inline model (§6.13), which references none — read
  // `resolvedParts` for the shapes, never this.
  geometries: readonly GeometryFile[];
  // Effective palette for `grid` values: every geometry file's resolved
  // palette (§7.4), merged (per-file indices remapped, duplicate colors
  // deduped across files).
  palette: Palette;
  // Topologically-sorted parts so consumers iterating in order see
  // parents before children. Useful when emitting per-part diagnostics.
  order: readonly ManifestPart[];
  // Per manifest part (in `order`): the resolved geometry geometry, its
  // palette remap into `palette`, and its SPEC §7.7 rest world transform
  // from the shared rig-transform layer (rotation-aware). Quad-based
  // consumers (cuboidy-snap) render the true orientation from here;
  // `grid` below is the axis-aligned projection of the same data.
  resolvedParts: readonly PlacedPart[];
  // Every §6.3 clip the model defines, keyed by name, with external
  // references already resolved — inline and external look the same here.
  animations: ReadonlyMap<string, InlineAnimation>;
  // World-space voxel grid. Key is `${X},${Y},${Z}` where X/Y/Z are the
  // raw fractional world coords (no rounding). Use stringifyCoord() to
  // build keys, parseCoordKey() to read them back. Values index into
  // `palette`. Each part's voxels stay axis-aligned (a rest rotation
  // moves the part's pivot but does not turn its cells — the grid is an
  // integer-lattice representation; see gridRotationWarnings).
  grid: Map<string, number>;
  bbox: BBox;
  // True if any voxel cell sits at a non-integer world coordinate. This
  // is the signal the consumer uses to decide whether to warn the user
  // or switch to a finer projection grid.
  hasFractional: boolean;
  warnings: string[];
}

// OrientedPart (the render layer's input) plus the name the rig uses.
// The remap is the same table the grid values went through.
export interface PlacedPart extends OrientedPart {
  name: string;
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

  // Read every referenced file (§6.9 geometry list, §6.3
  // external animations). An unreadable reference is a setup failure
  // (exit 2) — same policy the fixed voxels.json had before the manifest
  // could name other files.
  const paths = projectFilePaths(manifest);
  const files = new Map<string, string>();
  for (const ref of [...paths.geometry, ...paths.animations]) {
    const text = await tryReadText(join(root, ref));
    if (text === null) {
      return { ok: false, message: `cannot read ${join(root, ref)}`, exitCode: 2 };
    }
    files.set(ref, text);
  }
  // §7.4 palette references live inside the geometry files, so they only
  // become visible once those are read — hence a second round.
  const staged = resolveGeometries(manifest, files);
  for (const ref of palettePathsOf(staged.geometries)) {
    if (files.has(ref)) continue;
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

  const pal = buildEffectivePalette(project.parts);
  if (!pal.ok) {
    return { ok: false, message: pal.message, exitCode: 1 };
  }

  const assembly = assembleWorld(
    manifest,
    project.parts,
    project.geometries,
    pal.value,
    orderResult.order,
  );
  // §6.3 clips in both forms, flattened to one map so consumers never
  // branch on whether the author wrote the animation inline or pointed
  // at a file. External entries win only because a clip name cannot be
  // both — resolveProject keys them by clip, not by path.
  const animations = new Map<string, InlineAnimation>();
  for (const [name, anim] of Object.entries(manifest.animations ?? {})) {
    if (isInlineAnimation(anim)) animations.set(name, anim);
  }
  for (const [name, rec] of project.externalAnims) animations.set(name, rec.anim);
  return { ok: true, assembly: { ...assembly, animations } };
}

// The effective palette for the assembled grid, plus a per-file index
// remap into it (null = identity). Every geometry file arrives with its
// palette already resolved (§7.4 — written inline or read in from the
// referenced file), so this is one merge: the first palette-bearing file
// maps identically and later files are appended with duplicate colors
// deduped. Files SHARING one palette file therefore all dedupe onto the
// same entries and all map identically, which is the common case.
interface EffectivePalette {
  palette: Palette;
  // Keyed by MANIFEST part name, not by file: with inline geometry a part
  // may belong to no file, and two parts in one file can now resolve
  // against different palettes.
  remap: Map<string, readonly number[] | null>;
  warnings: string[];
}

type PaletteResult =
  | { ok: true; value: EffectivePalette }
  | { ok: false; message: string };

function buildEffectivePalette(
  parts: ReadonlyMap<string, ProjectPart>,
): PaletteResult {
  const warnings: string[] = [];
  const merged: Color[] = [];
  const byKey = new Map<string, number>();
  const remap = new Map<string, readonly number[] | null>();
  // Parts sharing one palette object (the common case — a whole file's
  // worth, or every inline part on the manifest default) merge once and
  // then reuse the table, so the dedup work is per distinct palette rather
  // than per part.
  const tableByPalette = new Map<Palette, readonly number[] | null>();
  let first = true;

  for (const [name, r] of parts) {
    const palette = r.palette;
    const maxIdx = maxPaletteIndex(r.part);
    const where = r.source?.file ?? `inline part '${name}'`;
    if (palette.length === 0) {
      // §7.4 / §6.13: no palette resolved by any route — the part may then
      // not name a color.
      if (maxIdx !== AIR) {
        return {
          ok: false,
          message: `${where} uses color indices but no palette is available`,
        };
      }
      remap.set(name, null);
      continue;
    }
    // An palette written out in place was range-checked at parse time; a
    // REFERENCED one could not be, since its length is known only once the
    // project layer has read the file it points at.
    if (maxIdx >= palette.length) {
      return {
        ok: false,
        message: `${where} references palette index ${maxIdx}, but its palette has ${palette.length} color(s)`,
      };
    }
    const cached = tableByPalette.get(palette);
    if (cached !== undefined) {
      remap.set(name, cached);
      continue;
    }
    if (first) {
      // First palette-bearing part: identity mapping, palette verbatim.
      for (const [i, c] of palette.entries()) {
        merged.push(c);
        const key = colorKey(c);
        if (!byKey.has(key)) byKey.set(key, i);
      }
      remap.set(name, null);
      tableByPalette.set(palette, null);
      first = false;
      continue;
    }
    const table: number[] = [];
    for (const c of palette) {
      const key = colorKey(c);
      let idx = byKey.get(key);
      if (idx === undefined) {
        idx = merged.length;
        merged.push(c);
        byKey.set(key, idx);
      }
      table.push(idx);
    }
    remap.set(name, table);
    tableByPalette.set(palette, table);
  }
  if (merged.length > MAX_PALETTE) {
    warnings.push(
      `merged palettes hold ${merged.length} colors (max ${MAX_PALETTE}) — consider pointing the geometry files at one shared palette file`,
    );
  }
  return { ok: true, value: { palette: merged, remap, warnings } };
}

function colorKey(c: Color): string {
  return `${c.r},${c.g},${c.b},${c.a}`;
}

function assembleWorld(
  manifest: Manifest,
  parts: ReadonlyMap<string, ProjectPart>,
  geometries: readonly GeometryFile[],
  eff: EffectivePalette,
  order: readonly ManifestPart[],
): Omit<Assembly, 'animations'> {
  const warnings: string[] = [...eff.warnings];

  // SPEC §6.13: parts come pre-bound to their shapes by the project layer,
  // keyed by the name the RIG uses. Assembly no longer joins anything — it
  // used to search every geometry file by name, which is exactly the join
  // that could not see a part written inline in the manifest.
  const shapesByName = new Map<
    string,
    { part: Part; remap: readonly number[] | null }
  >();
  for (const [name, r] of parts) {
    shapesByName.set(name, { part: r.part, remap: eff.remap.get(name) ?? null });
  }

  // SPEC §7.7 rest world transforms from the shared rig-transform layer
  // (the same math the editor renders through). Pivot placement is exact
  // — a child of a rotated parent lands where the rig puts it; only each
  // part's own voxel orientation is approximated below (axis-aligned).
  const pivotRots = pivotRotsOf(
    Array.from(shapesByName, ([name, { part }]) => [name, part] as const),
  );
  const transforms = computeRestWorldTransforms(manifest.parts, pivotRots);

  const resolvedParts: PlacedPart[] = [];
  const grid = new Map<string, number>();
  const bbox: BBox = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  };
  let hasFractional = false;

  for (const mp of order) {
    const entry = shapesByName.get(mp.name);
    if (entry === undefined) {
      warnings.push(`part "${mp.name}" in manifest has no matching geometry part — skipping`);
      continue;
    }
    const { part, remap } = entry;
    const transform = transforms.get(mp.name)!;
    resolvedParts.push({ name: mp.name, part, remap, transform });
    const wp = transform.pos;
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
          // round6 strips quaternion float noise (a 90° parent rotation
          // must land a child at exactly −2, not −2.0000000000000004) so
          // grid keys stay queryable; genuinely fractional placements
          // (0.5 offsets, 45° rotations) survive. Same convention as the
          // W06 lint's cell keys.
          const wx = round6(wp[0] + x - px);
          const wy = round6(wp[1] + y - py);
          const wz = round6(wp[2] + z - pz);
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
    resolvedParts,
    grid,
    bbox,
    hasFractional,
    warnings,
  };
}

// Warning lines for the grid-based consumers (cuboidy-view /
// cuboidy-query): the merged world grid keeps every part's voxels
// axis-aligned, so a rest rotation (§6.2 manifest `rotation` or §7.7
// `pivot.rot`) shows up in pivot placement only. cuboidy-snap renders
// the true orientation and does not carry these.
export function gridRotationWarnings(asm: Assembly): string[] {
  const mpByName = new Map(asm.manifest.parts.map((p) => [p.name, p]));
  const out: string[] = [];
  for (const rp of asm.resolvedParts) {
    const kinds: string[] = [];
    if (mpByName.get(rp.name)?.rotation !== undefined) {
      kinds.push('manifest rotation');
    }
    if (rp.part.pivot.rot !== undefined) kinds.push('pivot rotation');
    if (kinds.length > 0) {
      out.push(
        `part "${rp.name}" has ${kinds.join(' and ')}; this grid projection keeps its voxels axis-aligned (pivot placement follows the rig — use cuboidy-snap for the true orientation)`,
      );
    }
  }
  return out;
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
