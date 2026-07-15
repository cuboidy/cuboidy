import { serializeCvox } from './cvox/serialize.js';
import { remapPartPalette } from './cvox/transform.js';
import type { Part } from './cvox/types.js';
import type { Manifest } from './manifest.js';
import { resolveProject, type ProjectDiagnostic } from './project.js';

// One-shot migration off the declarative clone/mirror grammar: materialize
// every reuse part into concrete voxel geometry. Pure — the caller supplies
// file texts and writes the result. Backs the `cuboidy-migrate` CLI.

export interface ExpandResult {
  // Package-relative path → rewritten text, ONLY for geometry files that
  // held reuse parts. Files without any are omitted (left untouched on disk).
  files: Map<string, string>;
  diagnostics: ProjectDiagnostic[];
  // False when the project didn't fully resolve. Callers must not write
  // partial output — expanding an unresolved model would silently drop the
  // parts whose referents were missing.
  complete: boolean;
}

// Rewrite each geometry file with its clone/mirror parts (SPEC §7.5.1)
// replaced by the concrete geometry they derived — the `from` reference is
// dropped. Cross-file reuse under INLINE palettes remaps the copied indices
// into the declaring file's palette (appending any colors it lacks); a
// manifest-bound palette (§6.10) needs no remap since every file shares it.
export function expandProjectReuse(
  manifest: Manifest | null,
  files: ReadonlyMap<string, string>,
): ExpandResult {
  const project = resolveProject(manifest, files);
  if (!project.complete) {
    return {
      files: new Map(),
      diagnostics: project.diagnostics,
      complete: false,
    };
  }

  const bound = manifest?.palette !== undefined;
  const paletteByPath = new Map(
    project.geometries.map((g) => [g.path, g.cvox.palette] as const),
  );

  const out = new Map<string, string>();
  for (const g of project.geometries) {
    let changed = false;
    let palette = g.cvox.palette;
    const parts: Part[] = g.cvox.parts.map((p) => {
      if (p.from === undefined) return p;
      changed = true;
      const { from: _drop, ...concrete } = p;
      // Bound palette OR same-file reuse: the derived indices already live in
      // this file's effective palette, so write them verbatim.
      if (bound) return concrete;
      const origin = project.reuseOrigins.get(p.name) ?? g.path;
      if (origin === g.path) return concrete;
      // Cross-file inline reuse: the derived indices belong to the origin
      // file's palette — bring them (and any missing colors) into this one.
      const originPalette = paletteByPath.get(origin) ?? [];
      const r = remapPartPalette(concrete, originPalette, palette);
      palette = r.palette;
      return r.part;
    });
    if (changed) out.set(g.path, serializeCvox({ ...g.cvox, palette, parts }));
  }

  return { files: out, diagnostics: project.diagnostics, complete: true };
}
