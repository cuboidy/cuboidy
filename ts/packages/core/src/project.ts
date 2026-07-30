import type { Diagnostic } from './diagnostic.js';
import { InlineAnimationSchema, type InlineAnimation } from './animation.js';
import { parseGeometryText } from './geometry/parse.js';
import type { Cvox, Palette } from './geometry/types.js';
import { manifestGeometry, type Manifest } from './manifest.js';
import { parsePaletteFile } from './palette-file.js';

// Shared project-resolution layer (SPEC §6.10): manifest → geometry files
// → external palette. Pure — the caller supplies file TEXTS (from fs, a
// ZIP, or the editor's in-memory map); this module never touches IO. lint,
// the inspection CLIs (view/query/snap) and the editor all resolve a
// package through here so every tool interprets the same model identically.

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
  // Geometry refs (§6.9) with the ["voxels.json"] default applied,
  // normalized. List order is preserved (the first entry is the model's
  // primary file).
  geometry: string[];
  // Normalized §6.10 palette binding, when the manifest has one.
  palette?: string;
  // Normalized §6.3 external animation refs (deduped — two clips may
  // share one file).
  animations: string[];
}

// The package-relative files a project references. Callers read these
// (fs/ZIP/memory) into the map handed to resolveProject().
export function projectFilePaths(manifest: Manifest | null): ProjectPaths {
  const geometry = (
    manifest !== null ? manifestGeometry(manifest) : ['voxels.json']
  ).map(normalizeRefPath);
  const palette =
    manifest?.palette !== undefined
      ? normalizeRefPath(manifest.palette)
      : undefined;
  const animations = [
    ...new Set(
      Object.values(manifest?.animations ?? {})
        .filter((a): a is string => typeof a === 'string')
        .map(normalizeRefPath),
    ),
  ];
  return { geometry, ...(palette !== undefined && { palette }), animations };
}

export interface ResolvedProject {
  // Geometry files that parsed, in manifest list order.
  geometries: GeometryFile[];
  // Parsed §6.10 palette when the manifest binds one and it loaded.
  externalPalette?: Palette;
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
    const r = parseGeometryText(text);
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
    ...(externalPalette !== undefined && { externalPalette }),
    externalAnims,
    diagnostics,
    complete: diagnostics.length === 0,
  };
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
