import {
  lintGeometry,
  parseGeometry,
  validateProject,
  type Diagnostic,
} from '@cuboidy/core';
import type { LoadedSource } from './types.js';

// Core's lint, run against whatever is on screen right now.
//
// The CLI has always reported these; the editor never called them, which
// left the one place a model is actually authored as the one place that
// could not tell you the model was wrong. A pivot outside its grid, an
// unused palette entry, an l/r pair that is not symmetric, a geometry
// file nothing references — all of it was visible from `cuboidy-lint`
// and invisible while editing.
//
// Derived, not stored: this runs off `LoadedSource`, which the editor
// reparses as text is typed, so the diagnostics track the edit rather
// than a snapshot from load time. Pure and outside React so it can be
// tested directly.

export interface FileDiagnostic {
  /** Package-relative path, or CROSS_FILE for a whole-project finding. */
  file: string;
  diag: Diagnostic;
}

/** Stands in for a path on findings that belong to no single file. */
export const CROSS_FILE = '<cross-file>';

export function lintSource(src: LoadedSource): FileDiagnostic[] {
  const out: FileDiagnostic[] = [];

  // Per-file: W01–W05, H01–H02.
  for (const [path, geometry] of src.geometries) {
    for (const diag of lintGeometry(geometry)) out.push({ file: path, diag });
  }

  // Cross-file rules need the manifest. Without one there is no project to
  // validate — a bare geometry load is complete on its own.
  if (src.manifest === undefined) return out;

  // Optional on LoadedSource: a package with no external clips has none.
  const externalAnims = new Map(
    [...(src.externalAnims ?? [])].map(([clip, rec]) => [
      clip,
      { path: rec.path, anim: rec.anim },
    ]),
  );

  for (const diag of validateProject({
    manifest: src.manifest,
    geometries: [...src.geometries].map(([path, geometry]) => ({
      path,
      geometry,
    })),
    externalAnims,
    packageCvoxPaths: geometryFilePaths(src),
  })) {
    out.push({ file: CROSS_FILE, diag });
  }

  return out;
}

// Which files in the package ARE geometry, for the W07 unreferenced check.
// Decided by content, not by extension — since v0.9 the manifest, palettes
// and animation clips are all `.json` too, so an extension test would flag
// every one of them. This mirrors what the lint CLI does when it walks a
// directory, so the editor and `cuboidy-lint` agree on W07 rather than the
// editor quietly skipping it.
function geometryFilePaths(src: LoadedSource): string[] {
  const paths: string[] = [];
  for (const [path, text] of src.files) {
    if (!path.toLowerCase().endsWith('.json')) continue;
    if (path === src.manifestPath) continue;
    // Already known to be geometry: it is in the resolved set.
    if (src.geometries.has(path)) {
      paths.push(path);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    if (parseGeometry(json).ok) paths.push(path);
  }
  return paths;
}
