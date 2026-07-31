import {
  InlineAnimationSchema,
  manifestGeometry,
  parseGeometryText,
  parseManifest,
  parsePaletteFile,
  serializeColor,
  serializeGeometry,
  type Geometry,
  type InlineAnimation,
  type Manifest,
  type Palette,
  type Part,
} from '@cuboidy/core';
import {
  isGeometryPath,
  normalizePath,
  resolveProjectRefs,
  withResolvedPalette,
} from './load-model.js';
import type { LoadedSource } from './types.js';

// Pure operations over a loaded source: the union of every geometry file's
// parts, per-file AST rewrites, palette-reference following, and the
// file-level rename / move / delete that keep the model's references intact.
//
// None of this touches React. It lives here rather than in App.tsx because
// it is the part of the editor most worth testing directly: renaming or
// deleting a file has to follow references through the manifest, the
// geometry files and the resolved animation records at once, and a
// half-applied rewrite is exactly the bug a type checker cannot see.

// The DISPLAY model: the union of every geometry file's parts, in
// geometry-list order. A cross-file duplicate name keeps the first
// definition (validateProject flags the error). `files` records each
// part's defining file — edit routing and the part tree's file badges.
export function mergeGeometries(src: LoadedSource): {
  parts: Part[];
  files: ReadonlyMap<string, string>;
} {
  const files = new Map<string, string>();
  const parts: Part[] = [];
  for (const [path, geometry] of src.geometries) {
    for (const part of geometry.parts) {
      if (files.has(part.name)) continue;
      files.set(part.name, path);
      parts.push(part);
    }
  }
  return { parts, files };
}

// Rewrite a part's voxel indices from one inline palette to another,
// appending colors the target palette lacks (exact rgba match). AIR and
// out-of-range indices pass through unchanged (the latter are lint
// errors either way). Used when moving a part between UNBOUND files,
// where each file's inline palette gives indices their meaning (§6.10)
// — without the remap the moved part would silently change color.
export function remapPartPalette(
  part: Part,
  from: Palette,
  to: Palette,
): { part: Part; palette: Palette } {
  const palette = [...to];
  const map = new Map<number, number>();
  for (const layer of part.voxels) {
    for (const row of layer) {
      for (const v of row) {
        if (v < 0 || v >= from.length || map.has(v)) continue;
        const c = from[v]!;
        let j = palette.findIndex(
          (t) => t.r === c.r && t.g === c.g && t.b === c.b && t.a === c.a,
        );
        if (j === -1) {
          j = palette.length;
          palette.push(c);
        }
        map.set(v, j);
      }
    }
  }
  const identity = [...map].every(([a, b]) => a === b);
  if (identity && palette.length === to.length) return { part, palette: to };
  const voxels = part.voxels.map((layer) =>
    layer.map((row) => row.map((v) => map.get(v) ?? v)),
  );
  return { part: { ...part, voxels }, palette };
}

export function pathBasename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

// Apply `fn` to every geometry file AST. Each CHANGED file is written to
// both stores at once — the AST and its re-serialized text — which is now
// the whole job: there is no third copy of the primary to patch. `fn`
// returns null for "no change to this file".
export function mapGeometryFiles(
  src: LoadedSource,
  fn: (geometry: Geometry, path: string) => Geometry | null,
): LoadedSource {
  let geometries: Map<string, Geometry> | null = null;
  let files: Map<string, string> | null = null;
  for (const [path, geometry] of src.geometries) {
    const next = fn(geometry, path);
    if (next === null) continue;
    if (geometries === null) geometries = new Map(src.geometries);
    if (files === null) files = new Map(src.files);
    geometries.set(path, next);
    files.set(path, serializeGeometry(next));
  }
  if (geometries === null || files === null) return src;
  return { ...src, geometries, files };
}

// Rewrite every resolved external animation (§6.3) with `fn`, updating
// BOTH the externalAnims map and the referenced file's text in the same
// source patch — so a part rename/delete is one undo across manifest,
// geometry AND external animation files. `fn` returns null for "no
// change to this clip". Two clips may reference one file; they carry
// the same parsed object, so `fn` rewrites the shared file identically.
export function rewriteExternalAnims(
  src: LoadedSource,
  fn: (anim: InlineAnimation) => InlineAnimation | null,
): LoadedSource {
  if (src.externalAnims === undefined) return src;
  let anims: Map<string, { path: string; anim: InlineAnimation }> | null = null;
  let files: Map<string, string> | null = null;
  for (const [clip, rec] of src.externalAnims) {
    const built = fn(rec.anim);
    if (built === null || built === rec.anim) continue;
    if (anims === null) anims = new Map(src.externalAnims);
    if (files === null) files = new Map(src.files);
    anims.set(clip, { path: rec.path, anim: built });
    files.set(rec.path, JSON.stringify(built, null, 2) + '\n');
  }
  if (anims === null || files === null) return src;
  return { ...src, externalAnims: anims, files };
}

// ── accessors ──────────────────────────────────────────────────────────
// `files` is the only text store and `geometries` the only AST store, so
// these are lookups rather than the "which copy is newer" adjudication the
// primary/manifest side-slots used to require.

// The primary geometry's AST. Defined by construction: the loader refuses a
// package whose primary does not parse, and a live edit only amends the AST
// once the new text parses, so the last good one stands in meanwhile.
export function primaryGeometry(src: LoadedSource): Geometry {
  return src.geometries.get(src.primaryPath)!;
}

export function fileText(src: LoadedSource, path: string): string | undefined {
  return src.files.get(path);
}

export function manifestText(src: LoadedSource): string | undefined {
  return src.manifestPath === undefined
    ? undefined
    : src.files.get(src.manifestPath);
}

// Canonical text for cuboidy.json.
export function manifestJson(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}

// Write a manifest back into the source: the AST and its re-serialized text,
// together. EVERY structural edit that touches cuboidy.json goes through
// here, so the two cannot drift apart — and a package that has no manifest
// file yet (one just synthesized) gets one. This used to be six lines
// repeated at fifteen call sites, which is also the shape that made the
// storage layout hard to change.
export function withManifest(
  src: LoadedSource,
  manifest: Manifest,
): LoadedSource {
  const path = src.manifestPath ?? 'cuboidy.json';
  const anchored = src.manifestPath === path ? src : { ...src, manifestPath: path };
  // Writing the manifest's TEXT is enough: writeFile re-derives the AST and
  // everything the manifest references. So a caller that changes the
  // geometry list, a palette binding or an animation ref does not have to
  // re-resolve anything by hand — that used to be its own block at three
  // call sites, each a chance to forget one of the four reference kinds.
  return writeFile(anchored, path, manifestJson(manifest));
}

// The typing path: record cuboidy.json's text WITHOUT touching the AST,
// which the debounced re-parse lands separately once the text parses.
export function withManifestText(src: LoadedSource, text: string): LoadedSource {
  const path = src.manifestPath ?? 'cuboidy.json';
  const files = new Map(src.files);
  files.set(path, text);
  return { ...src, files, manifestPath: path };
}

// Write one package file's text AND re-derive everything that file feeds.
// This is the single sync point between the text store and the AST store,
// so the two cannot drift apart no matter what a future edit path does —
// nothing else may write `files`.
export function writeFile(
  src: LoadedSource,
  path: string,
  text: string,
): LoadedSource {
  return deriveAfterWrite(src, path, text).source;
}

// The raw put. Private on purpose: a caller that skipped the deriving
// wrapper would leave the AST describing text that is no longer there.
function putText(src: LoadedSource, path: string, text: string): LoadedSource {
  const files = new Map(src.files);
  files.set(path, text);
  return { ...src, files };
}

// Canonical text for an external palette file (§6.10).
export function paletteFileText(palette: Palette): string {
  return JSON.stringify({ colors: palette.map(serializeColor) }, null, 2) + '\n';
}

// Does this geometry file resolve against the palette file at `ref`?
export function sharesPalette(geometry: Geometry, ref: string): boolean {
  return (
    geometry.paletteRef !== undefined &&
    normalizePath(geometry.paletteRef) === ref
  );
}

export function geometryAt(src: LoadedSource, path: string): Geometry | undefined {
  return src.geometries.get(path);
}

// Every §7.4 palette path the model's geometry files currently point at.
// The manifest is not consulted: since v0.9 a palette is referenced by the
// geometry file that uses it, never model-wide.
export function geometryPaletteRefs(src: LoadedSource): ReadonlySet<string> {
  const out = new Set<string>();
  const add = (g: Geometry): void => {
    if (g.paletteRef !== undefined) out.add(normalizePath(g.paletteRef));
  };
  for (const g of src.geometries.values()) add(g);
  return out;
}

// Re-point every geometry file whose palette reference names `from`.
// `to === null` DROPS the reference — used when the palette file itself is
// deleted. Those files then keep the colors they last resolved, which the
// serializer writes back out inline: strictly better than a dangling
// reference, which would be a guaranteed load error next time.
export function repointPaletteRef(
  src: LoadedSource,
  from: string,
  to: string | null,
): LoadedSource {
  return mapGeometryFiles(src, (geometry) => {
    if (
      geometry.paletteRef === undefined ||
      normalizePath(geometry.paletteRef) !== from
    ) {
      return null;
    }
    if (to === null) {
      const { paletteRef: _drop, ...rest } = geometry;
      return rest;
    }
    return { ...geometry, paletteRef: to };
  });
}

// Pure per-file rename/move over the source: a full-path rename IS
// a move (§8). Returns the updated source, or null if disallowed (the
// manifest anchor, a name clash in the target, a manifest-less geometry
// file, or a reference losing its §8 extension). Kept side-effect-free
// so a folder move can fold it over every contained file, so the
// manifest / palette / external-anim reference-following lives in ONE
// place shared by single-file rename and whole-folder move.
export function renameFileInSource(
  src: LoadedSource,
  from: string,
  to: string,
): LoadedSource | null {
  if (from === to || to === '' || to.startsWith('../')) return null;
  if (src.manifestPath === from) return null; // the anchor
  if (src.files.has(to)) return null;
  const text = src.files.get(from);
  if (text === undefined) return null;
  const isPrimary = src.primaryPath === from;
  const inGeometry = src.geometries.has(from);
  // Geometry renames must be recorded in the manifest — without one the
  // loader can't find the file next time. And a reference keeps its §8
  // extension.
  if (isPrimary || inGeometry) {
    if (src.manifest === undefined) return null;
    if (!to.toLowerCase().endsWith('.json')) return null;
  }
  const isPaletteRef = geometryPaletteRefs(src).has(from);
  if (isPaletteRef && !to.toLowerCase().endsWith('.json')) return null;
  const isAnimRef =
    src.manifest?.animations !== undefined &&
    Object.values(src.manifest.animations).some(
      (a) => typeof a === 'string' && normalizePath(a) === from,
    );
  if (isAnimRef && !to.toLowerCase().endsWith('.json')) return null;

  const files = new Map(src.files);
  files.delete(from);
  files.set(to, text);
  const removedFiles = new Set(src.removedFiles ?? []);
  removedFiles.add(from);
  removedFiles.delete(to);
  let next: LoadedSource = { ...src, files, removedFiles };

  if (inGeometry) {
    const geometries = new Map(src.geometries);
    geometries.set(to, geometries.get(from)!);
    geometries.delete(from);
    next = { ...next, geometries };
  }
  if (isPrimary) next = { ...next, primaryPath: to };
  // Keep the resolved externalAnims records pointing at the new path —
  // timeline edits write through `rec.path`, so a stale one would
  // resurrect the old file and orphan the manifest's ref.
  if (src.externalAnims !== undefined) {
    let anims: Map<string, { path: string; anim: InlineAnimation }> | null =
      null;
    for (const [clip, rec] of src.externalAnims) {
      if (rec.path !== from) continue;
      if (anims === null) anims = new Map(src.externalAnims);
      anims.set(clip, { path: to, anim: rec.anim });
    }
    if (anims !== null) next = { ...next, externalAnims: anims };
  }

  if (src.manifest !== undefined) {
    let m = src.manifest;
    let changed = false;
    if (isPrimary || inGeometry) {
      const geometry = manifestGeometry(m).map((g) =>
        normalizePath(g) === from ? to : normalizePath(g),
      );
      m = { ...m, geometry };
      changed = true;
    }
    if (m.animations !== undefined) {
      const rebuilt: NonNullable<Manifest['animations']> = {};
      let animChanged = false;
      for (const [aName, anim] of Object.entries(m.animations)) {
        if (typeof anim === 'string' && normalizePath(anim) === from) {
          rebuilt[aName] = to;
          animChanged = true;
        } else {
          rebuilt[aName] = anim;
        }
      }
      if (animChanged) {
        m = { ...m, animations: rebuilt };
        changed = true;
      }
    }
    if (changed) next = withManifest(next, m);
  }
  // A palette file rename is followed by the geometry files that point
  // at it, in this same step (one undo).
  if (isPaletteRef) next = repointPaletteRef(next, from, to);
  return next;
}

// Relocate a whole folder: fold renameFileInSource over every file under
// `from`, re-prefixing each to `newDir`. Backs both drag-move (newDir =
// destination/name) and rename (newDir = parent/newName). Returns null
// (whole-move aborts) if the folder holds no files or any file rejects.
export function moveFolderInSource(
  src: LoadedSource,
  from: string,
  newDir: string,
): LoadedSource | null {
  if (newDir === from || newDir === '') return null;
  if (newDir.startsWith(`${from}/`)) return null; // into itself
  const prefix = `${from}/`;
  const moving = [...src.files.keys()].filter((p) => p.startsWith(prefix)).sort();
  if (moving.length === 0) return null;
  let next: LoadedSource = src;
  for (const p of moving) {
    const stepped = renameFileInSource(next, p, `${newDir}${p.slice(from.length)}`);
    if (stepped === null) return null; // abort the whole move
    next = stepped;
  }
  return next;
}

// Pure single-file delete over the source: drop the file, mark it
// removed (Save deletes it from disk; undo restores it), and prune every
// manifest reference to it (geometry list, bound palette + its resolved
// record, external-anim clips). Returns null if the file is pinned (the
// anchor or primary geometry) or already gone. Extracted from
// handleDeleteFile so a folder delete can fold it over the subtree.
export function deleteFileInSource(src: LoadedSource, p: string): LoadedSource | null {
  if (src.manifestPath === p) return null; // the anchor
  if (src.primaryPath === p) return null; // primary geometry
  if (!src.files.has(p)) return null;
  const files = new Map(src.files);
  files.delete(p);
  const removedFiles = new Set(src.removedFiles ?? []);
  removedFiles.add(p);
  let next: LoadedSource = { ...src, files, removedFiles };
  if (src.geometries.has(p)) {
    const geometries = new Map(src.geometries);
    geometries.delete(p);
    next = { ...next, geometries };
  }
  if (src.externalAnims !== undefined) {
    let anims: Map<string, { path: string; anim: InlineAnimation }> | null =
      null;
    for (const [clip, rec] of src.externalAnims) {
      if (rec.path !== p) continue;
      if (anims === null) anims = new Map(src.externalAnims);
      anims.delete(clip);
    }
    if (anims !== null) {
      if (anims.size > 0) {
        next = { ...next, externalAnims: anims };
      } else {
        const { externalAnims: _drop, ...rest } = next;
        next = rest;
      }
    }
  }
  if (src.manifest !== undefined) {
    let m = src.manifest;
    let changed = false;
    if (
      m.geometry !== undefined &&
      m.geometry.some((g) => normalizePath(g) === p)
    ) {
      m = { ...m, geometry: m.geometry.filter((g) => normalizePath(g) !== p) };
      changed = true;
    }
    // Deleting an external animation file removes the clips that
    // referenced it and their resolved records, in this same step.
    if (m.animations !== undefined) {
      const rebuilt: NonNullable<Manifest['animations']> = {};
      let animChanged = false;
      for (const [aName, anim] of Object.entries(m.animations)) {
        if (typeof anim === 'string' && normalizePath(anim) === p) {
          animChanged = true;
          continue;
        }
        rebuilt[aName] = anim;
      }
      if (animChanged) {
        if (Object.keys(rebuilt).length > 0) {
          m = { ...m, animations: rebuilt };
        } else {
          const { animations: _drop, ...rest } = m;
          m = rest;
        }
        changed = true;
      }
    }
    if (changed) next = withManifest(next, m);
  }
  // Deleting the palette file itself: the geometry files that pointed at
  // it keep the colors they last resolved, written back out inline.
  if (geometryPaletteRefs(src).has(p)) next = repointPaletteRef(next, p, null);
  return next;
}


// A model-wide-unique part name (§5): `base` if free, else `base-2`, `-3`…
// (`-` is a legal identifier char, so the suffix keeps the name valid).
export function uniquePartName(existing: ReadonlySet<string>, base: string): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// ── text edits ─────────────────────────────────────────────────────────

export interface FileEditResult {
  source: LoadedSource;
  // Non-null while the new text does not parse. UI state, not document
  // state: it is a pure function of the text, so undo/redo re-derives it
  // rather than restoring it.
  error: string | null;
}

// Record `text` for `path` and re-derive whatever that file feeds:
//   a geometry file   → its AST (with its §7.4 palette resolved)
//   the manifest      → the manifest AST and every reference it resolves
//   a palette file    → the colors of every geometry pointing at it
//   an animation file → the resolved clip records
//
// Text that does NOT parse only records the text; the last good derived
// value stands until it parses again. That is what keeps the 3D view from
// flickering through the invalid states every keystroke passes through —
// the job a 300ms debounce used to do, without a timer to cancel, flush,
// or reason about. Parsing a package file costs microseconds, so there is
// nothing to defer.
export function applyFileEdit(
  src: LoadedSource,
  path: string,
  text: string,
): FileEditResult {
  // A stale handler must not resurrect a file the package no longer has.
  // Creating one goes through writeFile, which has no such guard.
  if (!src.files.has(path)) return { source: src, error: null };
  return deriveAfterWrite(src, path, text);
}

function deriveAfterWrite(
  src: LoadedSource,
  path: string,
  text: string,
): FileEditResult {
  const next = putText(src, path, text);

  if (path === src.manifestPath) {
    const json = tryJson(text);
    if ('error' in json) return { source: next, error: json.error };
    const r = parseManifest(json.value);
    if (!r.ok) return { source: next, error: r.message };
    return { source: withResolvedRefs(next, r.value), error: null };
  }

  if (isGeometryPath(path, src.primaryPath, src.manifest)) {
    const r = parseGeometryText(text);
    if (!r.ok) return { source: next, error: r.message };
    const geometries = new Map(next.geometries);
    geometries.set(
      path,
      withResolvedPalette(r.value, (p) => next.files.get(p)),
    );
    return { source: { ...next, geometries }, error: null };
  }

  if (path.toLowerCase().endsWith('.json')) {
    const json = tryJson(text);
    if ('error' in json) return { source: next, error: json.error };
    let out = next;
    // A palette file feeds every geometry that points at it (§7.4). A
    // schema-invalid edit keeps the last good colors.
    if (geometryPaletteRefs(out).has(path)) {
      const pR = parsePaletteFile(json.value);
      if (pR.ok) {
        const colors = pR.value;
        out = mapGeometryFiles(out, (g) =>
          sharesPalette(g, path) ? { ...g, palette: colors } : null,
        );
      }
    }
    // An animation file feeds the clip records the timeline writes through.
    if (out.externalAnims !== undefined) {
      let anims: Map<string, { path: string; anim: InlineAnimation }> | null =
        null;
      for (const [clip, rec] of out.externalAnims) {
        if (rec.path !== path) continue;
        const parsed = InlineAnimationSchema.safeParse(json.value);
        if (!parsed.success) break; // keep last good
        if (anims === null) anims = new Map(out.externalAnims);
        anims.set(clip, { path, anim: parsed.data });
      }
      if (anims !== null) out = { ...out, externalAnims: anims };
    }
    return { source: out, error: null };
  }

  // Anything else (.md / .txt) is just text.
  return { source: next, error: null };
}

// Re-resolve everything the manifest references, after it changed.
export function withResolvedRefs(
  src: LoadedSource,
  manifest: Manifest,
): LoadedSource {
  const refs = resolveProjectRefs(manifest, (p) => src.files.get(p), {
    path: src.primaryPath,
    geometry: primaryGeometry(src),
  });
  const {
    manifestError: _err,
    externalAnims: _anims,
    projectErrors: _proj,
    ...rest
  } = src;
  return {
    ...rest,
    manifest,
    geometries: refs.geometries,
    ...(refs.externalAnims !== undefined && { externalAnims: refs.externalAnims }),
    ...(refs.projectErrors.length > 0 && { projectErrors: refs.projectErrors }),
  };
}

function tryJson(text: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: `JSON parse: ${(e as Error).message}` };
  }
}
