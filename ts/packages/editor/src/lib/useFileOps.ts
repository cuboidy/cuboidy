import { useCallback } from 'react';
import { AIR, manifestGeometry, type Geometry, type Manifest, type Part } from '@cuboidy/core';
import { serializeGeometry } from '@cuboidy/core';
import { normalizePath } from './load-model.js';
import {
  deleteFileInSource,
  mergeGeometries,
  moveFolderInSource,
  primaryGeometry,
  renameFileInSource,
  withManifest,
} from './source-ops.js';
import type { LoadedSource, LoadResult } from './types.js';

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

export function useFileOps({ dispatchEdit, setFileParseErrors }: Params) {
  // ── File CRUD (Phase D). Folder sources with a files map only; each
  // operation is one dispatchEdit = one atomic undo step. The manifest
  // is the reference anchor, so structural file ops keep its geometry /
  // palette / animation refs in sync and re-serialize it. ──

  const handleCreateFile = useCallback(
    (path: string) => {
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined
        ) {
          return current;
        }
        const norm = normalizePath(path);
        if (norm === '' || norm.startsWith('../')) return current;
        if (
          src.files.has(norm) ||
          src.primaryPath === norm ||
          src.manifestPath === norm
        ) {
          return current;
        }
        // Creating a file used to state its role through the extension: a
        // `.cvox` name meant geometry, any other `.json` meant a palette or an
        // animation clip. With one extension for everything that signal is
        // gone, so fall back to the layout conventions of SPEC §3 — a clip
        // lives under `anims/`, the palette binding is conventionally
        // `palette.json` — and treat every other new `.json` as geometry,
        // which is the only thing this flow ever templated.
        // TODO: replace with an explicit type picker in the create UI.
        const lower = norm.toLowerCase();
        const isGeometry =
          lower.endsWith('.json') &&
          !lower.startsWith('anims/') &&
          !lower.endsWith('/palette.json') &&
          lower !== 'palette.json';
        let text: string;
        let parsed: Geometry | null = null;
        if (isGeometry) {
          // Template: one all-air part — valid with or without a palette
          // (§7.4). Part name unique model-wide (§5).
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
          parsed = { palette: [], parts: [part] };
          text = serializeGeometry(parsed);
        } else {
          text = norm.toLowerCase().endsWith('.json') ? '{}\n' : '';
        }
        const files = new Map(src.files);
        files.set(norm, text);
        const removedFiles = new Set(src.removedFiles ?? []);
        removedFiles.delete(norm); // re-creating a removed path revives it
        let next: typeof src = { ...src, files, removedFiles };
        if (isGeometry && parsed !== null) {
          const geometries = new Map(
            src.geometries ?? [[src.primaryPath, primaryGeometry(src)]],
          );
          geometries.set(norm, parsed);
          next = { ...next, geometries };
          // Reference it from the manifest so it's part of the model
          // (unreferenced files are ignored + lint as W07).
          if (src.manifest !== undefined) {
            const geometry = manifestGeometry(src.manifest).map(normalizePath);
            if (!geometry.includes(norm)) geometry.push(norm);
            const nextManifest: Manifest = { ...src.manifest, geometry };
            next = withManifest(next, nextManifest);
          }
        }
        return { ...current, source: next };
      });
    },
    [dispatchEdit],
  );

  // Reference an existing-but-unreferenced geometry file from the manifest's
  // geometry list so its parts join the model (the fix-it for lint W07:
  // files outside the list are ignored). Re-resolves the derived maps in
  // the same edit, so one undo both drops the reference and unloads the
  // parts again.
  const handleAddFileToModel = useCallback(
    (path: string) => {
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined ||
          src.manifest === undefined
        ) {
          return current;
        }
        const norm = normalizePath(path);
        if (!src.files.has(norm)) return current;
        const geometry = manifestGeometry(src.manifest).map(normalizePath);
        if (geometry.includes(norm)) return current;
        geometry.push(norm);
        const nextManifest: Manifest = { ...src.manifest, geometry };
        return { ...current, source: withManifest(src, nextManifest) };
      });
    },
    [dispatchEdit],
  );

  const handleRenameFile = useCallback(
    (oldPath: string, newPath: string) => {
      const from = normalizePath(oldPath);
      const to = normalizePath(newPath);
      // Land any pending reparses first: the rename re-keys the file's
      // AST/geometry entry, and a timer firing later (keyed to the OLD
      // path) would no-op, leaving a stale AST under the new name.
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined
        ) {
          return current;
        }
        const next = renameFileInSource(src, from, to);
        return next === null ? current : { ...current, source: next };
      });
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
    [dispatchEdit, setFileParseErrors],
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
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined
        ) {
          return current;
        }
        const next = moveFolderInSource(src, from, newDir);
        return next === null ? current : { ...current, source: next };
      });
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
    [dispatchEdit, setFileParseErrors],
  );

  // Move a folder INTO destDir ('' = package root), keeping its name.
  const handleMoveFolder = useCallback(
    (srcDir: string, destDir: string) => {
      const from = normalizePath(srcDir);
      const dest = normalizePath(destDir);
      if (dest === from || dest.startsWith(`${from}/`)) return; // self/descendant
      const name = from.slice(from.lastIndexOf('/') + 1);
      relocateFolder(from, dest === '' ? name : `${dest}/${name}`);
    },
    [relocateFolder],
  );

  // Rename a folder in place (its last path segment), moving every file
  // under it to the new prefix.
  const handleRenameFolder = useCallback(
    (oldDir: string, newName: string) => {
      const from = normalizePath(oldDir);
      const i = from.lastIndexOf('/');
      const parent = i === -1 ? '' : from.slice(0, i);
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
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined
        ) {
          return current;
        }
        const next = deleteFileInSource(src, p);
        return next === null ? current : { ...current, source: next };
      });
      setFileParseErrors((prev) => {
        if (!prev.has(p)) return prev;
        const next = new Map(prev);
        next.delete(p);
        return next;
      });
    },
    [dispatchEdit, setFileParseErrors],
  );

  // Delete a whole folder — every file under it, atomically (one undo).
  // Aborts if the folder holds a pinned file (the primary geometry); the
  // Files tree only offers the affordance when it doesn't. Draft (empty)
  // folders have no files here and are pruned in the tree's UI state.
  const handleDeleteFolder = useCallback(
    (dir: string) => {
      const from = normalizePath(dir);
      const prefix = `${from}/`;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined
        ) {
          return current;
        }
        const targets = [...src.files.keys()]
          .filter((k) => k.startsWith(prefix))
          .sort();
        if (targets.length === 0) return current;
        let next: LoadedSource = src;
        for (const k of targets) {
          const stepped = deleteFileInSource(next, k);
          if (stepped === null) return current; // a pinned file aborts
          next = stepped;
        }
        return { ...current, source: next };
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
    [dispatchEdit, setFileParseErrors],
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
