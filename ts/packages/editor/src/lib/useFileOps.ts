import { useCallback } from 'react';
import { AIR, manifestGeometry, type Manifest, type Part } from '@cuboidy/core';
import { serializeGeometry } from '@cuboidy/core';
import type { NewFileKind } from './file-name-rules.js';
import { normalizePath } from './load-model.js';
import { deleteFileInSource, mergeGeometries, moveFolderInSource, paletteFileText, pathBasename, pathDirname, renameFileInSource, withManifest } from './source-ops.js';
import type { LoadedSource, LoadResult } from './types.js';
import { useSourceMutations } from './useSourceMutations.js';

// Creating, renaming, moving and deleting package files. Each operation is
// ONE dispatchEdit, so it is one undo step even when it touches several
// files: the reference-following (manifest geometry list, palette refs,
// animation refs and their resolved records) lives in source-ops and has
// to land atomically or the model stops loading.
//
// Live parse errors are re-keyed alongside, since they are addressed by
// path and a rename moves the path out from under them.

interface Params {
  dispatchEdit: (
    tag: string | null,
    apply: (c: LoadResult | null) => LoadResult | null,
  ) => void;
  setFileParseErrors: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, string>>
  >;
}

// The manifest's geometry LIST as it should be written back when adding a
// reference. `manifestGeometry()` is wrong here: it supplies the
// `["voxels.json"]` default, and writing that back names a file that does
// not exist for any model that never had a list — an all-inline one above
// all (§6.9 says the default is not to be materialised).
function geometryListToExtend(m: Manifest): string[] {
  if (m.geometry !== undefined) return m.geometry.map(normalizePath);
  return m.parts.some((p) => p.geometry === undefined)
    ? manifestGeometry(m).map(normalizePath)
    : [];
}

// A new file's starting contents. Each template is a VALID document of
// its kind, so the file parses the moment it exists and the Console has
// nothing to report about a file the user just made.
function newFileText(src: LoadedSource, kind: NewFileKind): string {
  switch (kind) {
    case 'geometry': {
      // One all-air part — valid with or without a palette (§7.4). The
      // name is unique model-wide (§5) so adopting the file cannot
      // collide with a part that already exists.
      const names = new Set(mergeGeometries(src).parts.map((p) => p.name));
      let n = 1;
      while (names.has(`part${n}`)) n += 1;
      const part: Part = {
        name: `part${n}`,
        size: { w: 1, h: 1, d: 1 },
        pivot: { pos: { x: 0.5, y: 0, z: 0.5 } },
        sockets: [],
        voxels: [[[AIR]]],
      };
      return serializeGeometry({ palette: [], parts: [part] });
    }
    // §6.10 requires at least one color, so an empty `colors` array would
    // be an invalid palette file rather than an empty one.
    case 'palette':
      return paletteFileText([{ r: 255, g: 255, b: 255, a: 255 }]);
    case 'clip':
      return (
        JSON.stringify({ duration: 1, loop: true, parts: {} }, null, 2) + '\n'
      );
    case 'text':
      return '';
  }
}

export function useFileOps({ dispatchEdit, setFileParseErrors }: Params) {
  // ── File CRUD (Phase D). Folder sources with a files map only; each
  // operation is one dispatchEdit = one atomic undo step. The manifest
  // is the reference anchor, so structural file ops keep its geometry /
  // palette / animation refs in sync and re-serialize it.
  //
  // No editsBlocked gate: file operations don't re-serialize an AST over
  // a mid-edit file, so they stay available while text is unparseable. ──
  const { mutateSource } = useSourceMutations({ dispatchEdit });

  // Create a file of a STATED kind. The kind comes from the tree's draft
  // row rather than from the name, because the name cannot carry it: a
  // v0.9 package references geometry, palettes and clips all as `.json`
  // (§8). Guessing it from `anims/` and `palette.json` conventions meant
  // a palette named `colors.json` was created as a geometry file, and
  // the two non-geometry templates were `{}`, which is not a valid file
  // of either kind.
  //
  // Creating does NOT reference the file from the manifest. Writing a
  // file is a file operation; joining the model is a model edit, and it
  // belongs to the panel that owns that kind of reference — the same
  // reason the tree no longer carries a "load" button. A new file shows
  // up as "not loaded" until adopted there.
  const handleCreateFile = useCallback(
    (path: string, kind: NewFileKind) => {
      mutateSource(null, (src) => {
        const norm = normalizePath(path);
        if (norm === '' || norm.startsWith('../')) return null;
        if (src.files.has(norm) || src.manifestPath === norm) {
          return null;
        }
        const files = new Map(src.files);
        files.set(norm, newFileText(src, kind));
        const removedFiles = new Set(src.removedFiles ?? []);
        removedFiles.delete(norm); // re-creating a removed path revives it
        return { ...src, files, removedFiles };
      });
    },
    [mutateSource],
  );

  // Reference an existing-but-unreferenced geometry file from the manifest's
  // geometry list so its parts join the model (the fix-it for lint W07:
  // files outside the list are ignored). Re-resolves the derived maps in
  // the same edit, so one undo both drops the reference and unloads the
  // parts again.
  const handleAddFileToModel = useCallback(
    (path: string) => {
      mutateSource(null, (src) => {
        if (src.manifest === undefined) return null;
        const norm = normalizePath(path);
        if (!src.files.has(norm)) return null;
        const geometry = geometryListToExtend(src.manifest);
        if (geometry.includes(norm)) return null;
        geometry.push(norm);
        return withManifest(src, { ...src.manifest, geometry });
      });
    },
    [mutateSource],
  );

  const handleRenameFile = useCallback(
    (oldPath: string, newPath: string) => {
      const from = normalizePath(oldPath);
      const to = normalizePath(newPath);
      // Land any pending reparses first: the rename re-keys the file's
      // AST/geometry entry, and a timer firing later (keyed to the OLD
      // path) would no-op, leaving a stale AST under the new name.
      mutateSource(null, (src) => renameFileInSource(src, from, to));
      // Re-key any live parse error for the renamed file.
      setFileParseErrors((prev) => {
        if (!prev.has(from)) return prev;
        const next = new Map(prev);
        const msg = next.get(from)!;
        next.delete(from);
        next.set(to, msg);
        return next;
      });
    },
    [mutateSource, setFileParseErrors],
  );

  // Relocate a whole folder (and everything under it) so its new path is
  // `newDir`. One dispatchEdit = one undo step: moveFolderInSource folds
  // the per-file rename atomically — any single rejection (e.g. a
  // manifest-less geometry file) aborts the entire move, leaving the
  // source untouched. The Files tree gates the operation so a valid one
  // never half-applies. Shared by folder drag-move and folder rename.
  const relocateFolder = useCallback(
    (from: string, newDir: string) => {
      if (newDir === from) return;
      mutateSource(null, (src) => moveFolderInSource(src, from, newDir));
      // Re-key live parse errors under the folder by path prefix.
      setFileParseErrors((prev) => {
        const prefix = `${from}/`;
        let next: Map<string, string> | null = null;
        for (const [p, msg] of prev) {
          if (!p.startsWith(prefix)) continue;
          if (next === null) next = new Map(prev);
          next.delete(p);
          next.set(`${newDir}${p.slice(from.length)}`, msg);
        }
        return next ?? prev;
      });
    },
    [mutateSource, setFileParseErrors],
  );

  // Move a folder INTO destDir ('' = package root), keeping its name.
  const handleMoveFolder = useCallback(
    (srcDir: string, destDir: string) => {
      const from = normalizePath(srcDir);
      const dest = normalizePath(destDir);
      if (dest === from || dest.startsWith(`${from}/`)) return; // self/descendant
      const name = pathBasename(from);
      relocateFolder(from, dest === '' ? name : `${dest}/${name}`);
    },
    [relocateFolder],
  );

  // Rename a folder in place (its last path segment), moving every file
  // under it to the new prefix.
  const handleRenameFolder = useCallback(
    (oldDir: string, newName: string) => {
      const from = normalizePath(oldDir);
      const parent = pathDirname(from);
      relocateFolder(
        from,
        normalizePath(parent === '' ? newName : `${parent}/${newName}`),
      );
    },
    [relocateFolder],
  );

  const handleDeleteFile = useCallback(
    (path: string) => {
      const p = normalizePath(path);
      mutateSource(null, (src) => deleteFileInSource(src, p));
      setFileParseErrors((prev) => {
        if (!prev.has(p)) return prev;
        const next = new Map(prev);
        next.delete(p);
        return next;
      });
    },
    [mutateSource, setFileParseErrors],
  );

  // Delete a whole folder — every file under it, atomically (one undo).
  // Aborts if the folder holds a pinned file (the primary geometry); the
  // Files tree only offers the affordance when it doesn't. Draft (empty)
  // folders have no files here and are pruned in the tree's UI state.
  const handleDeleteFolder = useCallback(
    (dir: string) => {
      const from = normalizePath(dir);
      const prefix = `${from}/`;
      mutateSource(null, (src) => {
        const targets = [...src.files.keys()]
          .filter((k) => k.startsWith(prefix))
          .sort();
        if (targets.length === 0) return null;
        let next: LoadedSource = src;
        for (const k of targets) {
          const stepped = deleteFileInSource(next, k);
          if (stepped === null) return null; // a pinned file aborts
          next = stepped;
        }
        return next;
      });
      setFileParseErrors((prev) => {
        let next: Map<string, string> | null = null;
        for (const key of prev.keys()) {
          if (!key.startsWith(prefix)) continue;
          if (next === null) next = new Map(prev);
          next.delete(key);
        }
        return next ?? prev;
      });
    },
    [mutateSource, setFileParseErrors],
  );
  return {
    handleCreateFile,
    handleAddFileToModel,
    handleRenameFile,
    handleMoveFolder,
    handleRenameFolder,
    handleDeleteFile,
    handleDeleteFolder,
  };
}
