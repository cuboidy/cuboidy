import type { Diagnostic } from '../diagnostic.js';
import { isInlineAnimation, type InlineAnimation } from '../animation.js';
import type { Cvox, Palette } from '../cvox/types.js';
import { AIR } from '../cvox/voxel-row.js';
import type { Manifest } from '../manifest.js';

// SPEC §11 cross-file validation, v0.7 project shape: a manifest plus one
// or more geometry files (§6.9) and an optional bound external palette
// (§6.10). Paths are package-relative strings exactly as written in the
// manifest; the caller resolves and loads them (this module never touches
// the filesystem).
export interface ProjectInput {
  manifest: Manifest;
  // The manifest's geometry files, in list order, that parsed successfully.
  geometries: ReadonlyArray<{ path: string; cvox: Cvox }>;
  // Parsed palette.json when the manifest binds one (§6.10) and it loaded.
  externalPalette?: Palette;
  // Resolved §6.3 external animations by clip name, when the caller
  // loaded them. Inline animations come from `manifest` directly.
  externalAnims?: ReadonlyMap<string, { path: string; anim: InlineAnimation }>;
  // Every .cvox path present in the package (for the W07 unreferenced
  // check). Absent → the check is skipped (caller can't enumerate files).
  packageCvoxPaths?: readonly string[];
}

export function validateProject(input: ProjectInput): Diagnostic[] {
  const { manifest, geometries, externalPalette } = input;
  const diags: Diagnostic[] = [];

  // Part name → defining file(s). Names are unique across the WHOLE model
  // (SPEC §5), so a name defined in two geometry files is an error.
  const definedIn = new Map<string, string[]>();
  for (const { path, cvox } of geometries) {
    for (const part of cvox.parts) {
      const files = definedIn.get(part.name);
      if (files === undefined) definedIn.set(part.name, [path]);
      else files.push(path);
    }
  }
  for (const [name, files] of definedIn) {
    if (files.length > 1) {
      diags.push({
        code: 'duplicate',
        severity: 'error',
        message: `part '${name}' is defined in more than one geometry file (${files.join(', ')})`,
      });
    }
  }

  const manifestParts = new Set(manifest.parts.map((p) => p.name));
  for (const name of manifestParts) {
    if (!definedIn.has(name)) {
      diags.push({
        code: 'missing',
        severity: 'error',
        message: `part '${name}' is in manifest but not defined in any geometry file`,
      });
    }
  }
  for (const [name, files] of definedIn) {
    if (!manifestParts.has(name)) {
      diags.push({
        code: 'unknown',
        severity: 'warning',
        message: `part '${name}' (${files[0]}) is not listed in the manifest`,
      });
    }
  }

  checkLrSymmetry(manifest, diags); // W06

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

  // §6.10 palette resolution, per geometry file: the manifest binding wins
  // over an inline palette; a file with neither can't use color indices.
  for (const { path, cvox } of geometries) {
    const hasInline = cvox.palette.length > 0;
    if (externalPalette !== undefined && hasInline) {
      diags.push({
        code: 'invalid-value',
        severity: 'hint',
        ruleId: 'H03',
        message: `inline palette in ${path} is shadowed by the manifest palette binding`,
      });
    }
    const effective = externalPalette ?? (hasInline ? cvox.palette : undefined);
    const maxIdx = maxUsedIndex(cvox);
    if (maxIdx === AIR) continue; // all air — no palette needed
    if (effective === undefined) {
      diags.push({
        code: 'missing',
        severity: 'error',
        message: `${path} uses color indices but no palette is available (no inline palette and no manifest palette binding)`,
      });
    } else if (maxIdx >= effective.length) {
      // Inline-only files were already range-checked at parse time; this
      // re-check matters when the (possibly shorter) binding replaces the
      // inline palette.
      diags.push({
        code: 'invalid-value',
        severity: 'error',
        message: `${path} references palette index ${maxIdx}, but the bound palette has ${effective.length} color(s)`,
      });
    }
  }

  // W07 — a .cvox present in the package but not referenced by the
  // manifest geometry list. Compares package-relative paths verbatim.
  if (input.packageCvoxPaths !== undefined) {
    const referenced = new Set(geometries.map((g) => g.path));
    for (const path of input.packageCvoxPaths) {
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
  voxelDef: Cvox,
): Diagnostic[] {
  return validateProject({
    manifest,
    geometries: [{ path: 'voxels.cvox', cvox: voxelDef }],
  });
}

function maxUsedIndex(cvox: Cvox): number {
  let max = AIR;
  for (const part of cvox.parts) {
    for (const layer of part.voxels) {
      for (const row of layer) {
        for (const idx of row) {
          if (idx > max) max = idx;
        }
      }
    }
  }
  return max;
}

// W06 — an `<base>-l` / `<base>-r` (or `_l` / `_r`) manifest pair, sharing a
// parent, whose positions are not X-symmetric (pos_l.x === -pos_r.x and y/z
// equal). A cvox-side `mirror` reflects voxels but NOT the manifest position,
// so the hand-written mirror position is exactly where bilateral rigs drift
// asymmetric (SPEC §7.5.1). Advisory warning.
function checkLrSymmetry(manifest: Manifest, out: Diagnostic[]): void {
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
    const [lx, ly, lz] = p.position ?? [0, 0, 0];
    const [rx, ry, rz] = r.position ?? [0, 0, 0];
    if (!(lx === -rx && ly === ry && lz === rz)) {
      out.push({
        code: 'invalid-value',
        severity: 'warning',
        ruleId: 'W06',
        message: `l/r pair '${n}' / '${rName}' positions are not X-symmetric: [${lx}, ${ly}, ${lz}] vs [${rx}, ${ry}, ${rz}]`,
      });
    }
  }
}
