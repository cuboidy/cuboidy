import type { Diagnostic } from '../diagnostic.js';
import { isInlineAnimation, type InlineAnimation } from '../animation.js';
import type { Geometry, Part } from '../geometry/types.js';
import { AIR, maxPaletteIndex } from '../geometry/voxel-row.js';
import type { Manifest } from '../manifest.js';
import { round6 } from '../num.js';
import type { ResolvedPart, UnresolvedPart } from '../project.js';

// SPEC §11 cross-file validation, v0.7 project shape: a manifest plus one
// or more geometry files (§6.9) and an optional bound external palette
// (§6.10). Paths are package-relative strings exactly as written in the
// manifest; the caller resolves and loads them (this module never touches
// the filesystem).
export interface ProjectInput {
  manifest: Manifest;
  // The manifest's geometry files, in list order, that parsed successfully
  // and had any §7.4 palette reference RESOLVED (resolveProject does this),
  // so `geometry.palette` is the file's effective palette either way.
  geometries: ReadonlyArray<{ path: string; geometry: Geometry }>;
  // Resolved §6.3 external animations by clip name, when the caller
  // loaded them. Inline animations come from `manifest` directly.
  externalAnims?: ReadonlyMap<string, { path: string; anim: InlineAnimation }>;
  // SPEC §6.13: every manifest part bound to its shape, from
  // resolvePartGeometry. Absent → this input predates per-part geometry
  // and the rules below fall back to joining by name across `geometries`,
  // which is what a manifest with no per-part `geometry` means anyway.
  // Present is strongly preferred: it is the only way an INLINE part takes
  // part in the checks below at all, since it is in no geometry file.
  parts?: ReadonlyMap<string, ResolvedPart>;
  // Parts resolution could not bind (§6.13), reported here rather than by
  // the resolver so that one misnamed part does not gate every other
  // cross-file rule off — see resolvePartGeometry.
  unresolved?: readonly UnresolvedPart[];
  // Every geometry path present in the package (for the W07 unreferenced
  // check). Absent → the check is skipped (caller can't enumerate files).
  packageGeometryPaths?: readonly string[];
}

export function validateProject(input: ProjectInput): Diagnostic[] {
  const { manifest, geometries } = input;
  const diags: Diagnostic[] = [];

  // Part name → defining file(s). Names are unique across the WHOLE model
  // (SPEC §5) and the by-name rules below key on that.
  //
  // The §11.6 `duplicate` report itself is NOT here: a name in two files
  // makes the by-`name` lookup ambiguous, so `resolveProject` refuses and
  // this function never runs (it is gated on `project.complete`). Reporting
  // it here as well would have been a second copy of the rule, reachable
  // only when the first one did not fire.
  const definedIn = new Map<string, string[]>();
  for (const { path, geometry } of geometries) {
    for (const part of geometry.parts) {
      const files = definedIn.get(part.name);
      if (files === undefined) definedIn.set(part.name, [path]);
      else files.push(path);
    }
  }

  const manifestParts = new Set(manifest.parts.map((p) => p.name));
  const resolved = input.parts;
  if (resolved === undefined) {
    // Legacy input: join by name, the pre-§6.13 rule.
    for (const name of manifestParts) {
      if (!definedIn.has(name)) {
        diags.push({
          code: 'missing',
          severity: 'error',
          message: `part '${name}' is in manifest but not defined in any geometry file`,
        });
      }
    }
  }
  for (const u of input.unresolved ?? []) {
    diags.push({ code: 'missing', severity: 'error', message: u.message });
  }
  // A geometry part no manifest part ended up using. With resolution in
  // hand this is exact — it accounts for an explicit `geometry.part` that
  // renames, and for a file reached only by a part-level path — where the
  // name join could only guess.
  // Which DEFINITIONS the rig actually used, as file -> names in that
  // file. Keyed by the name the part has IN THE FILE: keying it by the
  // rig's name reported a shape as unused the moment `geometry.part`
  // renamed it, including the case where two rig parts share one shape
  // and it is used twice over. A nested map rather than a joined string
  // so there is no separator to pick, escape or get wrong.
  const consumed = new Map<string, Set<string>>();
  for (const [, r] of resolved ?? []) {
    if (r.source === null) continue;
    let names = consumed.get(r.source.file);
    if (names === undefined) consumed.set(r.source.file, (names = new Set()));
    names.add(r.source.part);
  }
  for (const { path, geometry } of geometries) {
    for (const part of geometry.parts) {
      const used =
        resolved !== undefined
          ? consumed.get(path)?.has(part.name) === true
          : manifestParts.has(part.name);
      if (used) continue;
      diags.push({
        code: 'unknown',
        severity: 'warning',
        message: `part '${part.name}' (${path}) is not used by any manifest part`,
      });
    }
  }

  // Shapes, keyed by the name the RIG knows them under. Built from
  // resolution when available so inline parts (§6.13) take part in the
  // checks below; a part living in no file would otherwise be invisible
  // to both of them.
  const partsByName = new Map<string, Part>();
  if (resolved !== undefined) {
    for (const [name, r] of resolved) partsByName.set(name, r.part);
  } else {
    for (const { geometry } of geometries) {
      for (const part of geometry.parts) {
        if (!partsByName.has(part.name)) partsByName.set(part.name, part);
      }
    }
  }
  checkLrSymmetry(manifest, partsByName, diags); // W06
  checkPublishedSockets(manifest, partsByName, diags); // §6.12

  // §6.8 / §11.6: an animation targeting a part that is not in the
  // manifest is silently skipped at runtime (cross-rig sharing), so lint
  // makes the skip visible as a warning.
  const animsToCheck = new Map<string, InlineAnimation>();
  for (const [clip, anim] of Object.entries(manifest.animations ?? {})) {
    if (isInlineAnimation(anim)) animsToCheck.set(clip, anim);
  }
  for (const [clip, rec] of input.externalAnims ?? []) {
    animsToCheck.set(clip, rec.anim);
  }
  for (const [clip, anim] of animsToCheck) {
    for (const target of Object.keys(anim.parts)) {
      if (!manifestParts.has(target)) {
        diags.push({
          code: 'unknown',
          severity: 'warning',
          message: `animation '${clip}' targets part '${target}', which is not in the manifest (skipped at runtime per §6.8)`,
        });
      }
    }
  }

  // §7.4 palette availability, per geometry file. Nothing to reconcile here
  // any more: a file declares its colors or points at a palette file, and
  // the project layer has already read a reference in — so this only asks
  // whether the colors a file uses actually exist.
  for (const { path, geometry } of geometries) {
    const maxIdx = maxUsedIndex(geometry);
    if (maxIdx === AIR) continue; // all air — no palette needed
    if (geometry.palette.length === 0) {
      diags.push({
        code: 'missing',
        severity: 'error',
        message:
          geometry.paletteRef !== undefined
            ? `${path} uses color indices but its palette reference (${geometry.paletteRef}) did not resolve`
            : `${path} uses color indices but declares no palette`,
      });
    } else if (maxIdx >= geometry.palette.length) {
      // An INLINE palette was already range-checked at parse time; this
      // re-check is what covers a REFERENCED one, whose length is only
      // known once the project layer has read the file.
      diags.push({
        code: 'invalid-value',
        severity: 'error',
        message: `${path} references palette index ${maxIdx}, but its palette has ${geometry.palette.length} color(s)`,
      });
    }
  }

  // §6.13: an INLINE part's colors, by both of its routes (its own palette
  // or the manifest's). The loop above covers file-backed parts; an inline
  // one is in no file.
  //
  // §11.8 sends an inline part's index range here whenever the palette is
  // anything but colors it spells out itself — so this is the ONLY place
  // that range is checked, and it used to skip the check entirely the
  // moment a palette resolved (`r.palette.length > 0` was a `continue`).
  // An inline part using index 5 against a two-color manifest palette
  // parsed, resolved and linted clean, and reached `buildMesh` as magenta.
  for (const [name, r] of resolved ?? []) {
    if (r.source !== null) continue;
    const maxIdx = maxPaletteIndex(r.part);
    if (maxIdx === AIR) continue; // all air — no palette needed
    if (r.palette.length === 0) {
      diags.push({
        code: 'missing',
        severity: 'error',
        message: `inline part '${name}' uses color indices but no palette resolved (neither its own nor the manifest's)`,
      });
    } else if (maxIdx >= r.palette.length) {
      diags.push({
        code: 'invalid-value',
        severity: 'error',
        message: `inline part '${name}' references palette index ${maxIdx}, but its palette has ${r.palette.length} color(s)`,
      });
    }
  }

  // W08 — a manifest palette (§6.1) that no inline part falls back to. Its
  // only job is to be that fallback, so if every part either declares its
  // own or lives in a file, the binding does nothing. This is the shape a
  // leftover v0.7 manifest has, where the field overrode geometry files
  // instead — the one case that would otherwise change meaning in silence.
  if (manifest.palette !== undefined) {
    const usedByInline = manifest.parts.some(
      (p) =>
        p.geometry !== undefined &&
        p.geometry.path === undefined &&
        p.geometry.palette === undefined,
    );
    if (!usedByInline) {
      diags.push({
        code: 'invalid-value',
        severity: 'warning',
        ruleId: 'W08',
        message:
          'manifest `palette` is not used by any inline part — it does not apply to geometry files (§6.13). A v0.7 manifest binding means something else and should be moved into the files that use it',
      });
    }
  }

  // W07 — a geometry file present in the package but referenced by neither
  // the manifest geometry list nor any part's `geometry.path` (§6.13).
  // Compares package-relative paths verbatim.
  if (input.packageGeometryPaths !== undefined) {
    const referenced = new Set(geometries.map((g) => g.path));
    for (const path of input.packageGeometryPaths) {
      if (!referenced.has(path)) {
        diags.push({
          code: 'invalid-value',
          severity: 'warning',
          ruleId: 'W07',
          message: `${path} is not referenced by the manifest geometry list`,
        });
      }
    }
  }

  return diags;
}

// Backwards-compatible single-file entry point (pre-v0.7 shape): one
// geometry file, no external palette, no package listing.
export function validateCrossFile(
  manifest: Manifest,
  voxelDef: Geometry,
): Diagnostic[] {
  return validateProject({
    manifest,
    geometries: [{ path: 'voxels.json', geometry: voxelDef }],
  });
}

function maxUsedIndex(geometry: Geometry): number {
  let max = AIR;
  for (const part of geometry.parts) {
    const m = maxPaletteIndex(part);
    if (m > max) max = m;
  }
  return max;
}

// §6.12 / §11.6 — the geometry half of a published socket's contract: the
// host part must DECLARE a socket by that name (§7.8). The manifest half
// (the host part exists at all) is checked at parse time, so a published
// entry whose part is unknown never reaches here — but a part that is in
// `parts` and defined in no geometry file does, and it already has its own
// `missing` error above, so this stays quiet rather than doubling it.
function checkPublishedSockets(
  manifest: Manifest,
  partsByName: ReadonlyMap<string, Part>,
  out: Diagnostic[],
): void {
  for (const [pub, target] of Object.entries(manifest.sockets ?? {})) {
    const part = partsByName.get(target.part);
    if (part === undefined) continue; // already reported as a missing part
    if (!part.sockets.some((s) => s.name === target.socket)) {
      out.push({
        code: 'missing',
        severity: 'error',
        message: `published socket '${pub}' names socket '${target.socket}' on part '${target.part}', which declares no such socket`,
      });
    }
  }
}

// W06 — an `<base>-l` / `<base>-r` (or `_l` / `_r`) pair, sharing a
// parent, whose OCCUPIED VOXELS are not mirror images across the
// parent's YZ plane. The check is geometric (position + pivot + voxel
// occupancy in parent space), not positional: a mirrored pivot shifts
// where the mirrored geometry sits, so hand-matched positions are often
// legitimately NOT sign-opposite (the audit's boy-mini/girl-mini false
// positives), while sign-opposite positions with unmirrored voxels ARE
// asymmetric. Advisory warning.
function checkLrSymmetry(
  manifest: Manifest,
  partsByName: ReadonlyMap<string, Part>,
  out: Diagnostic[],
): void {
  const byName = new Map(manifest.parts.map((p) => [p.name, p]));
  for (const p of manifest.parts) {
    const n = p.name;
    if (n.length < 2 || !n.endsWith('l')) continue;
    const sep = n[n.length - 2];
    if (sep !== '-' && sep !== '_') continue;
    const rName = n.slice(0, -1) + 'r';
    const r = byName.get(rName);
    if (r === undefined) continue;
    if ((p.parent ?? null) !== (r.parent ?? null)) continue; // different frames
    const lPart = partsByName.get(n);
    const rPart = partsByName.get(rName);
    // A missing definition is already a cross-file `missing` error.
    if (lPart === undefined || rPart === undefined) continue;
    const lCells = parentSpaceCells(lPart, p.position ?? [0, 0, 0]);
    const rCells = parentSpaceCells(rPart, r.position ?? [0, 0, 0]);
    if (!mirroredEquals(lCells, rCells)) {
      out.push({
        code: 'invalid-value',
        severity: 'warning',
        ruleId: 'W06',
        message: `l/r pair '${n}' / '${rName}' is not mirror-symmetric across the parent's YZ plane (check positions, pivots and voxel data)`,
      });
    }
  }
}

// Solid-cell coordinates in PARENT space: manifest position places the
// pivot, so a cell's origin is position + local − pivot (SPEC §6.2 —
// translation only; rest rotations — `pivot.rot` and the manifest part's
// `rotation` — don't participate in the bilateral placement rule). Keys
// are rounded so fractional pivots (0.5 centers) compare exactly.
function parentSpaceCells(
  part: Part,
  position: readonly [number, number, number],
): Set<string> {
  const ox = position[0] - part.pivot.pos.x;
  const oy = position[1] - part.pivot.pos.y;
  const oz = position[2] - part.pivot.pos.z;
  const cells = new Set<string>();
  for (let y = 0; y < part.size.h; y++) {
    const layer = part.voxels[y]!;
    for (let z = 0; z < part.size.d; z++) {
      const row = layer[z]!;
      for (let x = 0; x < part.size.w; x++) {
        if (row[x] === AIR) continue;
        cells.add(cellKey(ox + x, oy + y, oz + z));
      }
    }
  }
  return cells;
}

// A cell [x, x+1) mirrored across x = 0 occupies [−x−1, −x) — i.e. the
// cell whose origin is −x−1. Works for fractional origins too.
function mirroredEquals(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const key of left) {
    const [x, y, z] = key.split(',').map(Number) as [number, number, number];
    if (!right.has(cellKey(-x - 1, y, z))) return false;
  }
  return true;
}

function cellKey(x: number, y: number, z: number): string {
  return `${round6(x)},${round6(y)},${round6(z)}`;
}

