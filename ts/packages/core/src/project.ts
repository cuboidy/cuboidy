import type { Diagnostic } from './diagnostic.js';
import { InlineAnimationSchema, type InlineAnimation } from './animation.js';
import { parseGeometryText } from './geometry/parse.js';
import type { Geometry, Palette } from './geometry/types.js';
import { manifestGeometry, type Manifest } from './manifest.js';
import { parsePaletteFile } from './palette-file.js';

// Shared project-resolution layer (SPEC §6.10): manifest → geometry files
// → external palette. Pure — the caller supplies file TEXTS (from fs, a
// ZIP, or the editor's in-memory map); this module never touches IO. lint,
// the inspection CLIs (view/query/snap) and the editor all resolve a
// package through here so every tool interprets the same model identically.

export interface GeometryFile {
  path: string;
  geometry: Geometry;
}

// A diagnostic tagged with the package-relative path it belongs to (the
// same shape lint uses, minus path resolution — callers absolutize).
export interface ProjectDiagnostic {
  file: string;
  diag: Diagnostic;
}

export interface ProjectPaths {
  // Geometry refs (§6.9) with the ["voxels.json"] default applied,
  // normalized. List order is preserved (the first entry is the model's
  // primary file).
  geometry: string[];
  // Normalized §6.3 external animation refs (deduped — two clips may
  // share one file).
  animations: string[];
}

// A geometry file's §7.4 palette reference, normalized. Only discoverable
// AFTER the geometry files are read, so callers that stage IO in one pass
// (the CLIs read every path up front) need this second round.
export function palettePathsOf(
  geometries: ReadonlyArray<GeometryFile>,
): string[] {
  return [
    ...new Set(
      geometries
        .map((g) => g.geometry.paletteRef)
        .filter((r): r is string => r !== undefined)
        .map(normalizeRefPath),
    ),
  ];
}

// The package-relative files a project references. Callers read these
// (fs/ZIP/memory) into the map handed to resolveProject().
export function projectFilePaths(manifest: Manifest | null): ProjectPaths {
  const geometry = (
    manifest !== null ? manifestGeometry(manifest) : ['voxels.json']
  ).map(normalizeRefPath);
  const animations = [
    ...new Set(
      Object.values(manifest?.animations ?? {})
        .filter((a): a is string => typeof a === 'string')
        .map(normalizeRefPath),
    ),
  ];
  // NOTE: palettes are absent here on purpose — a §7.4 reference lives
  // INSIDE a geometry file, so it is only discoverable once those are read.
  // Callers that stage IO up front do a second round via palettePathsOf().
  return { geometry, animations };
}

export interface ResolvedProject {
  // Geometry files that parsed, in manifest list order. A file that
  // declared a §7.4 palette REFERENCE has had it resolved: `geometry.palette`
  // holds the colors and `geometry.paletteRef` records where they came from,
  // so consumers never branch on which form the author used.
  geometries: GeometryFile[];
  // Resolved §6.3 external animations, keyed by CLIP name (two clips may
  // reference the same file). Only entries that loaded and validated.
  externalAnims: Map<string, { path: string; anim: InlineAnimation }>;
  diagnostics: ProjectDiagnostic[];
  // True when every referenced file loaded + parsed and reuse fully
  // resolved. Callers gate downstream validation/assembly on this —
  // validating a partially-resolved project only piles noise on top of
  // the diagnostics already reported.
  complete: boolean;
}

// Phase one of resolveProject: parse the manifest's geometry files. Exposed
// because §7.4 palette references live INSIDE those files, so a caller that
// stages its IO up front (the CLIs read from disk) has to parse geometry
// before it knows which palette files to fetch. Cheap enough to run twice —
// a package holds a handful of small files.
export function resolveGeometries(
  manifest: Manifest | null,
  files: ReadonlyMap<string, string>,
): { geometries: GeometryFile[]; diagnostics: ProjectDiagnostic[] } {
  const diagnostics: ProjectDiagnostic[] = [];
  const geometries: GeometryFile[] = [];
  for (const ref of projectFilePaths(manifest).geometry) {
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
    const r = parseGeometryText(text);
    if (!r.ok) {
      diagnostics.push({
        file: ref,
        diag: { code: r.code, severity: 'error', message: r.message },
      });
      continue;
    }
    geometries.push({ path: ref, geometry: r.value });
  }
  return { geometries, diagnostics };
}

export function resolveProject(
  manifest: Manifest | null,
  files: ReadonlyMap<string, string>,
): ResolvedProject {
  const { geometries: parsed, diagnostics } = resolveGeometries(manifest, files);

  // §7.4 palette references, resolved per geometry file. Filling `palette`
  // in HERE is what keeps every consumer downstream free of "inline or
  // reference?" branches. Cached by path so two files sharing one palette
  // read it once and report at most one diagnostic.
  const paletteCache = new Map<string, Palette | null>();
  for (const g of parsed) {
    if (g.geometry.paletteRef === undefined) continue;
    const path = normalizeRefPath(g.geometry.paletteRef);
    let palette = paletteCache.get(path);
    if (palette === undefined) {
      palette = readPalette(path, files, diagnostics);
      paletteCache.set(path, palette);
    }
    if (palette !== null) g.geometry = { ...g.geometry, palette };
  }

  // External animations (§6.3 string refs): each names a JSON file
  // holding ONE inline-animation object, validated with the same schema
  // (and semantic rules) as inline clips.
  const externalAnims = new Map<
    string,
    { path: string; anim: InlineAnimation }
  >();
  for (const [clip, ref] of Object.entries(manifest?.animations ?? {})) {
    if (typeof ref !== 'string') continue;
    const path = normalizeRefPath(ref);
    const text = files.get(path);
    if (text === undefined) {
      diagnostics.push({
        file: path,
        diag: {
          code: 'missing',
          severity: 'error',
          message: `cannot read ${path} (animation '${clip}')`,
        },
      });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      diagnostics.push({
        file: path,
        diag: {
          code: 'invalid-value',
          severity: 'error',
          message: `JSON parse: ${(e as Error).message}`,
        },
      });
      continue;
    }
    const parsedAnim = InlineAnimationSchema.safeParse(json);
    if (!parsedAnim.success) {
      const issue = parsedAnim.error.issues[0]!;
      const at = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      diagnostics.push({
        file: path,
        diag: {
          code: 'invalid-value',
          severity: 'error',
          message: `animation '${clip}': ${at}: ${issue.message}`,
        },
      });
      continue;
    }
    externalAnims.set(clip, { path, anim: parsedAnim.data });
  }

  return {
    geometries: parsed,
    externalAnims,
    diagnostics,
    complete: diagnostics.length === 0,
  };
}

// Read + validate one referenced palette file (§6.10). Returns null and
// records a diagnostic when it is missing or malformed; the referring
// geometry then keeps its empty palette, and cross-file validation reports
// the resulting index problems in terms the author can act on.
function readPalette(
  path: string,
  files: ReadonlyMap<string, string>,
  diagnostics: ProjectDiagnostic[],
): Palette | null {
  const text = files.get(path);
  if (text === undefined) {
    diagnostics.push({
      file: path,
      diag: { code: 'missing', severity: 'error', message: `cannot read ${path}` },
    });
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    diagnostics.push({
      file: path,
      diag: {
        code: 'invalid-value',
        severity: 'error',
        message: `JSON parse: ${(e as Error).message}`,
      },
    });
    return null;
  }
  const pR = parsePaletteFile(json);
  if (pR.ok) return pR.value;
  diagnostics.push({
    file: path,
    diag: { code: pR.code, severity: 'error', message: pR.message },
  });
  return null;
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
