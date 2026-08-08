import { CROSS_FILE, lintProject, parseGeometry, parsePaletteFileText, resolvePartGeometry, type FileDiagnostic } from '@cuboidy/core';
import { normalizePath } from './load-model.js';
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

// Re-exported so the editor's own modules keep one import site for both.
export { CROSS_FILE };
export type { FileDiagnostic };

export function lintSource(src: LoadedSource): FileDiagnostic[] {
  // SPEC §6.13: bind parts to shapes the way core does, so the rules that
  // read a part's geometry — W06, published sockets, palette availability —
  // see parts written inline in the manifest. Without this they would
  // quietly skip them, and the editor would call a broken model clean.
  const geometries = [...src.geometries].map(([path, geometry]) => ({
    path,
    geometry,
  }));

  if (src.manifest === undefined) {
    return lintProject({
      manifest: null,
      geometries,
      parts: new Map(),
      unresolved: [],
      duplicates: [],
      externalAnims: new Map(),
      packageGeometryPaths: [],
      complete: true,
    });
  }

  const bound = resolvePartGeometry(src.manifest, geometries, (ref) => {
    const text = src.files.get(normalizePath(ref));
    if (text === undefined) return null;
    const r = parsePaletteFileText(text);
    return r.ok ? r.value : null;
  });

  return lintProject({
    manifest: src.manifest,
    geometries,
    parts: bound.parts,
    unresolved: bound.unresolved,
    duplicates: bound.duplicates,
    externalAnims: new Map(
      [...(src.externalAnims ?? [])].map(([clip, rec]) => [
        clip,
        { path: rec.path, anim: rec.anim },
      ]),
    ),
    packageGeometryPaths: geometryFilePaths(src),
    // The editor's name for core's `ResolvedProject.complete`: did every
    // referenced file load and parse? This is the gate the editor did not
    // have, and its absence is why one missing geometry file used to bury
    // the actual error under W07s and missing-part reports about the parts
    // that file was supposed to define.
    complete: (src.projectErrors ?? []).length === 0,
  });
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
