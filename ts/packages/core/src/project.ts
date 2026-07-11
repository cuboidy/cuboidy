import type { Diagnostic } from './diagnostic.js';
import { parseCvox } from './cvox/parse.js';
import { reusePart } from './cvox/part.js';
import type {
  Cvox,
  Palette,
  Part,
  PartRef,
  PendingReuse,
} from './cvox/types.js';
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

  const refs = buildReferentIndex(geometries);
  const diagnostics: ProjectDiagnostic[] = [];
  const out = geometries.map((g) => {
    const pending = g.cvox.pending ?? [];
    if (pending.length === 0) return g;

    const resolved: Array<{ index: number; part: Part; origin: string }> = [];
    let failed = false;
    for (const p of pending) {
      const found = lookupReferent(refs, p.name, p.from);
      if (!found.ok) {
        diagnostics.push({ file: g.path, diag: found.diag });
        failed = true;
        continue;
      }
      resolved.push({
        index: p.index,
        part: reusePart(p.name, p.from, found.part),
        origin: found.path,
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

// Re-derive EVERY reuse part against the current model, and resolve any
// still-pending references (SPEC §6.9). The editor calls this after any
// geometry AST change: a referent edited in one file must propagate to
// the parts derived from it in every other file. Unlike
// resolveCrossFileReuse (fresh-parse input; whole file unchanged on
// failure), a part whose referent is now broken KEEPS its last derived
// geometry — mid-edit models are routinely incomplete, and a vanishing
// part would be worse feedback than a stale one — while the failure is
// reported in `diagnostics` (same precedence: duplicate > chain >
// missing). Unresolvable pendings stay pending. Files whose parts all
// come out identical are returned as the SAME object, so callers can
// cheaply detect what changed.
export function refreshProjectReuse(geometries: readonly GeometryFile[]): {
  geometries: GeometryFile[];
  diagnostics: ProjectDiagnostic[];
} {
  const refs = buildReferentIndex(geometries);
  const diagnostics: ProjectDiagnostic[] = [];

  const out = geometries.map((g) => {
    const pending = g.cvox.pending ?? [];
    const src = g.cvox.parts;
    const parts: Part[] = [];
    const stillPending: PendingReuse[] = [];
    let changed = false;

    // Walk declaration order: concrete/derived parts interleaved with
    // pendings at their recorded positions.
    let pi = 0;
    let ci = 0;
    for (let slot = 0; ci < src.length || pi < pending.length; slot++) {
      if (
        pi < pending.length &&
        (pending[pi]!.index === slot || ci >= src.length)
      ) {
        const p = pending[pi]!;
        pi++;
        const found = lookupReferent(refs, p.name, p.from);
        if (!found.ok) {
          diagnostics.push({ file: g.path, diag: found.diag });
          stillPending.push(p);
          continue;
        }
        parts.push(reusePart(p.name, p.from, found.part));
        changed = true;
        continue;
      }
      const part = src[ci]!;
      ci++;
      if (part.from === undefined) {
        parts.push(part);
        continue;
      }
      const found = lookupReferent(refs, part.name, part.from);
      if (!found.ok) {
        diagnostics.push({ file: g.path, diag: found.diag });
        parts.push(part); // keep the last derived geometry
        continue;
      }
      const derived = reusePart(part.name, part.from, found.part);
      if (samePart(part, derived)) {
        parts.push(part); // unchanged — keep the object for cheap diffing
      } else {
        parts.push(derived);
        changed = true;
      }
    }

    if (!changed && stillPending.length === pending.length) return g;
    const cvox: Cvox = { ...g.cvox, parts };
    if (stillPending.length > 0) cvox.pending = stillPending;
    else delete cvox.pending;
    return { path: g.path, cvox };
  });

  return { geometries: out, diagnostics };
}

// Model-wide referent index: every part (including materialized reuse
// parts, so chains are detectable via `from`) plus the names of
// still-pending reuse parts.
interface ReferentIndex {
  defined: Map<string, Array<{ part: Part; path: string }>>;
  pendingNames: Set<string>;
}

function buildReferentIndex(
  geometries: readonly GeometryFile[],
): ReferentIndex {
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
  return { defined, pendingNames };
}

// SPEC §7.5.1 model-wide referent lookup with the documented error
// precedence: duplicate (ambiguous definition) > invalid-value (chain) >
// missing (not defined anywhere).
function lookupReferent(
  refs: ReferentIndex,
  name: string,
  from: PartRef,
):
  | { ok: true; part: Part; path: string }
  | { ok: false; diag: Diagnostic } {
  const verb = from.mirror !== undefined ? 'mirror' : 'clone';
  const defs = refs.defined.get(from.part) ?? [];
  if (defs.length > 1) {
    return {
      ok: false,
      diag: {
        code: 'duplicate',
        severity: 'error',
        message: `part "${name}" ${verb}s "${from.part}", which is defined in more than one geometry file (${defs.map((d) => d.path).join(', ')})`,
      },
    };
  }
  const def = defs[0];
  if (def === undefined) {
    const chained = refs.pendingNames.has(from.part);
    return {
      ok: false,
      diag: {
        code: chained ? 'invalid-value' : 'missing',
        severity: 'error',
        message: chained
          ? `part "${name}" ${verb}s "${from.part}", which is itself a clone/mirror (reuse chains are not allowed)`
          : `part "${name}" ${verb}s unknown part "${from.part}" (not defined in any geometry file)`,
      },
    };
  }
  if (def.part.from !== undefined) {
    return {
      ok: false,
      diag: {
        code: 'invalid-value',
        severity: 'error',
        message: `part "${name}" ${verb}s "${from.part}" (${def.path}), which is itself a clone/mirror (reuse chains are not allowed)`,
      },
    };
  }
  return { ok: true, part: def.part, path: def.path };
}

// Structural equality for a derived part vs its previous derivation, so
// refreshProjectReuse can keep object identity when nothing changed
// (mirror re-derivation allocates fresh arrays every time).
function samePart(a: Part, b: Part): boolean {
  if (a.name !== b.name || a.from !== b.from) {
    if (
      a.from === undefined ||
      b.from === undefined ||
      a.from.part !== b.from.part ||
      a.from.mirror !== b.from.mirror
    ) {
      return false;
    }
  }
  if (a.size !== b.size) {
    if (a.size.w !== b.size.w || a.size.h !== b.size.h || a.size.d !== b.size.d) {
      return false;
    }
  }
  if (!sameVec3(a.pivot.pos, b.pivot.pos) || !sameOptVec3(a.pivot.rot, b.pivot.rot)) {
    return false;
  }
  if (a.sockets.length !== b.sockets.length) return false;
  for (let i = 0; i < a.sockets.length; i++) {
    const sa = a.sockets[i]!;
    const sb = b.sockets[i]!;
    if (
      sa.name !== sb.name ||
      !sameVec3(sa.pos, sb.pos) ||
      !sameOptVec3(sa.rot, sb.rot)
    ) {
      return false;
    }
  }
  if (a.voxels !== b.voxels) {
    if (a.voxels.length !== b.voxels.length) return false;
    for (let y = 0; y < a.voxels.length; y++) {
      const la = a.voxels[y]!;
      const lb = b.voxels[y]!;
      if (la.length !== lb.length) return false;
      for (let z = 0; z < la.length; z++) {
        const ra = la[z]!;
        const rb = lb[z]!;
        if (ra.length !== rb.length) return false;
        for (let x = 0; x < ra.length; x++) {
          if (ra[x] !== rb[x]) return false;
        }
      }
    }
  }
  return true;
}

function sameVec3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function sameOptVec3(
  a: { x: number; y: number; z: number } | undefined,
  b: { x: number; y: number; z: number } | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameVec3(a, b);
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
