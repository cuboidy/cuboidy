import type { Diagnostic } from './diagnostic.js';
import { parseCvox } from './cvox/parse.js';
import { reusePart } from './cvox/part.js';
import type { Cvox, Palette, Part } from './cvox/types.js';
import { manifestGeometry, type Manifest } from './manifest.js';
import { parsePaletteFile } from './palette-file.js';

// Shared project-resolution layer (SPEC §6.9 / §6.10): manifest →
// geometry files → cross-file reuse → external palette. Pure — the
// caller supplies file TEXTS (from fs, a ZIP, or the editor's in-memory
// map); this module never touches IO. lint, the inspection CLIs
// (view/query/snap) and the editor all resolve a package through here so
// every tool interprets the same model identically.

export interface GeometryFile {
  path: string;
  cvox: Cvox;
}

// A diagnostic tagged with the package-relative path it belongs to (the
// same shape lint uses, minus path resolution — callers absolutize).
export interface ProjectDiagnostic {
  file: string;
  diag: Diagnostic;
}

export interface ProjectPaths {
  // Geometry refs (§6.9) with the ["voxels.cvox"] default applied,
  // normalized. List order is preserved (the first entry is the model's
  // primary file).
  geometry: string[];
  // Normalized §6.10 palette binding, when the manifest has one.
  palette?: string;
}

// The package-relative files a project references. Callers read these
// (fs/ZIP/memory) into the map handed to resolveProject().
export function projectFilePaths(manifest: Manifest | null): ProjectPaths {
  const geometry = (
    manifest !== null ? manifestGeometry(manifest) : ['voxels.cvox']
  ).map(normalizeRefPath);
  const palette =
    manifest?.palette !== undefined
      ? normalizeRefPath(manifest.palette)
      : undefined;
  return { geometry, ...(palette !== undefined && { palette }) };
}

export interface ResolvedProject {
  // Geometry files that parsed, with cross-file reuse resolved (a file
  // whose reuse failed to resolve is passed through unchanged, with its
  // `pending` intact).
  geometries: GeometryFile[];
  // Part name → path of the geometry file its voxel data came from, for
  // parts materialized by CROSS-FILE reuse. A cloned part's color indices
  // live in the referent file's inline-palette space, so per-file palette
  // handling (Assembly index remapping) must attribute it there.
  reuseOrigins: ReadonlyMap<string, string>;
  // Parsed §6.10 palette when the manifest binds one and it loaded.
  externalPalette?: Palette;
  diagnostics: ProjectDiagnostic[];
  // True when every referenced file loaded + parsed and reuse fully
  // resolved. Callers gate downstream validation/assembly on this —
  // validating a partially-resolved project only piles noise on top of
  // the diagnostics already reported.
  complete: boolean;
}

export function resolveProject(
  manifest: Manifest | null,
  files: ReadonlyMap<string, string>,
): ResolvedProject {
  const diagnostics: ProjectDiagnostic[] = [];
  const paths = projectFilePaths(manifest);

  const parsed: GeometryFile[] = [];
  for (const ref of paths.geometry) {
    const text = files.get(ref);
    if (text === undefined) {
      diagnostics.push({
        file: ref,
        diag: {
          code: 'missing',
          severity: 'error',
          message: `cannot read ${ref}`,
        },
      });
      continue;
    }
    const r = parseCvox(text, { deferUnresolvedReuse: true });
    if (!r.ok) {
      diagnostics.push({
        file: ref,
        diag: { code: r.code, severity: 'error', message: r.message },
      });
      continue;
    }
    parsed.push({ path: ref, cvox: r.value });
  }

  let externalPalette: Palette | undefined;
  if (paths.palette !== undefined) {
    const text = files.get(paths.palette);
    if (text === undefined) {
      diagnostics.push({
        file: paths.palette,
        diag: {
          code: 'missing',
          severity: 'error',
          message: `cannot read ${paths.palette}`,
        },
      });
    } else {
      let json: unknown;
      let jsonOk = false;
      try {
        json = JSON.parse(text);
        jsonOk = true;
      } catch (e) {
        diagnostics.push({
          file: paths.palette,
          diag: {
            code: 'invalid-value',
            severity: 'error',
            message: `JSON parse: ${(e as Error).message}`,
          },
        });
      }
      if (jsonOk) {
        const pR = parsePaletteFile(json);
        if (pR.ok) externalPalette = pR.value;
        else {
          diagnostics.push({
            file: paths.palette,
            diag: { code: pR.code, severity: 'error', message: pR.message },
          });
        }
      }
    }
  }

  const loadClean = diagnostics.length === 0;
  const reuse = resolveCrossFileReuse(parsed);
  diagnostics.push(...reuse.diagnostics);

  return {
    geometries: reuse.geometries,
    reuseOrigins: reuse.reuseOrigins,
    ...(externalPalette !== undefined && { externalPalette }),
    diagnostics,
    complete: loadClean && reuse.diagnostics.length === 0,
  };
}

// SPEC §6.9: clone/mirror referents resolve model-wide. Splices each
// file's `pending` reuse parts (parsed with deferUnresolvedReuse) back
// into `parts` at their declaration positions, deriving geometry from
// the referent wherever it is defined.
//
// Error precedence per reference (files in geometry-list order, refs in
// declaration order):
//   1. `duplicate`     — the referent name is defined in more than one
//                        geometry file (ambiguous; also a §11.6 error)
//   2. `invalid-value` — the referent is itself a clone/mirror (chains
//                        are forbidden, SPEC §7.5.1), whether resolved
//                        or still pending
//   3. `missing`       — the referent is not defined anywhere
//
// A file with any failed reference is returned UNCHANGED (its `pending`
// intact) so its text still round-trips; consumers gate on the returned
// diagnostics before using the geometry.
export function resolveCrossFileReuse(
  geometries: readonly GeometryFile[],
): {
  geometries: GeometryFile[];
  reuseOrigins: ReadonlyMap<string, string>;
  diagnostics: ProjectDiagnostic[];
} {
  const reuseOrigins = new Map<string, string>();
  if (geometries.every((g) => (g.cvox.pending?.length ?? 0) === 0)) {
    return { geometries: [...geometries], reuseOrigins, diagnostics: [] };
  }

  // Model-wide name → definitions. Materialized same-file reuse parts are
  // included so chains are detectable (they carry `from`).
  const defined = new Map<string, Array<{ part: Part; path: string }>>();
  const pendingNames = new Set<string>();
  for (const g of geometries) {
    for (const part of g.cvox.parts) {
      const list = defined.get(part.name);
      if (list === undefined) defined.set(part.name, [{ part, path: g.path }]);
      else list.push({ part, path: g.path });
    }
    for (const p of g.cvox.pending ?? []) pendingNames.add(p.name);
  }

  const diagnostics: ProjectDiagnostic[] = [];
  const out = geometries.map((g) => {
    const pending = g.cvox.pending ?? [];
    if (pending.length === 0) return g;

    const resolved: Array<{ index: number; part: Part; origin: string }> = [];
    let failed = false;
    for (const p of pending) {
      const verb = p.from.mirror !== undefined ? 'mirror' : 'clone';
      const defs = defined.get(p.from.part) ?? [];
      if (defs.length > 1) {
        diagnostics.push({
          file: g.path,
          diag: {
            code: 'duplicate',
            severity: 'error',
            message: `part "${p.name}" ${verb}s "${p.from.part}", which is defined in more than one geometry file (${defs.map((d) => d.path).join(', ')})`,
          },
        });
        failed = true;
        continue;
      }
      const def = defs[0];
      if (def === undefined) {
        const chained = pendingNames.has(p.from.part);
        diagnostics.push({
          file: g.path,
          diag: {
            code: chained ? 'invalid-value' : 'missing',
            severity: 'error',
            message: chained
              ? `part "${p.name}" ${verb}s "${p.from.part}", which is itself a clone/mirror (reuse chains are not allowed)`
              : `part "${p.name}" ${verb}s unknown part "${p.from.part}" (not defined in any geometry file)`,
          },
        });
        failed = true;
        continue;
      }
      if (def.part.from !== undefined) {
        diagnostics.push({
          file: g.path,
          diag: {
            code: 'invalid-value',
            severity: 'error',
            message: `part "${p.name}" ${verb}s "${p.from.part}" (${def.path}), which is itself a clone/mirror (reuse chains are not allowed)`,
          },
        });
        failed = true;
        continue;
      }
      resolved.push({
        index: p.index,
        part: reusePart(p.name, p.from, def.part),
        origin: def.path,
      });
    }

    if (failed) return g;

    // Splice in ascending declaration order — each recorded index already
    // counts the pendings before it, so sequential insertion restores the
    // exact source order.
    const parts = [...g.cvox.parts];
    for (const r of resolved) {
      parts.splice(r.index, 0, r.part);
      reuseOrigins.set(r.part.name, r.origin);
    }
    const cvox: Cvox = { ...g.cvox, parts };
    delete cvox.pending;
    return { path: g.path, cvox };
  });

  return { geometries: out, reuseOrigins, diagnostics };
}

// Minimal posix-style normalize for SPEC §8 reference paths and package
// file paths: resolves `.` / `..` segments and collapses empty ones.
// Leading `..` segments are preserved (they mean "outside the package").
export function normalizeRefPath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' && out.length > 0 && out[out.length - 1] !== '..') {
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join('/');
}
