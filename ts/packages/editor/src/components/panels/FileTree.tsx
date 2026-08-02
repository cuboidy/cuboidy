import { useMemo, type DragEvent } from 'react';
import { geometryPaths } from '@cuboidy/core';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { InlineNameInput } from '@cuboidy/ui';
import { fileIcon } from '../ui/fileIcon.js';
import type { DirNode } from '../../lib/fs-tree.js';
import { useFileTreeState } from '../../lib/useFileTreeState.js';
import { normalizePath } from '../../lib/load-model.js';
import type { LoadedSource } from '../../lib/types.js';

interface Props {
  source: LoadedSource;
  // Current syntax / load error per path (undefined = none). Drives a
  // VS Code-style red filename; the tooltip carries the message.
  fileErrors: ReadonlyMap<string, string>;
  onOpenPath: (path: string) => void;
  // File CRUD (v0.7 Phase D). Only meaningful for sources carrying a
  // files map; the tree hides the affordances otherwise.
  onCreateFile: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  // Move a folder (and everything under it) into destDir ('' = root).
  // Drag-and-drop only; folds the per-file rename atomically (one undo).
  onMoveFolder: (srcDir: string, destDir: string) => void;
  // Rename a folder in place (its last segment), re-prefixing every file
  // under it. Double-click a folder row to trigger.
  onRenameFolder: (oldDir: string, newName: string) => void;
  onDeleteFile: (path: string) => void;
  // Delete a folder and every file under it (one undo).
  onDeleteFolder: (dir: string) => void;
  // Append an unreferenced geometry file to the manifest list so its
  // parts load (the tree's "not loaded" rows).
  onAddFileToModel: (path: string) => void;
}

// Files the loader reads as text (and therefore the only ones worth
// creating in the editor) — mirrors load-model's TEXT_FILE_RE.
const CREATABLE_RE = /^[^\\:]+\.(json|md|txt)$/i;

// The Files sidebar: the WHOLE package as a VS Code Explorer-shaped tree
// (v0.7 — every text file collected at load, not just the fixed pair).
// Clicking a file brings its dock panel to the foreground: the primary
// geometry opens the dedicated geometry panel, cuboidy.json the manifest
// panel, and any other file a dynamic `file:<path>` editor tab.
//
// CRUD: the toolbar "+ New file" / "+ New folder" create in the selected
// folder (a New file name may contain `/`; folders are implicit). A
// New folder draft is session-only until a file lands in it (the package
// model is a file map, so an empty folder has no on-disk representation).
// Double-click renames a file or folder (its name only — moving between
// folders is drag-and-drop, below); the hover × deletes (a folder ×
// deletes everything under it). An unreferenced geometry row carries a
// "load" button that adds it to the manifest geometry list. The manifest
// anchor is never renamable/deletable; the primary geometry is renamable
// only when a manifest records it, and never deletable.
//
// Drag-and-drop moves: drag a file onto a folder (or another file, to
// land in its folder) or drag a whole folder onto another folder /
// the root. A drop is a full-path rename under the hood, so it reuses
// the same reference-following guards.
export function FileTree({
  source,
  fileErrors,
  onOpenPath,
  onCreateFile,
  onRenameFile,
  onMoveFolder,
  onRenameFolder,
  onDeleteFile,
  onDeleteFolder,
  onAddFileToModel,
}: Props) {
  // The panel's own state: selection, collapse, drafts, drag
  // (lib/useFileTreeState).
  const {
    creatingIn, setCreatingIn,
    creatingFolderIn, setCreatingFolderIn,
    draftDirs, setDraftDirs,
    renamingPath, setRenamingPath,
    renamingDir, setRenamingDir,
    collapsed, toggleCollapse,
    setSelected,
    dragging, setDragging,
    dropTarget, setDropTarget,
    allPaths, allDirs, tree,
    effectiveDir,
    selectedDir: selectedDirForHighlight,
    selectedFile: selectedFileForHighlight,
  } = useFileTreeState(source);

  // A lone geometry file has no package around it (LoadedSource): the
  // tree draws a flat file row rather than a collapsible package root.
  const isFolder = source.folderName !== undefined;
  const canEdit = source.files !== undefined;
  const anchor = isFolder ? (source.manifestPath ?? 'cuboidy.json') : null;
  const primary = source.primaryPath;
  const hasManifest = source.manifest !== undefined;
  const hasManifestFile = source.manifestPath !== undefined;

  // Normalized refs the manifest's geometry list loads (default = the
  // primary alone). A package geometry file outside this set is inert — lint
  // W07 — so its row is dimmed with a "not loaded" badge and a hover
  // "+" that references it.
  const loadedGeometry = useMemo(() => {
    // §6.9 + §6.13: files the top-level list names AND files a part
    // points at. An all-inline model names none, which is correct — it
    // has no geometry file to badge.
    const refs =
      source.manifest !== undefined
        ? geometryPaths(source.manifest)
        : source.primaryPath !== undefined
          ? [source.primaryPath]
          : [];
    return new Set(refs.map(normalizePath));
  }, [source]);

  // Everything else the model accounts for: the palette files its geometry
  // points at (§7.4) and any externalized animation clip. Needed because
  // these are `.json` too and must not be mistaken for stray geometry.
  const referencedNonGeometry = useMemo(() => {
    const out = new Set<string>();
    for (const g of source.geometries.values()) {
      if (g.paletteRef !== undefined) out.add(normalizePath(g.paletteRef));
    }
    for (const clip of Object.values(source.manifest?.animations ?? {})) {
      if (typeof clip === 'string') out.add(normalizePath(clip));
    }
    return out;
  }, [source]);
  // A stray geometry file the manifest does not list (lints as W07). The
  // extension used to identify one; with a single extension the discriminator
  // left is "a .json the model does not otherwise account for" — the manifest,
  // the bound palette and the referenced clips are all known here.
  const isUnreferenced = (path: string): boolean => {
    if (loadedGeometry === null) return false;
    const norm = normalizePath(path);
    if (!norm.toLowerCase().endsWith('.json')) return false;
    if (loadedGeometry.has(norm)) return false;
    if (norm === normalizePath(source.manifestPath ?? '')) return false;
    return !referencedNonGeometry.has(norm);
  };

  const isGeometryRow = (path: string): boolean =>
    loadedGeometry !== null && loadedGeometry.has(normalizePath(path));

  const rowOps = (path: string): RowOps => {
    if (!canEdit) {
      return {
        renameReason: 'hidden',
        deleteReason: 'hidden',
        addReason: 'hidden',
      };
    }
    const renameReason =
      path === anchor
        ? 'cuboidy.json is the fixed anchor file and cannot be renamed'
        : path === primary && !hasManifest
          ? 'Create a manifest first — the rename must be recorded in its geometry list'
          : null;
    const deleteReason =
      path === anchor
        ? "The manifest can't be deleted"
        : path === primary
          ? "The primary geometry file can't be deleted"
          : null;
    const addReason = !isUnreferenced(path)
      ? 'hidden'
      : hasManifest
        ? null
        : 'Create a manifest first — the geometry list lives in cuboidy.json';
    return { renameReason, deleteReason, addReason };
  };

  const validNewSegments = (name: string): boolean =>
    !name.startsWith('/') &&
    !name.includes('\\') &&
    !name.includes(':') &&
    !name.split('/').some((s) => s === '' || s === '.' || s === '..');

  const validateNewPath = (path: string): boolean =>
    CREATABLE_RE.test(path) && validNewSegments(path) && !allPaths.has(path);

  const validateNewFolderIn =
    (dir: string) =>
    (name: string): boolean => {
      const joined = dir === '' ? name : `${dir}/${name}`;
      return (
        validNewSegments(name) &&
        !allPaths.has(joined) &&
        !allDirs.has(joined) &&
        !draftDirs.has(joined)
      );
    };

  // A file rename edits only the filename (last segment) — moving between
  // folders is drag-and-drop's job. The new name lands in the same
  // folder, must be a valid creatable file, and keeps the file's type
  // (every reference is .json — §8).
  const validateRename = (oldPath: string) => (name: string) => {
    if (name === baseName(oldPath)) return true;
    if (name.includes('/')) return false;
    const parent = parentDir(oldPath);
    const newPath = parent === '' ? name : `${parent}/${name}`;
    if (!validateNewPath(newPath)) return false;
    const oldExt = oldPath.slice(oldPath.lastIndexOf('.')).toLowerCase();
    const newExt = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (oldExt === '.json') return newExt === oldExt;
    return true;
  };

  // A folder rename edits only the last path segment (no `/`), lands on a
  // free sibling path, and — since it re-prefixes every contained file —
  // requires all of them to be movable (same rule that gates a drag).
  const validateRenameFolder = (dir: string) => (name: string) => {
    if (name === baseName(dir)) return true;
    if (name.includes('/') || !validNewSegments(name)) return false;
    const parent = parentDir(dir);
    const newDir = parent === '' ? name : `${parent}/${name}`;
    if (allPaths.has(newDir) || allDirs.has(newDir)) return false;
    return filesUnder(dir).every(isMovable);
  };

  const commitCreateFile = (dirPath: string, name: string): void => {
    const path = dirPath === '' ? name : `${dirPath}/${name}`;
    onCreateFile(path);
    setCreatingIn(null);
    // The folder now has a real file — the draft entry is redundant.
    setDraftDirs((prev) => {
      const covered = [...prev].filter(
        (d) => path === d || path.startsWith(`${d}/`),
      );
      if (covered.length === 0) return prev;
      const next = new Set(prev);
      for (const d of covered) next.delete(d);
      return next;
    });
  };

  const commitCreateFolder = (dirPath: string, name: string): void => {
    const joined = dirPath === '' ? name : `${dirPath}/${name}`;
    setDraftDirs((prev) => new Set(prev).add(joined));
    setCreatingFolderIn(null);
    setSelected({ kind: 'dir', path: joined });
    // Flow straight into "new file inside it".
    setCreatingIn(joined);
  };

  // ── drag-and-drop move ──────────────────────────────────────────────
  const baseName = (p: string): string => {
    const i = p.lastIndexOf('/');
    return i === -1 ? p : p.slice(i + 1);
  };
  const parentDir = (p: string): string => {
    const i = p.lastIndexOf('/');
    return i === -1 ? '' : p.slice(0, i);
  };
  const moveTarget = (dir: string, path: string): string =>
    dir === '' ? baseName(path) : `${dir}/${baseName(path)}`;
  // A file is draggable when it's renamable — a move IS a rename, so the
  // manifest anchor and a manifest-less primary geometry stay pinned.
  const isMovable = (path: string): boolean =>
    canEdit && rowOps(path).renameReason === null;
  const filesUnder = (dir: string): string[] =>
    [...allPaths].filter((p) => p.startsWith(`${dir}/`));
  // A folder is draggable when it holds ≥1 file and every one is movable,
  // so the whole subtree relocation can't be half-rejected downstream.
  // (Root and empty draft folders hold no files → not draggable.)
  const isDirMovable = (dir: string): boolean => {
    const kids = filesUnder(dir);
    return kids.length > 0 && kids.every(isMovable);
  };
  // Would dropping the current drag into `dir` ('' = root) be a real
  // move? For a file: not its own folder, no name clash. For a folder:
  // not into itself/a descendant/its own parent, and the destination
  // folder path must be free (no merge into an existing folder).
  const canDropInto = (dir: string): boolean => {
    if (dragging === null) return false;
    if (dragging.kind === 'file') {
      const to = moveTarget(dir, dragging.path);
      return to !== dragging.path && !allPaths.has(to);
    }
    const src = dragging.path;
    if (dir === src || dir.startsWith(`${src}/`)) return false;
    const newDir = moveTarget(dir, src);
    return newDir !== src && !allDirs.has(newDir) && !allPaths.has(newDir);
  };
  const endDrag = (): void => {
    setDragging(null);
    setDropTarget(null);
  };
  // Carry session-only draft (empty) folders and the selection along when
  // a folder relocates from `src` to `newDir` — the App handlers only
  // touch real files, so this keeps UI-only state in sync.
  const carryFolderState = (src: string, newDir: string): void => {
    setDraftDirs((prev) => {
      let nextSet: Set<string> | null = null;
      for (const d of prev) {
        if (d !== src && !d.startsWith(`${src}/`)) continue;
        if (nextSet === null) nextSet = new Set(prev);
        nextSet.delete(d);
        nextSet.add(`${newDir}${d.slice(src.length)}`);
      }
      return nextSet ?? prev;
    });
    setSelected((prev) => {
      if (prev === null) return prev;
      if (prev.path !== src && !prev.path.startsWith(`${src}/`)) return prev;
      return { kind: prev.kind, path: `${newDir}${prev.path.slice(src.length)}` };
    });
  };
  const commitDrop = (dir: string): void => {
    if (dragging === null || !canDropInto(dir)) return;
    if (dragging.kind === 'file') {
      onRenameFile(dragging.path, moveTarget(dir, dragging.path));
      return;
    }
    const src = dragging.path;
    onMoveFolder(src, dir);
    carryFolderState(src, moveTarget(dir, src));
  };
  const commitRenameFolder = (dir: string, name: string): void => {
    setRenamingDir(null);
    const parent = parentDir(dir);
    const newDir = parent === '' ? name : `${parent}/${name}`;
    if (newDir === dir) return;
    // Draft-only folders have no real files: skip the (no-op) App call
    // and just re-key the UI state.
    if (filesUnder(dir).length > 0) onRenameFolder(dir, name);
    carryFolderState(dir, newDir);
  };
  // Rename a file in place — reattach the new filename to its folder.
  const commitRenameFile = (oldPath: string, name: string): void => {
    setRenamingPath(null);
    const parent = parentDir(oldPath);
    onRenameFile(oldPath, parent === '' ? name : `${parent}/${name}`);
  };
  // null = the folder can be deleted; a string = disabled tooltip (it
  // holds a file that can't be deleted, e.g. the primary geometry). An
  // empty draft folder holds no files → always deletable.
  const folderDeleteReason = (dir: string): string | null => {
    const pinned = filesUnder(dir).find(
      (p) => rowOps(p).deleteReason !== null,
    );
    return pinned === undefined
      ? null
      : `Can't delete — contains ${baseName(pinned)}, which can't be deleted`;
  };
  const commitDeleteFolder = (dir: string): void => {
    if (folderDeleteReason(dir) !== null) return;
    if (filesUnder(dir).length > 0) onDeleteFolder(dir);
    // Prune the folder + any draft subfolders from the session state.
    setDraftDirs((prev) => {
      let nextSet: Set<string> | null = null;
      for (const d of prev) {
        if (d !== dir && !d.startsWith(`${dir}/`)) continue;
        if (nextSet === null) nextSet = new Set(prev);
        nextSet.delete(d);
      }
      return nextSet ?? prev;
    });
    // Drop the selection if it pointed into the deleted folder.
    setSelected((prev) =>
      prev !== null && (prev.path === dir || prev.path.startsWith(`${dir}/`))
        ? null
        : prev,
    );
  };
  // Drop-target handlers for a row. `target` drives which row highlights;
  // a drop always resolves to a directory (a file targets its folder).
  const dropHandlers = (target: { kind: 'file' | 'dir'; path: string }) => {
    const dir = target.kind === 'dir' ? target.path : parentDir(target.path);
    return {
      onDragOver: (e: DragEvent) => {
        if (!canDropInto(dir)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDropTarget(target);
      },
      onDrop: (e: DragEvent) => {
        if (!canDropInto(dir)) return;
        e.preventDefault();
        e.stopPropagation();
        commitDrop(dir);
        endDrag();
      },
    };
  };
  // Props shared by every folder row (root + children): a drop target
  // always, plus a drag source when the folder is movable.
  const folderRowProps = (dir: string) => ({
    draggable: isDirMovable(dir),
    onDragStart: (e: DragEvent) => {
      if (!isDirMovable(dir)) return;
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dir);
      setDragging({ kind: 'dir', path: dir });
      setDropTarget(null);
    },
    onDragEnd: endDrag,
    ...dropHandlers({ kind: 'dir', path: dir }),
  });
  // Props for a file row: a drag source AND a drop target (dropping onto
  // a file moves the dragged item into that file's folder).
  const fileRowProps = (path: string) => ({
    draggable: isMovable(path),
    onDragStart: (e: DragEvent) => {
      if (!isMovable(path)) return;
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      // Some browsers refuse to start a drag without a payload set.
      e.dataTransfer.setData('text/plain', path);
      setDragging({ kind: 'file', path });
      setDropTarget(null);
    },
    onDragEnd: endDrag,
    ...dropHandlers({ kind: 'file', path }),
  });

  return (
    <div className="file-tree">
      {canEdit && (
        <div className="parts-toolbar">
          <button
            type="button"
            className="btn btn-sm"
            title={`New file in ${effectiveDir === '' ? 'the package root' : `${effectiveDir}/`} (use / for deeper folders)`}
            onClick={() => {
              setCreatingFolderIn(null);
              setCreatingIn(effectiveDir);
            }}
          >
            <Plus size={13} />
            New file
          </button>
          <button
            type="button"
            className="btn btn-sm"
            title={`New folder in ${effectiveDir === '' ? 'the package root' : `${effectiveDir}/`} (kept for this session; saved to disk once a file is created inside)`}
            onClick={() => {
              setCreatingIn(null);
              setCreatingFolderIn(effectiveDir);
            }}
          >
            <Plus size={13} />
            New folder
          </button>
        </div>
      )}
      {isFolder ? (
        <ul className="tree-list">
          <li className="tree-node">
            <div
              className={`tree-row${selectedDirForHighlight === '' ? ' selected' : ''}${dropTarget?.kind === 'dir' && dropTarget.path === '' ? ' drop-target' : ''}${dragging?.kind === 'dir' && dragging.path === '' ? ' dragging' : ''}`}
              style={{ paddingLeft: '0.5rem' }}
              title="Package root — New file / New folder create here while selected"
              onClick={() => setSelected({ kind: 'dir', path: '' })}
              {...folderRowProps('')}
            >
              <button
                type="button"
                className="tree-caret-btn"
                aria-label={`${collapsed.has('') ? 'Expand' : 'Collapse'} ${source.folderName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapse('');
                }}
              >
                <span className="tree-caret">
                  {collapsed.has('') ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </span>
              </button>
              <span className="tree-name">{source.folderName}</span>
            </div>
            {!collapsed.has('') && (
              <>
                <DirChildren
                  node={tree}
                  dirPath=""
                  depth={1}
                  collapsed={collapsed}
                  onToggleCollapse={toggleCollapse}
                  fileErrors={fileErrors}
                  dragging={dragging}
                  dropTarget={dropTarget}
                  folderRowProps={folderRowProps}
                  fileRowProps={fileRowProps}
                  newBadgePath={undefined}
                  canEdit={canEdit}
                  creatingIn={creatingIn}
                  creatingFolderIn={creatingFolderIn}
                  selectedDir={selectedDirForHighlight}
                  selectedFile={selectedFileForHighlight}
                  renamingPath={renamingPath}
                  renamingDir={renamingDir}
                  isUnreferenced={isUnreferenced}
                  isGeometry={isGeometryRow}
                  rowOps={rowOps}
                  validateNewPath={validateNewPath}
                  validateNewFolderIn={validateNewFolderIn}
                  validateRename={validateRename}
                  validateRenameFolder={validateRenameFolder}
                  onOpenPath={onOpenPath}
                  onSelectDir={(dir) => setSelected({ kind: 'dir', path: dir })}
                  onStartRenameDir={setRenamingDir}
                  onCommitRenameFolder={commitRenameFolder}
                  onCancelRenameFolder={() => setRenamingDir(null)}
                  onSelectFile={(p) => setSelected({ kind: 'file', path: p })}
                  onCommitCreate={commitCreateFile}
                  onCommitCreateFolder={commitCreateFolder}
                  onCancelCreateFolder={() => setCreatingFolderIn(null)}
                  onCancelCreate={() => setCreatingIn(null)}
                  onStartRename={setRenamingPath}
                  onCommitRename={commitRenameFile}
                  onCancelRename={() => setRenamingPath(null)}
                  folderDeleteReason={folderDeleteReason}
                  onDeleteFolderRow={commitDeleteFolder}
                  onDeleteFile={onDeleteFile}
                  onAddFileToModel={onAddFileToModel}
                />
                {!hasManifestFile && (
                  <ul className="tree-list">
                    <li className="tree-node">
                      <div
                        className="tree-row missing"
                        style={{ paddingLeft: `${0.5 + 0.9}rem` }}
                        title="Not present in this folder"
                      >
                        <span className="tree-caret-spacer" aria-hidden="true" />
                        <span className="tree-icon">{fileIcon('cuboidy.json')}</span>
                        <span className="tree-name">cuboidy.json</span>
                      </div>
                    </li>
                  </ul>
                )}
              </>
            )}
          </li>
        </ul>
      ) : primary === undefined ? null : (
        <ul className="tree-list">
          <li className="tree-node">
            <div
              className={`tree-row${fileErrors.has(primary) ? ' error' : ''}`}
              style={{ paddingLeft: '0.5rem' }}
              title={fileErrors.get(primary) ?? primary}
              onClick={() => onOpenPath(primary)}
            >
              <span className="tree-caret-spacer" aria-hidden="true" />
              <span className="tree-icon">{fileIcon(primary, 'geometry')}</span>
              <span className="tree-name">{primary}</span>
            </div>
          </li>
        </ul>
      )}
    </div>
  );
}

// null = allowed; string = disabled with this tooltip; 'hidden' = don't
// even render the affordance (read-only sources).
interface RowOps {
  renameReason: string | null;
  deleteReason: string | null;
  // Add-to-model "+": 'hidden' unless the file is unreferenced geometry.
  addReason: string | null;
}

// ── directory tree model ─────────────────────────────────────────────

interface DirChildrenProps {
  node: DirNode;
  // This directory's package-relative path ('' = root).
  dirPath: string;
  // Nesting depth of the rows this renders (root's children = 1); drives
  // the inline left-padding, matching the Parts tree.
  depth: number;
  // Collapse state (folder paths) + toggle, shared with the whole tree.
  collapsed: ReadonlySet<string>;
  onToggleCollapse: (dir: string) => void;

  fileErrors: ReadonlyMap<string, string>;
  // Drag-and-drop move state + prop-builders (threaded through the
  // recursion). Both builders carry drag-source AND drop-target handlers
  // (dropping onto a file targets the file's folder).
  dragging: { kind: 'file' | 'dir'; path: string } | null;
  dropTarget: { kind: 'file' | 'dir'; path: string } | null;
  folderRowProps: (dir: string) => {
    draggable: boolean;
    onDragStart: (e: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
  fileRowProps: (path: string) => {
    draggable: boolean;
    onDragStart: (e: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
  newBadgePath?: string | undefined;
  canEdit: boolean;
  creatingIn: string | null;
  creatingFolderIn: string | null;
  // Explicitly selected folder / file to highlight (null = none;
  // at most one of the two is non-null).
  selectedDir: string | null;
  selectedFile: string | null;
  renamingPath: string | null;
  renamingDir: string | null;
  isUnreferenced: (path: string) => boolean;
  isGeometry: (path: string) => boolean;
  rowOps: (path: string) => RowOps;
  validateNewPath: (path: string) => boolean;
  validateNewFolderIn: (dir: string) => (name: string) => boolean;
  validateRename: (oldPath: string) => (name: string) => boolean;
  validateRenameFolder: (dir: string) => (name: string) => boolean;
  onOpenPath: (path: string) => void;
  onSelectDir: (dirPath: string) => void;
  onStartRenameDir: (dir: string) => void;
  onCommitRenameFolder: (dir: string, name: string) => void;
  onCancelRenameFolder: () => void;
  onSelectFile: (path: string) => void;
  onCommitCreate: (dirPath: string, name: string) => void;
  onCancelCreate: () => void;
  onCommitCreateFolder: (dirPath: string, name: string) => void;
  onCancelCreateFolder: () => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, name: string) => void;
  onCancelRename: () => void;
  folderDeleteReason: (dir: string) => string | null;
  onDeleteFolderRow: (dir: string) => void;
  onDeleteFile: (path: string) => void;
  onAddFileToModel: (path: string) => void;
}

function DirChildren(props: DirChildrenProps) {
  const { node, dirPath, depth } = props;
  const pad = `${0.5 + depth * 0.9}rem`;
  return (
    <ul className="tree-list">
      {[...node.dirs.entries()].map(([name, child]) => {
        const childPath = dirPath === '' ? name : `${dirPath}/${name}`;
        if (props.renamingDir === childPath) {
          return (
            <li className="tree-node" key={name}>
              <div className="tree-row draft" style={{ paddingLeft: pad }}>
                <span className="tree-caret-spacer" aria-hidden="true" />
                  <InlineNameInput
                  initial={name}
                  ariaLabel={`Rename folder ${childPath}`}
                  validate={props.validateRenameFolder(childPath)}
                  onCommit={(next) =>
                    props.onCommitRenameFolder(childPath, next)
                  }
                  onCancel={props.onCancelRenameFolder}
                />
              </div>
              {!props.collapsed.has(childPath) && (
                <DirChildren
                  {...props}
                  node={child}
                  dirPath={childPath}
                  depth={depth + 1}
                />
              )}
            </li>
          );
        }
        const dropOnDir =
          props.dropTarget?.kind === 'dir' &&
          props.dropTarget.path === childPath;
        const expandable =
          child.dirs.size > 0 ||
          child.files.length > 0 ||
          props.creatingIn === childPath ||
          props.creatingFolderIn === childPath;
        const expanded = !props.collapsed.has(childPath);
        return (
          <li className="tree-node" key={name}>
            <div
              className={`tree-row${props.selectedDir === childPath ? ' selected' : ''}${dropOnDir ? ' drop-target' : ''}${
                props.dragging?.kind === 'dir' &&
                props.dragging.path === childPath
                  ? ' dragging'
                  : ''
              }`}
              style={{ paddingLeft: pad }}
              title={`${childPath}/ — double-click to rename`}
              onClick={() => props.onSelectDir(childPath)}
              onDoubleClick={() => {
                if (props.canEdit) props.onStartRenameDir(childPath);
              }}
              {...props.folderRowProps(childPath)}
            >
              {expandable ? (
                <button
                  type="button"
                  className="tree-caret-btn"
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${childPath}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onToggleCollapse(childPath);
                  }}
                >
                  <span className="tree-caret">
                    {expanded ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                  </span>
                </button>
              ) : (
                <span className="tree-caret-spacer" aria-hidden="true" />
              )}
              <span className="tree-name">{name}</span>
              {props.canEdit &&
                (() => {
                  const reason = props.folderDeleteReason(childPath);
                  return (
                    <span
                      className="file-delete"
                      role="button"
                      aria-disabled={reason !== null}
                      aria-label={`Delete folder ${childPath}`}
                      title={
                        reason ??
                        `Delete ${childPath}/ and everything in it (undo restores it)`
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (reason === null) props.onDeleteFolderRow(childPath);
                      }}
                    >
                      <X size={14} />
                    </span>
                  );
                })()}
            </div>
            {expanded && (
              <DirChildren
                {...props}
                node={child}
                dirPath={childPath}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
      {props.creatingFolderIn === dirPath && (
        <li className="tree-node">
          <div className="tree-row draft" style={{ paddingLeft: pad }}>
            <span className="tree-caret-spacer" aria-hidden="true" />
            <InlineNameInput
              initial="folder"
              ariaLabel={`New folder in ${dirPath === '' ? 'package root' : dirPath}`}
              validate={props.validateNewFolderIn(dirPath)}
              onCommit={(name) => props.onCommitCreateFolder(dirPath, name)}
              onCancel={props.onCancelCreateFolder}
            />
          </div>
        </li>
      )}
      {props.creatingIn === dirPath && (
        <li className="tree-node">
          <div className="tree-row draft" style={{ paddingLeft: pad }}>
            <span className="tree-caret-spacer" aria-hidden="true" />
            <InlineNameInput
              initial="new.json"
              leadingIcon={fileIcon}
              ariaLabel={`New file in ${dirPath === '' ? 'package root' : dirPath}`}
              validate={(name) =>
                props.validateNewPath(
                  dirPath === '' ? name : `${dirPath}/${name}`,
                )
              }
              onCommit={(name) => props.onCommitCreate(dirPath, name)}
              onCancel={props.onCancelCreate}
            />
          </div>
        </li>
      )}
      {node.files.map((f) => (
        <FileNode
          key={f.path}
          path={f.path}
          name={f.name}
          depth={depth}
          selected={props.selectedFile === f.path}
          error={props.fileErrors.get(f.path)}
          isNew={f.path === props.newBadgePath}
          geometry={props.isGeometry(f.path)}
          unreferenced={props.isUnreferenced(f.path)}
          renaming={props.renamingPath === f.path}
          ops={props.rowOps(f.path)}
          dragProps={props.fileRowProps(f.path)}
          dragging={
            props.dragging?.kind === 'file' && props.dragging.path === f.path
          }
          dropActive={
            props.dropTarget?.kind === 'file' &&
            props.dropTarget.path === f.path
          }
          validateRename={props.validateRename(f.path)}
          onOpenPath={(p) => {
            // Opening a file retargets creation to its containing folder
            // (no folder highlight — the file itself is the selection).
            props.onSelectFile(p);
            props.onOpenPath(p);
          }}
          onStartRename={props.onStartRename}
          onCommitRename={props.onCommitRename}
          onCancelRename={props.onCancelRename}
          onDeleteFile={props.onDeleteFile}
          onAddFileToModel={props.onAddFileToModel}
        />
      ))}
    </ul>
  );
}

function FileNode({
  path,
  name,
  depth,
  selected,
  error,
  isNew,
  unreferenced,
  renaming,
  ops,
  dragProps,
  dragging,
  dropActive,
  validateRename,
  onOpenPath,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDeleteFile,
  geometry,
  onAddFileToModel,
}: {
  path: string;
  name: string;
  depth: number;
  selected?: boolean;
  error?: string | undefined;
  isNew?: boolean;
  unreferenced?: boolean;
  geometry?: boolean;
  renaming: boolean;
  ops: RowOps;
  dragProps: {
    draggable: boolean;
    onDragStart: (e: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
  dragging: boolean;
  dropActive: boolean;
  validateRename: (name: string) => boolean;
  onOpenPath: (path: string) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, name: string) => void;
  onCancelRename: () => void;
  onDeleteFile: (path: string) => void;
  onAddFileToModel: (path: string) => void;
}) {
  const pad = `${0.5 + depth * 0.9}rem`;
  if (renaming) {
    return (
      <li className="tree-node">
        <div className="tree-row draft" style={{ paddingLeft: pad }}>
          <span className="tree-caret-spacer" aria-hidden="true" />
          <InlineNameInput
            initial={name}
            leadingIcon={fileIcon}
            ariaLabel={`Rename ${path}`}
            validate={validateRename}
            onCommit={(next) => onCommitRename(path, next)}
            onCancel={onCancelRename}
          />
        </div>
      </li>
    );
  }
  return (
    <li className="tree-node">
      <div
        className={`tree-row${selected === true ? ' selected' : ''}${error !== undefined ? ' error' : ''}${unreferenced === true ? ' unreferenced' : ''}${dragging ? ' dragging' : ''}${dropActive ? ' drop-target' : ''}`}
        style={{ paddingLeft: pad }}
        title={error !== undefined ? `Error: ${error}` : path}
        onClick={() => onOpenPath(path)}
        onDoubleClick={() => {
          if (ops.renameReason === null) onStartRename(path);
        }}
        {...dragProps}
      >
        <span className="tree-caret-spacer" aria-hidden="true" />
        <span className="tree-icon">
          {fileIcon(name, geometry === true ? 'geometry' : 'data')}
        </span>
        <span className="tree-name">{name}</span>
        {isNew === true && <span className="badge">new</span>}
        {ops.addReason !== 'hidden' && (
          <span
            className="file-load"
            role="button"
            aria-disabled={ops.addReason !== null}
            aria-label={`Load ${path} into the model`}
            title={
              ops.addReason ??
              `Load ${path} into the model (adds it to the manifest geometry list)`
            }
            onClick={(e) => {
              e.stopPropagation();
              if (ops.addReason === null) onAddFileToModel(path);
            }}
          >
            load
          </span>
        )}
        {ops.deleteReason !== 'hidden' && (
          <span
            className="file-delete"
            role="button"
            aria-disabled={ops.deleteReason !== null}
            aria-label={`Delete ${path}`}
            title={ops.deleteReason ?? `Delete ${path} (undo restores it)`}
            onClick={(e) => {
              e.stopPropagation();
              if (ops.deleteReason === null) onDeleteFile(path);
            }}
          >
            <X size={14} />
          </span>
        )}
      </div>
    </li>
  );
}

