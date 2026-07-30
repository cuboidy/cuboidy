import {
  manifestGeometry,
  serializeColor,
  serializeGeometry,
  type Geometry,
  type InlineAnimation,
  type Manifest,
  type Palette,
  type Part,
} from '@cuboidy/core';
import { normalizePath } from './load-model.js';
import type { FileEntry, LoadedSource } from './types.js';

// Pure operations over a loaded source: the union of every geometry file's
// parts, per-file AST rewrites, palette-reference following, and the
// file-level rename / move / delete that keep the model's references intact.
//
// None of this touches React. It lives here rather than in App.tsx because
// it is the part of the editor most worth testing directly: renaming or
// deleting a file has to follow references through the manifest, the
// geometry files and the resolved animation records at once, and a
// half-applied rewrite is exactly the bug a type checker cannot see.

// v0.7 multi-geometry (Phase C): the DISPLAY model is the union of every
// geometry file's parts, in geometry-list order. The primary file's
// live AST (source.geometry) overrides its load-time snapshot in
// source.geometries so mid-edit state stays current. A cross-file
// duplicate name keeps the first definition (validateProject flags the
// error). `files` records each part's defining file — edit routing and
// the part tree's file badges.
export function mergeGeometries(src: LoadedSource): {
  parts: Part[];
  files: ReadonlyMap<string, string>;
} {
  const files = new Map<string, string>();
  if (src.geometries === undefined) {
    return { parts: src.geometry.parts, files };
  }
  const parts: Part[] = [];
  for (const [path, g] of src.geometries) {
    const geometry = path === src.geometryFile.name ? src.geometry : g;
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

// Apply `fn` to every geometry file AST (or the lone geometry when the
// source has no geometries map). Returns the source with each CHANGED
// file kept fully in sync: geometries map, the files snapshot (so
// export sees the edit), and — when the primary file changed — the live
// geometry/geometryFile pair the rest of the editor reads. `fn` returns
// null for "no change to this file".
export function mapGeometryFiles(
  src: LoadedSource,
  fn: (geometry: Geometry, path: string) => Geometry | null,
): LoadedSource {
  if (src.geometries === undefined) {
    const next = fn(src.geometry, src.geometryFile.name);
    if (next === null) return src;
    return {
      ...src,
      geometry: next,
      geometryFile: { ...src.geometryFile, text: serializeGeometry(next) },
    };
  }
  let geometries: Map<string, Geometry> | null = null;
  let files: Map<string, FileEntry> | null = null;
  let primaryPatch: Pick<typeof src, 'geometry' | 'geometryFile'> | null = null;
  for (const [path, g] of src.geometries) {
    const cur = path === src.geometryFile.name ? src.geometry : g;
    const next = fn(cur, path);
    if (next === null) continue;
    const text = serializeGeometry(next);
    if (geometries === null) geometries = new Map(src.geometries);
    geometries.set(path, next);
    if (src.files !== undefined) {
      if (files === null) files = new Map(src.files);
      files.set(path, { name: path, text });
    }
    if (path === src.geometryFile.name) {
      primaryPatch = { geometry: next, geometryFile: { ...src.geometryFile, text } };
    }
  }
  if (geometries === null) return src;
  return {
    ...src,
    geometries,
    ...(files !== null && { files }),
    ...(primaryPatch !== null && primaryPatch),
  };
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
  let files: Map<string, FileEntry> | null = null;
  for (const [clip, rec] of src.externalAnims) {
    const built = fn(rec.anim);
    if (built === null || built === rec.anim) continue;
    if (anims === null) anims = new Map(src.externalAnims);
    anims.set(clip, { path: rec.path, anim: built });
    if (src.files !== undefined) {
      if (files === null) files = new Map(src.files);
      files.set(rec.path, {
        name: rec.path,
        text: JSON.stringify(built, null, 2) + '\n',
      });
    }
  }
  if (anims === null) return src;
  return { ...src, externalAnims: anims, ...(files !== null && { files }) };
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

// Every (path, AST) pair in the model, with the LIVE primary preferred over
// its load-time snapshot — the same rule mergeGeometries applies.
export function geometryEntries(src: LoadedSource): Array<[string, Geometry]> {
  if (src.geometries === undefined) {
    return [[src.geometryFile.name, src.geometry]];
  }
  return [...src.geometries].map(([path, g]) => [
    path,
    path === src.geometryFile.name ? src.geometry : g,
  ]);
}

export function geometryAt(src: LoadedSource, path: string): Geometry | undefined {
  if (path === src.geometryFile.name) return src.geometry;
  return src.geometries?.get(path);
}

// Every §7.4 palette path the model's geometry files currently point at.
// The manifest is not consulted: since v0.9 a palette is referenced by the
// geometry file that uses it, never model-wide.
export function geometryPaletteRefs(src: LoadedSource): ReadonlySet<string> {
  const out = new Set<string>();
  const add = (g: Geometry): void => {
    if (g.paletteRef !== undefined) out.add(normalizePath(g.paletteRef));
  };
  add(src.geometry);
  for (const g of src.geometries?.values() ?? []) add(g);
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
  if (src.files === undefined) return null;
  if (from === to || to === '' || to.startsWith('../')) return null;
  if (src.manifestFile?.name === from) return null; // the anchor
  if (src.files.has(to) || src.manifestFile?.name === to) return null;
  const entry = src.files.get(from);
  if (entry === undefined) return null;
  const isPrimary = src.geometryFile.name === from;
  const inGeometry = src.geometries?.has(from) === true;
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
  files.set(to, { name: to, text: entry.text });
  const removedFiles = new Set(src.removedFiles ?? []);
  removedFiles.add(from);
  removedFiles.delete(to);
  let next: LoadedSource = { ...src, files, removedFiles };

  if (src.geometries?.has(from) === true) {
    const geometries = new Map(src.geometries);
    const geometry = geometries.get(from)!;
    geometries.delete(from);
    geometries.set(to, geometry);
    next = { ...next, geometries };
  }
  if (isPrimary) {
    next = { ...next, geometryFile: { ...src.geometryFile, name: to } };
  }
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
    if (changed) {
      const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
      next = {
        ...next,
        manifest: m,
        manifestFile: {
          ...baseFile,
          text: JSON.stringify(m, null, 2) + '\n',
        },
      };
    }
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
  if (src.files === undefined) return null;
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
  if (src.files === undefined) return null;
  if (src.manifestFile?.name === p) return null; // the anchor
  if (src.geometryFile.name === p) return null; // primary geometry
  if (!src.files.has(p)) return null;
  const files = new Map(src.files);
  files.delete(p);
  const removedFiles = new Set(src.removedFiles ?? []);
  removedFiles.add(p);
  let next: LoadedSource = { ...src, files, removedFiles };
  if (src.geometries?.has(p) === true) {
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
    if (changed) {
      const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
      next = {
        ...next,
        manifest: m,
        manifestFile: {
          ...baseFile,
          text: JSON.stringify(m, null, 2) + '\n',
        },
      };
    }
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
