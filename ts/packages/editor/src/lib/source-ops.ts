import { InlineAnimationSchema, parseGeometryText, parseManifest, parsePaletteFile, resolvePartGeometry, serializeColor, resolveRefFrom, serializeGeometry, toInlineGeometry, type Geometry, type InlineAnimation, type Manifest, type ManifestPart, type Palette, type Part } from '@cuboidy/core';
import { isGeometryPath, normalizePath, resolveProjectRefs, withResolvedPalette } from './load-model.js';
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

// The DISPLAY model: the model's parts under the names the RIG uses, in
// manifest order, followed by any geometry-file part no manifest part
// resolves to.
//
// This READS core's resolution (SPEC §6.13) instead of redoing it. It
// used to union the geometry files by hand, which silently disagreed with
// the rig the moment a part's shape was reached under another name: two
// rig parts sharing one shape showed up as the single part the FILE
// names, so the tree, the selection and every edit routed through it were
// looking at something the manifest did not contain.
//
// The unreferenced trailer is deliberate. Such a part is not in the model
// (§11.6 warns), but hiding it would mean a part just added to a geometry
// file were invisible until its manifest entry existed — so it stays
// listed and fixable.
export function mergeGeometries(src: LoadedSource): {
  parts: Part[];
  // Part name → the geometry file that defines it. A part written INLINE
  // in the manifest (SPEC §6.13) is deliberately ABSENT from this map
  // rather than mapped to `cuboidy.json`: callers use it to answer "which
  // geometry file do I rewrite?", and for an inline part the answer is
  // "none — rewrite the manifest". A sentinel would let that difference
  // pass unnoticed into code that then writes a geometry document over
  // the manifest.
  files: ReadonlyMap<string, string>;
} {
  const files = new Map<string, string>();
  const parts: Part[] = [];
  // Which DEFINITIONS the rig used, so the trailer below can tell an
  // unreferenced part from one reached under a different name.
  const used = new Map<string, Set<string>>();
  for (const [name, r] of src.parts) {
    parts.push(r.part);
    if (r.source === null) continue;
    files.set(name, r.source.file);
    let names = used.get(r.source.file);
    if (names === undefined) used.set(r.source.file, (names = new Set()));
    names.add(r.source.part);
  }
  for (const [path, geometry] of src.geometries) {
    for (const part of geometry.parts) {
      if (used.get(path)?.has(part.name) === true) continue;
      if (files.has(part.name) || src.parts.has(part.name)) continue;
      files.set(part.name, path);
      parts.push(part);
    }
  }
  return { parts, files };
}

// Is this part's shape written in the manifest (SPEC §6.13) rather than
// in a geometry file? The question every per-part geometry edit has to
// ask before it knows which document to rewrite.
export function isInlinePart(src: LoadedSource, name: string): boolean {
  const r = src.parts.get(name);
  return r !== undefined && r.source === null;
}

// Write a part's shape into the manifest as inline geometry (SPEC §6.13),
// creating the manifest part if it is not there yet. The geometry-file
// twin of this is mapGeometryFiles; both end at withManifest / writeFile,
// so either way the text and the AST move together.
//
// `build` receives the part's CURRENT shape (undefined when it has none
// yet) and returns the new one. Returning the same object is a no-op.
export function withInlinePart(
  src: LoadedSource,
  name: string,
  build: (current: Part | undefined) => Part,
): LoadedSource {
  if (src.manifest === undefined) return src;
  const current = src.parts.get(name)?.part;
  const next = build(current);
  if (next === current) return src;
  const parts = src.manifest.parts.slice();
  const i = parts.findIndex((p) => p.name === name);
  // `toInlineGeometry` is the SAME converter a geometry file's part goes
  // through, so a shape means identical bytes wherever it is written —
  // which is what makes moving a part between the two forms lossless.
  const geometry = {
    ...toInlineGeometry(next),
    // A palette the part declared for itself is its own (§6.13) and is not
    // part of the shape, so it survives a shape edit untouched.
    ...(currentInlinePalette(src, name) !== undefined && {
      palette: currentInlinePalette(src, name),
    }),
  };
  const entry: ManifestPart = { ...(i >= 0 ? parts[i]! : { name }), geometry };
  if (i >= 0) parts[i] = entry;
  else parts.push(entry);
  return withManifest(src, { ...src.manifest, parts });
}

// The `palette` an inline part declared for ITSELF, read back off the
// manifest rather than off the resolved value — the resolved one may have
// come from the manifest default, and writing that back would pin a part
// to colors it was only borrowing.
function currentInlinePalette(
  src: LoadedSource,
  name: string,
): NonNullable<Manifest['parts'][number]['geometry']>['palette'] {
  const g = src.manifest?.parts.find((p) => p.name === name)?.geometry;
  return g?.palette;
}

export function pathBasename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function pathDirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
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
  return withRebuiltParts({ ...src, geometries, files });
}

// Re-derive `parts` from the manifest and the geometry files (SPEC §6.13).
// `parts` is DERIVED state: it is what the two of them resolve to, so any
// write to either has to rebuild it or the model on screen drifts from the
// documents. Manifest writes go through withResolvedRefs, which rebuilds
// everything; this is the geometry-file side of the same obligation.
function withRebuiltParts(src: LoadedSource): LoadedSource {
  if (src.manifest === undefined) return src;
  const { parts } = resolvePartGeometry(
    src.manifest,
    [...src.geometries].map(([path, geometry]) => ({ path, geometry })),
    (ref) => {
      const text = src.files.get(normalizePath(ref));
      if (text === undefined) return null;
      try {
        const r = parsePaletteFile(JSON.parse(text));
        return r.ok ? r.value : null;
      } catch {
        return null;
      }
    },
  );
  return { ...src, parts };
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

// The primary geometry file's AST, or UNDEFINED when the model has no
// geometry file — every part's shape written inline in the manifest
// (SPEC §6.13). When there is one it is defined by construction: the
// loader refuses a package whose primary does not parse, and a live edit
// only amends the AST once the new text parses, so the last good one
// stands in meanwhile.
export function primaryGeometry(src: LoadedSource): Geometry | undefined {
  return src.primaryPath === undefined
    ? undefined
    : src.geometries.get(src.primaryPath);
}

// The model's fallback palette — the primary geometry FILE's colors, or,
// when there is no such file (SPEC §6.13, all inline), whatever the
// manifest resolved for its inline parts. Only a fallback: parts that
// disagree are covered per part by App's `partPalettes`, which is exactly
// why this can be a single reasonable guess rather than a merge.
export function modelPalette(src: LoadedSource): Palette {
  const primary = primaryGeometry(src);
  if (primary !== undefined) return primary.palette;
  for (const r of src.parts.values()) {
    if (r.source === null && r.palette.length > 0) return r.palette;
  }
  return [];
}

export function fileText(src: LoadedSource, path: string): string | undefined {
  return src.files.get(path);
}

export function manifestText(src: LoadedSource): string | undefined {
  return src.files.get(src.manifestPath);
}

// Canonical text for cuboidy.json.
function manifestJson(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}

// Write a manifest back into the source: the AST and its re-serialized text,
// together. EVERY structural edit that touches cuboidy.json goes through
// here, so the two cannot drift apart — and a package that has no manifest
// This used to be six lines repeated at fifteen call sites, which is also
// the shape that made the storage layout hard to change.
export function withManifest(
  src: LoadedSource,
  manifest: Manifest,
): LoadedSource {
  // Writing the manifest's TEXT is enough: writeFile re-derives the AST and
  // everything the manifest references. So a caller that changes the
  // geometry list, a palette binding or an animation ref does not have to
  // re-resolve anything by hand — that used to be its own block at three
  // call sites, each a chance to forget one of the four reference kinds.
  return writeFile(src, src.manifestPath, manifestJson(manifest));
}

// The typing path: record cuboidy.json's text WITHOUT touching the AST,
// which the debounced re-parse lands separately once the text parses.
export function withManifestText(src: LoadedSource, text: string): LoadedSource {
  const files = new Map(src.files);
  files.set(src.manifestPath, text);
  return { ...src, files };
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

// Does the geometry file at `path` resolve against the palette file at
// `ref` (a package-relative path)? Needs `path` because §8 resolves the
// reference against the file that wrote it — two files in different
// directories may both say `palette.json` and mean different files.
export function sharesPalette(
  path: string,
  geometry: Geometry,
  ref: string,
): boolean {
  return (
    geometry.paletteRef !== undefined &&
    resolveRefFrom(path, geometry.paletteRef) === ref
  );
}

export function geometryAt(src: LoadedSource, path: string): Geometry | undefined {
  return src.geometries.get(path);
}

// Every §7.4 palette path the model's geometry files currently point at.
// The manifest is not consulted: since v0.9 a palette is referenced by the
// geometry file that uses it, never model-wide.
function geometryPaletteRefs(src: LoadedSource): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [path, g] of src.geometries) {
    if (g.paletteRef !== undefined) out.add(resolveRefFrom(path, g.paletteRef));
  }
  return out;
}

// The inverse of resolveRefFrom: express the package-relative `target` as
// a reference written INSIDE `fromFile`. Renaming a palette file has to
// rewrite each referrer's ref, and a bare package-relative path would be
// wrong for any referrer that is not at the root (§8).
function relativeRefFrom(fromFile: string, target: string): string {
  const from = fromFile.split('/').slice(0, -1);
  const to = target.split('/');
  const name = to.pop()!;
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i += 1;
  const up = from.length - i;
  return [...Array<string>(up).fill('..'), ...to.slice(i), name].join('/');
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
  return mapGeometryFiles(src, (geometry, path) => {
    if (
      geometry.paletteRef === undefined ||
      resolveRefFrom(path, geometry.paletteRef) !== from
    ) {
      return null;
    }
    if (to === null) {
      const { paletteRef: _drop, ...rest } = geometry;
      return rest;
    }
    // `to` is package-relative; write it back relative to THIS file so the
    // reference still resolves to the same place from where it lives.
    return { ...geometry, paletteRef: relativeRefFrom(path, to) };
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
      // The top-level list — only when the manifest actually HAS one.
      // This used to call manifestGeometry(), which supplies the
      // `["voxels.json"]` default, and then wrote the result back: a
      // model with no list gained one naming a file that does not exist
      // (§6.9 says the default is not to be materialised).
      if (m.geometry !== undefined) {
        const geometry = m.geometry.map((g) =>
          normalizePath(g) === from ? to : normalizePath(g),
        );
        m = { ...m, geometry };
        changed = true;
      }
      // …and every part that reaches the file directly (SPEC §6.13). The
      // rename used to skip these entirely, leaving `geometry.path`
      // pointing at a file that had just been renamed away — a model that
      // loaded fine until the next time it was opened.
      let partsChanged = false;
      const parts = m.parts.map((p) => {
        if (p.geometry?.path === undefined) return p;
        if (normalizePath(p.geometry.path) !== from) return p;
        partsChanged = true;
        return { ...p, geometry: { ...p.geometry, path: to } };
      });
      if (partsChanged) {
        m = { ...m, parts };
        changed = true;
      }
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
      withResolvedPalette(r.value, (p) => next.files.get(p), path),
    );
    return { source: { ...next, geometries }, error: null };
  }

  if (path.toLowerCase().endsWith('.json')) {
    const json = tryJson(text);
    if ('error' in json) return { source: next, error: json.error };

    // A file the model REFERENCES has a schema, and breaking it is an
    // error like any other. These two checks used to run and then SWALLOW
    // the failure — keeping the last good AST, reporting nothing, and
    // leaving the broken bytes to be saved. What made that bad is not the
    // stale AST but the silence: with no error reported, the banner never
    // appears, structural edits stay unblocked, and the render keeps
    // showing colors the file no longer contains.
    if (geometryPaletteRefs(next).has(path)) {
      const pR = parsePaletteFile(json.value);
      if (!pR.ok) return { source: next, error: pR.message };
    }
    for (const [clip, rec] of next.externalAnims ?? []) {
      if (rec.path !== path) continue;
      const parsed = InlineAnimationSchema.safeParse(json.value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        const at = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return { source: next, error: `animation '${clip}': ${at}: ${issue.message}` };
      }
      break; // one file, one document — every clip on it parses alike
    }

    // Re-resolve the whole reference graph, exactly as a manifest edit
    // does. That lands the new colors / keyframes in the render AND
    // recomputes `projectErrors`, which otherwise kept reporting a
    // load-time problem in a file the author had just fixed.
    return {
      source:
        next.manifest === undefined ? next : withResolvedRefs(next, next.manifest),
      error: null,
    };
  }

  // Anything else (.md / .txt) is just text.
  return { source: next, error: null };
}

// Re-resolve everything the manifest references, after it changed.
function withResolvedRefs(
  src: LoadedSource,
  manifest: Manifest,
): LoadedSource {
  const primary = primaryGeometry(src);
  const refs = resolveProjectRefs(
    manifest,
    src.files,
    src.primaryPath !== undefined && primary !== undefined
      ? { path: src.primaryPath, geometry: primary }
      : undefined,
  );
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
    // Rebuilt, not merged: the manifest IS where part geometry is bound,
    // so a manifest change can add, alter, retarget or remove a part, and
    // keeping a stale entry would leave a deleted one on screen.
    parts: refs.parts,
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
