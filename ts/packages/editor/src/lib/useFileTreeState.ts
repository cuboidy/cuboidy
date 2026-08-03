import { useEffect, useMemo, useState } from 'react';
import { buildFsTree, dirsOf, type DirNode } from './fs-tree.js';
import { pathDirname } from './source-ops.js';
import type { LoadedSource } from './types.js';

// The Files panel's own state: what is selected, collapsed, being renamed,
// being created, and being dragged. None of it is document state — it
// survives no reload and appears in no undo step — but there is enough of
// it (eight pieces) that leaving it inline buried the rendering.
//
// It also has to defend itself against the document changing underneath:
// a rename or delete can take the selected path out from under the
// selection, so what the panel HIGHLIGHTS is derived against the current
// path set rather than trusted from state.

export interface TreeNodeRef {
  kind: 'dir' | 'file';
  path: string;
}

export function useFileTreeState(source: LoadedSource) {
  // Directory path ('' = package root) that has an open new-file draft,
  // or null. Folder "+" buttons target their own directory.
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  // Directory a new-FOLDER draft is open in ('' = root), or null.
  const [creatingFolderIn, setCreatingFolderIn] = useState<string | null>(null);
  // Session-draft empty folders (paths). They materialize on disk only
  // once a file is created inside, and are pruned automatically when that
  // happens (buildFsTree already shows dirs that contain files).
  const [draftDirs, setDraftDirs] = useState<ReadonlySet<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  // Folder path whose name is being edited inline (double-click), or null.
  const [renamingDir, setRenamingDir] = useState<string | null>(null);
  // Collapsed folder paths ('' = package root). Absent = expanded (the
  // default), so a freshly loaded package shows everything — matches the
  // Parts tree's collapse model.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // The selected NODE (VS Code-style single selection): a folder or a
  // file. Creation targets the selected folder, or a selected file's
  // containing folder.
  const [selected, setSelected] = useState<TreeNodeRef | null>(null);
  // Drag-and-drop move: what is being dragged (a file, or a whole folder)
  // and the row under the cursor. A file drop reuses onRenameFile and a
  // folder drop onMoveFolder — a full-path rename IS a move (§8), so the
  // manifest/extension guards all live in those handlers.
  const [dragging, setDragging] = useState<TreeNodeRef | null>(null);
  // The row currently under the cursor as a drop target: a folder (drop
  // INTO it) or a file (drop into the file's containing folder). A drop
  // always resolves to a directory; the descriptor just drives which row
  // highlights.
  const [dropTarget, setDropTarget] = useState<TreeNodeRef | null>(null);

  const toggleCollapse = (dir: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });

  // A new-file / new-folder draft must be visible: expand the folder it
  // opens in and every ancestor (incl. root) so it cannot hide in a
  // collapsed branch. Mirrors the Parts tree's create-forces-open rule.
  useEffect(() => {
    const target = creatingIn ?? creatingFolderIn;
    if (target === null) return;
    setCollapsed((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let changed = next.delete('');
      if (target !== '') {
        const segs = target.split('/');
        for (let i = 1; i <= segs.length; i++) {
          if (next.delete(segs.slice(0, i).join('/'))) changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [creatingIn, creatingFolderIn]);

  // Every path the package holds. The primary geometry and the manifest
  // are entries in `files` like any other, but naming them explicitly
  // keeps the tree correct for a lone-file load too.
  const allPaths = useMemo(() => {
    const paths = new Set<string>(source.files.keys());
    if (source.primaryPath !== undefined) paths.add(source.primaryPath);
    paths.add(source.manifestPath);
    return paths;
  }, [source]);

  const tree: DirNode = useMemo(
    () => buildFsTree(allPaths, draftDirs),
    [allPaths, draftDirs],
  );

  // Every directory that currently exists. Guards the selection against
  // directories that vanished under it.
  const allDirs = useMemo(
    () => new Set([...dirsOf(allPaths), ...dirsOf(draftDirs, true)]),
    [allPaths, draftDirs],
  );

  // Where New file / New folder create: the selected folder, or a selected
  // file's containing folder. A vanished node falls back to the root.
  const effectiveDir = ((): string => {
    if (selected === null) return '';
    if (selected.kind === 'dir') {
      return selected.path === '' || allDirs.has(selected.path)
        ? selected.path
        : '';
    }
    if (!allPaths.has(selected.path)) return '';
    return pathDirname(selected.path);
  })();

  // Exactly ONE node carries the selection highlight — a folder or a file,
  // never both. What is OPEN is the dock tabs' job, not the tree's.
  const selectedDir =
    selected?.kind === 'dir' &&
    (selected.path === '' || allDirs.has(selected.path))
      ? selected.path
      : null;
  const selectedFile =
    selected?.kind === 'file' && allPaths.has(selected.path)
      ? selected.path
      : null;

  return {
    creatingIn,
    setCreatingIn,
    creatingFolderIn,
    setCreatingFolderIn,
    draftDirs,
    setDraftDirs,
    renamingPath,
    setRenamingPath,
    renamingDir,
    setRenamingDir,
    collapsed,
    toggleCollapse,
    selected,
    setSelected,
    dragging,
    setDragging,
    dropTarget,
    setDropTarget,
    allPaths,
    allDirs,
    tree,
    effectiveDir,
    selectedDir,
    selectedFile,
  };
}
