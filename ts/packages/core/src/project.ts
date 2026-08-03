import type { Diagnostic } from './diagnostic.js';
import { InlineAnimationSchema, type InlineAnimation } from './animation.js';
import {
  colorsToPalette,
  inlinePartToAst,
  parseGeometryText,
} from './geometry/parse.js';
import type { Geometry, Palette, Part } from './geometry/types.js';
import { manifestGeometry, type Manifest } from './manifest.js';
import { parsePaletteFile } from './palette-file.js';

// Shared project-resolution layer (SPEC §6.10): manifest → geometry files
// → external palette. Pure — the caller supplies file TEXTS (from fs, a
// ZIP, or the editor's in-memory map); this module never touches IO. lint,
// the inspection CLIs (view/query/snap) and the editor all resolve a
// package through here so every tool interprets the same model identically.

// SPEC §3: the fixed name of the package anchor. Every loader keys the
// manifest under this name; four hand-written copies of the literal used
// to live across the packages.
export const MANIFEST_FILE = 'cuboidy.json';

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

// SPEC §8: a reference resolves relative to **the file that contains it**.
// Everything the manifest writes — the geometry list, animation refs, its
// own §6.13 palette, a part's `geometry.path` — is contained by
// `cuboidy.json` at the package root, so for those the ref as written is
// already the package-relative path. A geometry file's §7.4 palette is the
// one reference written somewhere else, and it is the one this exists for:
// `gear/body.json` naming `palette.json` means `gear/palette.json`, not a
// `palette.json` at the root.
export function resolveRefFrom(fromFile: string, ref: string): string {
  const i = fromFile.lastIndexOf('/');
  const dir = i === -1 ? '' : fromFile.slice(0, i + 1);
  return normalizeRefPath(dir + ref);
}

// Each geometry file's §7.4 palette reference, resolved against that file
// (§8). Only discoverable AFTER the geometry files are read, so callers
// that stage IO in one pass (the CLIs read every path up front) need this
// second round.
export function palettePathsOf(
  geometries: ReadonlyArray<GeometryFile>,
): string[] {
  return [
    ...new Set(
      geometries
        .filter((g) => g.geometry.paletteRef !== undefined)
        .map((g) => resolveRefFrom(g.path, g.geometry.paletteRef!)),
    ),
  ];
}

// SPEC §6.9 + §6.13: the geometry files a model actually reads. Two sources
// now — the top-level `geometry` list, and each part's own `geometry.path`.
//
// The DEFAULT `["voxels.json"]` is supplied only when some part still needs
// the by-`name` lookup. This is what lets a model be a single file: an
// all-inline manifest never looks in the list, and demanding a `voxels.json`
// beside it would make the one-file form impossible (§6.9). An explicitly
// written list is always read, even if nothing resolves to it, so a stale
// entry still surfaces as the §11.6 `unknown` warning rather than being
// dropped in silence.
export function geometryPaths(manifest: Manifest | null): string[] {
  if (manifest === null) return ['voxels.json'];
  const out: string[] = [];
  if (manifest.geometry !== undefined) out.push(...manifest.geometry);
  else if (manifest.parts.some((p) => p.geometry === undefined)) {
    out.push(...manifestGeometry(manifest));
  }
  for (const p of manifest.parts) {
    if (p.geometry?.path !== undefined) out.push(p.geometry.path);
  }
  return [...new Set(out.map(normalizeRefPath))];
}

// The package-relative files a project references. Callers read these
// (fs/ZIP/memory) into the map handed to resolveProject().
export function projectFilePaths(manifest: Manifest | null): ProjectPaths {
  const geometry = geometryPaths(manifest);
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

// A manifest part whose shape could not be found. Carries the explanation
// rather than a formatted diagnostic so the reporting layer decides where it
// is attributed (§11.6 puts it with the other cross-file findings).
export interface UnresolvedPart {
  name: string;
  message: string;
}

// SPEC §6.13: one manifest part's shape, wherever it was written. Every
// consumer downstream of resolution reads this instead of joining manifest
// parts to geometry parts by name — that join is now the resolver's job, and
// doing it once is what makes the three forms indistinguishable.
export interface ResolvedPart {
  // The §7.5 shape, with `name` set from the manifest part in every form.
  part: Part;
  // What this part's voxel indices mean. Empty when nothing supplied a
  // palette, which cross-file validation reports if any index is used.
  palette: Palette;
  // Where the shape was WRITTEN: the geometry file and the name the part
  // has *there*, or null when it is inline in the manifest (§6.13).
  //
  // Both halves are needed. `part` differs from the rig's name whenever
  // `geometry.part` renames it or two rig parts share one shape, and
  // without it a consumer cannot say which definition in the file this
  // came from — which is how "used by no manifest part" came to fire on a
  // part that two manifest parts were using.
  source: { file: string; part: string } | null;
}

export interface ResolvedProject {
  // Geometry files that parsed, in manifest list order. A file that
  // declared a §7.4 palette REFERENCE has had it resolved: `geometry.palette`
  // holds the colors and `geometry.paletteRef` records where they came from,
  // so consumers never branch on which form the author used.
  geometries: GeometryFile[];
  // SPEC §6.13: every manifest part's shape, keyed by part name, in manifest
  // order. A part whose geometry could not be resolved is ABSENT and has a
  // diagnostic instead.
  parts: Map<string, ResolvedPart>;
  // Parts that found no shape (§6.13). Reported by validateProject, not
  // here — see resolvePartGeometry for why.
  unresolved: UnresolvedPart[];
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
  // Live-edited geometry ASTs that WIN over the file map's text for
  // their (normalized) paths — the editor's mid-edit primary. An
  // override stands in even while the file's text does not parse, which
  // is the point: the last good AST keeps rendering.
  overrides?: ReadonlyMap<string, Geometry>,
): { geometries: GeometryFile[]; diagnostics: ProjectDiagnostic[] } {
  const diagnostics: ProjectDiagnostic[] = [];
  const geometries: GeometryFile[] = [];
  for (const ref of projectFilePaths(manifest).geometry) {
    const override = overrides?.get(ref);
    if (override !== undefined) {
      geometries.push({ path: ref, geometry: override });
      continue;
    }
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

// SPEC §6.13: bind every manifest part to its shape. Three forms, one
// output — which is the point of doing it here rather than leaving each
// consumer to work it out:
//
//   geometry absent   → the part of the same name among the listed files
//   geometry.path     → that file's part, named by `part` (default: this name)
//   inline            → the manifest's own object
//
// `readPalette` resolves a §8 palette reference; it is passed in because the
// caller owns the file map.
//
// A part that does not resolve is left OUT of `parts` and described in
// `unresolved` — it is not reported as a project diagnostic, on purpose.
// resolveProject's diagnostics gate cross-file validation off entirely
// (running §11.6 on a half-loaded project is noise), so reporting a
// misnamed part here would suppress every other cross-file rule for the
// model. A part that cannot be found is a fault in the model, not in
// loading it, so validateProject reports it beside its peers.
export function resolvePartGeometry(
  manifest: Manifest,
  geometries: ReadonlyArray<GeometryFile>,
  readPalette: (ref: string) => Palette | null,
): { parts: Map<string, ResolvedPart>; unresolved: UnresolvedPart[] } {
  const byPath = new Map(geometries.map((g) => [g.path, g]));
  // For the by-name lookup: first file wins, matching the pre-§6.13 order.
  // A name in two files is a separate `duplicate` error (§11.6).
  const byName = new Map<string, GeometryFile>();
  for (const g of geometries) {
    for (const p of g.geometry.parts) {
      if (!byName.has(p.name)) byName.set(p.name, g);
    }
  }

  // The manifest's default palette for inline parts (§6.13), resolved once.
  const modelPalette =
    manifest.palette === undefined
      ? null
      : Array.isArray(manifest.palette)
        ? colorsToPalette(manifest.palette)
        : readPalette(normalizeRefPath(manifest.palette));

  const out = new Map<string, ResolvedPart>();
  const unresolved: UnresolvedPart[] = [];
  for (const mp of manifest.parts) {
    const g = mp.geometry;

    // Inline (§6.13): the shape is right here. Its colors are its own, else
    // the model's — never a geometry file's, since it belongs to none.
    if (g !== undefined && g.path === undefined) {
      // The schema guarantees these when `path` is absent.
      if (g.size === undefined || g.voxels === undefined) continue;
      const palette =
        g.palette === undefined
          ? (modelPalette ?? [])
          : Array.isArray(g.palette)
            ? colorsToPalette(g.palette)
            : (readPalette(normalizeRefPath(g.palette)) ?? []);
      const { palette: _p, path: _q, part: _r, ...shape } = g;
      out.set(mp.name, {
        part: inlinePartToAst({ ...shape, size: g.size, voxels: g.voxels }, mp.name),
        palette,
        source: null,
      });
      continue;
    }

    // Reference (§6.13) or the by-name lookup. Both end at a part in a file,
    // so both take that file's palette (§7.4) — the manifest's never applies.
    const wanted = g?.part ?? mp.name;
    const file =
      g?.path !== undefined
        ? byPath.get(normalizeRefPath(g.path))
        : byName.get(mp.name);
    if (file === undefined) {
      // An unreadable or unparsable path already has its own `missing` from
      // resolveGeometries; saying it twice helps nobody.
      if (g?.path === undefined) {
        unresolved.push({
          name: mp.name,
          message: `part '${mp.name}' is in the manifest but defined in no geometry file`,
        });
      }
      continue;
    }
    const found = file.geometry.parts.find((p) => p.name === wanted);
    if (found === undefined) {
      unresolved.push({
        name: mp.name,
        message: `part '${mp.name}' points at '${wanted}' in ${file.path}, which defines no such part`,
      });
      continue;
    }
    out.set(mp.name, {
      // The rig knows this part by the MANIFEST's name; under an explicit
      // `part` the two differ on purpose (one shape, two rig slots). The
      // name it has in the FILE survives in `source`, because renaming it
      // here would otherwise lose which definition this is.
      part: found.name === mp.name ? found : { ...found, name: mp.name },
      palette: file.geometry.palette,
      source: { file: file.path, part: found.name },
    });
  }
  return { parts: out, unresolved };
}

export function resolveProject(
  manifest: Manifest | null,
  files: ReadonlyMap<string, string>,
  opts: {
    // See resolveGeometries — the editor's live-edited ASTs.
    overrides?: ReadonlyMap<string, Geometry>;
  } = {},
): ResolvedProject {
  const { geometries: parsed, diagnostics } = resolveGeometries(
    manifest,
    files,
    opts.overrides,
  );

  // §7.4 palette references, resolved per geometry file. Filling `palette`
  // in HERE is what keeps every consumer downstream free of "inline or
  // reference?" branches. Cached by path so two files sharing one palette
  // read it once and report at most one diagnostic.
  const paletteCache = new Map<string, Palette | null>();
  for (const g of parsed) {
    if (g.geometry.paletteRef === undefined) continue;
    // §8: relative to the geometry file that wrote it, not to the package
    // root — two files in different directories may name `palette.json`
    // and mean different files.
    const path = resolveRefFrom(g.path, g.geometry.paletteRef);
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

  // §6.13 part binding, last: it needs the geometry files parsed AND their
  // palette references filled in above, because a referenced part takes its
  // colors from the file it lives in.
  const bound =
    manifest === null
      ? { parts: new Map<string, ResolvedPart>(), unresolved: [] }
      : resolvePartGeometry(manifest, parsed, (path) => {
          let p = paletteCache.get(path);
          if (p === undefined) {
            p = readPalette(path, files, diagnostics);
            paletteCache.set(path, p);
          }
          return p;
        });

  return {
    geometries: parsed,
    parts: bound.parts,
    unresolved: bound.unresolved,
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
