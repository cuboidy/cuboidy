import { useMemo, useState, type DragEvent } from 'react';
import { manifestGeometry } from '@cuboidy/core';
import { InlineNameInput } from './InlineNameInput.js';
import { normalizePath } from '../lib/load-model.js';
import type { LoadedSource } from '../lib/types.js';

interface Props {
  source: LoadedSource;
  // Current syntax / load error per path (undefined = none). Drives a
  // VS Code-style red filename; the tooltip carries the message.
  fileErrors: ReadonlyMap<string, string>;
  onOpenPath: (path: string) => void;
  onCreateManifest: () => void;
  // File CRUD (v0.7 Phase D). Only meaningful for folder sources with a
  // files map; the tree hides the affordances otherwise.
  onCreateFile: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  onDeleteFile: (path: string) => void;
  // Append an unreferenced .cvox to the manifest geometry list so its
  // parts load (the tree's "not loaded" rows).
  onAddFileToModel: (path: string) => void;
}

// Files the loader reads as text (and therefore the only ones worth
// creating in the editor) — mirrors load-model's TEXT_FILE_RE.
const CREATABLE_RE = /^[^\\:]+\.(cvox|json|md|txt)$/i;

// The Files sidebar: the WHOLE package as a VS Code Explorer-shaped tree
// (v0.7 — every text file collected at load, not just the fixed pair).
// Clicking a file brings its dock panel to the foreground: the primary
// geometry opens the classic cvox panel, cuboidy.json the manifest
// panel, and any other file a dynamic `file:<path>` editor tab.
//
// CRUD: "+ New file" opens an inline draft whose name may contain `/`
// (folders are implicit); hovering a folder row reveals a "+" that
// drafts a file inside it. "+ New folder" drafts an empty folder —
// session-only until a file lands in it (the package model is a file
// map, so an empty folder has no on-disk representation). Double-click
// renames a file (full relative path, so a rename can also move); the
// hover × deletes. The manifest anchor is never renamable/deletable;
// the primary geometry is renamable only when a manifest records it,
// and never deletable.
export function FileTree({
  source,
  fileErrors,
  onOpenPath,
  onCreateManifest,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
  onAddFileToModel,
}: Props) {
  // Directory path ('' = package root) that has an open new-file draft,
  // or null. Folder "+" buttons target their own directory.
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  // Directory a new-FOLDER draft is open in ('' = root), or null.
  const [creatingFolderIn, setCreatingFolderIn] = useState<string | null>(null);
  // Session-draft empty folders (paths). Materialize on disk only once a
  // file is created inside; pruned automatically when that happens
  // (buildFsTree already shows dirs that contain files).
  const [draftDirs, setDraftDirs] = useState<ReadonlySet<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  // The selected NODE (VS Code-style single selection): a folder or a
  // file. Creation targets the selected folder, or a selected file's
  // containing folder.
  const [selected, setSelected] = useState<
    { kind: 'dir' | 'file'; path: string } | null
  >(null);
  // Drag-and-drop move: the file path currently being dragged, and the
  // folder path ('' = package root) under the cursor as a drop target.
  // A drop reuses onRenameFile — a full-path rename IS a move (§8), so
  // the manifest/extension guards all live in that one handler.
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);

  const allPaths = useMemo(() => {
    const paths = new Set<string>();
    if (source.kind === 'folder') {
      if (source.files !== undefined) {
        for (const path of source.files.keys()) paths.add(path);
      }
      paths.add(source.cvoxFile.name);
      if (source.manifestFile !== undefined) {
        paths.add(source.manifestFile.name);
      }
    } else {
      paths.add(source.cvoxFile.name);
    }
    return paths;
  }, [source]);
  const tree = useMemo(
    () => buildFsTree(allPaths, draftDirs),
    [allPaths, draftDirs],
  );
  // Every directory that currently exists (all prefixes of file paths +
  // draft folders). Guards the selection against dirs that vanished.
  const allDirs = useMemo(() => {
    const dirs = new Set<string>();
    const addPrefixes = (p: string, includeSelf: boolean) => {
      const segs = p.split('/');
      const upto = includeSelf ? segs.length : segs.length - 1;
      for (let i = 1; i <= upto; i++) dirs.add(segs.slice(0, i).join('/'));
    };
    for (const p of allPaths) addPrefixes(p, false);
    for (const d of draftDirs) addPrefixes(d, true);
    return dirs;
  }, [allPaths, draftDirs]);
  // Where New file / New folder create: the selected folder, or a
  // selected file's containing folder. Vanished nodes fall back to root.
  const effectiveDir = (() => {
    if (selected === null) return '';
    if (selected.kind === 'dir') {
      return selected.path === '' || allDirs.has(selected.path)
        ? selected.path
        : '';
    }
    if (!allPaths.has(selected.path)) return '';
    const i = selected.path.lastIndexOf('/');
    return i === -1 ? '' : selected.path.slice(0, i);
  })();
  // Exactly ONE node carries the selection highlight — a folder or a
  // file, never both. What's OPEN is the dock tabs' job, not the tree's.
  const selectedDirForHighlight =
    selected?.kind === 'dir' && (selected.path === '' || allDirs.has(selected.path))
      ? selected.path
      : null;
  const selectedFileForHighlight =
    selected?.kind === 'file' && allPaths.has(selected.path)
      ? selected.path
      : null;

  const isFolder = source.kind === 'folder';
  const canEdit = isFolder && source.files !== undefined;
  const anchor = isFolder ? (source.manifestFile?.name ?? 'cuboidy.json') : null;
  const primary = source.cvoxFile.name;
  const hasManifest = isFolder && source.manifest !== undefined;
  const hasManifestFile = isFolder && source.manifestFile !== undefined;

  // Normalized refs the manifest's geometry list loads (default = the
  // primary alone). A package .cvox outside this set is inert — lint
  // W07 — so its row is dimmed with a "not loaded" badge and a hover
  // "+" that references it.
  const loadedGeometry = useMemo(() => {
    if (source.kind !== 'folder') return null;
    const refs =
      source.manifest !== undefined
        ? manifestGeometry(source.manifest)
        : [source.cvoxFile.name];
    return new Set(refs.map(normalizePath));
  }, [source]);
  const isUnreferenced = (path: string): boolean =>
    loadedGeometry !== null &&
    path.toLowerCase().endsWith('.cvox') &&
    !loadedGeometry.has(normalizePath(path));

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

  const validateRename = (oldPath: string) => (name: string) => {
    if (name === oldPath) return true;
    if (!validateNewPath(name)) return false;
    // A rename keeps the file's type — geometry stays .cvox, a bound
    // palette stays .json (§8 extension rules).
    const oldExt = oldPath.slice(oldPath.lastIndexOf('.')).toLowerCase();
    const newExt = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (oldExt === '.cvox' || oldExt === '.json') return newExt === oldExt;
    return true;
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
  const moveTarget = (dir: string, path: string): string =>
    dir === '' ? baseName(path) : `${dir}/${baseName(path)}`;
  // A file is draggable when it's renamable — a move IS a rename, so the
  // manifest anchor and a manifest-less primary geometry stay pinned.
  const isMovable = (path: string): boolean =>
    canEdit && rowOps(path).renameReason === null;
  // Would dropping the dragged file into `dir` ('' = root) be a real
  // move? No for its own folder (a no-op) or a name clash in the target.
  const canDropInto = (dir: string): boolean => {
    if (draggingPath === null) return false;
    const to = moveTarget(dir, draggingPath);
    return to !== draggingPath && !allPaths.has(to);
  };
  const endDrag = (): void => {
    setDraggingPath(null);
    setDropDir(null);
  };
  // Shared drag props for a folder drop target (root row + child rows).
  const folderDropProps = (dir: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!canDropInto(dir)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDropDir(dir);
    },
    onDrop: (e: DragEvent) => {
      if (draggingPath === null || !canDropInto(dir)) return;
      e.preventDefault();
      e.stopPropagation();
      onRenameFile(draggingPath, moveTarget(dir, draggingPath));
      endDrag();
    },
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
            + New file
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
            + New folder
          </button>
        </div>
      )}
      {isFolder ? (
        <ul className="tree-root">
          <li className="tree-node folder">
            <div
              className={`folder-row${selectedDirForHighlight === '' ? ' selected' : ''}${dropDir === '' ? ' drop-target' : ''}`}
              title="Package root — New file / New folder create here while selected"
              onClick={() => setSelected({ kind: 'dir', path: '' })}
              {...folderDropProps('')}
            >
              <span className="icon">📁</span>
              <span className="name">{source.folderName}</span>
              {source.synthetic && <span className="badge">unsaved</span>}
            </div>
            <DirChildren
              node={tree}
              dirPath=""

              fileErrors={fileErrors}
              draggingPath={draggingPath}
              dropDir={dropDir}
              isMovable={isMovable}
              folderDropProps={folderDropProps}
              onFileDragStart={(path) => {
                setDraggingPath(path);
                setDropDir(null);
              }}
              onFileDragEnd={endDrag}
              newBadgePath={
                source.synthetic ? source.manifestFile?.name : undefined
              }
              canEdit={canEdit}
              creatingIn={creatingIn}
              creatingFolderIn={creatingFolderIn}
              selectedDir={selectedDirForHighlight}
              selectedFile={selectedFileForHighlight}
              renamingPath={renamingPath}
              isUnreferenced={isUnreferenced}
              rowOps={rowOps}
              validateNewPath={validateNewPath}
              validateNewFolderIn={validateNewFolderIn}
              validateRename={validateRename}
              onOpenPath={onOpenPath}
              onSelectDir={(dir) => setSelected({ kind: 'dir', path: dir })}
              onSelectFile={(p) => setSelected({ kind: 'file', path: p })}
              onStartCreateIn={(dir) => {
                setCreatingFolderIn(null);
                setSelected({ kind: 'dir', path: dir });
                setCreatingIn(dir);
              }}
              onCommitCreate={commitCreateFile}
              onCommitCreateFolder={commitCreateFolder}
              onCancelCreateFolder={() => setCreatingFolderIn(null)}
              onCancelCreate={() => setCreatingIn(null)}
              onStartRename={setRenamingPath}
              onCommitRename={(oldPath, name) => {
                onRenameFile(oldPath, name);
                setRenamingPath(null);
              }}
              onCancelRename={() => setRenamingPath(null)}
              onDeleteFile={onDeleteFile}
              onAddFileToModel={onAddFileToModel}
            />
            {!hasManifestFile && (
              <ul className="tree-children">
                <li
                  className="tree-node file missing"
                  title="Not present in this folder"
                >
                  <span className="icon">📄</span>
                  <span className="name">cuboidy.json</span>
                </li>
              </ul>
            )}
          </li>
        </ul>
      ) : (
        <ul className="tree-root">
          <li
            className={`tree-node file${fileErrors.has(primary) ? ' error' : ''}`}
            title={fileErrors.get(primary) ?? primary}
          >
            <button
              type="button"
              className="tree-node-button"
              onClick={() => onOpenPath(primary)}
            >
              <span className="icon">📄</span>
              <span className="name">{primary}</span>
            </button>
          </li>
        </ul>
      )}
      {canCreateManifest(source) && (
        <button
          type="button"
          className="btn btn-create btn-sm create-manifest"
          onClick={onCreateManifest}
        >
          + Create manifest
        </button>
      )}
    </div>
  );
}

// null = allowed; string = disabled with this tooltip; 'hidden' = don't
// even render the affordance (read-only sources).
interface RowOps {
  renameReason: string | null;
  deleteReason: string | null;
  // Add-to-model "+": 'hidden' unless the file is an unreferenced .cvox.
  addReason: string | null;
}

// ── directory tree model ─────────────────────────────────────────────

interface DirNode {
  dirs: Map<string, DirNode>;
  files: Array<{ path: string; name: string }>;
}

function buildFsTree(
  paths: Iterable<string>,
  emptyDirs: Iterable<string> = [],
): DirNode {
  const root: DirNode = { dirs: new Map(), files: [] };
  const dirAt = (segments: string[]): DirNode => {
    let node = root;
    for (const seg of segments) {
      let child = node.dirs.get(seg);
      if (child === undefined) {
        child = { dirs: new Map(), files: [] };
        node.dirs.set(seg, child);
      }
      node = child;
    }
    return node;
  };
  for (const dir of [...emptyDirs].sort()) {
    dirAt(dir.split('/'));
  }
  for (const path of [...paths].sort()) {
    const segments = path.split('/');
    const name = segments.pop()!;
    dirAt(segments).files.push({ path, name });
  }
  return root;
}

interface DirChildrenProps {
  node: DirNode;
  // This directory's package-relative path ('' = root).
  dirPath: string;

  fileErrors: ReadonlyMap<string, string>;
  // Drag-and-drop move state + callbacks (threaded through the recursion).
  draggingPath: string | null;
  dropDir: string | null;
  isMovable: (path: string) => boolean;
  folderDropProps: (dir: string) => {
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
  onFileDragStart: (path: string) => void;
  onFileDragEnd: () => void;
  newBadgePath?: string | undefined;
  canEdit: boolean;
  creatingIn: string | null;
  creatingFolderIn: string | null;
  // Explicitly selected folder / file to highlight (null = none;
  // at most one of the two is non-null).
  selectedDir: string | null;
  selectedFile: string | null;
  renamingPath: string | null;
  isUnreferenced: (path: string) => boolean;
  rowOps: (path: string) => RowOps;
  validateNewPath: (path: string) => boolean;
  validateNewFolderIn: (dir: string) => (name: string) => boolean;
  validateRename: (oldPath: string) => (name: string) => boolean;
  onOpenPath: (path: string) => void;
  onSelectDir: (dirPath: string) => void;
  onSelectFile: (path: string) => void;
  onStartCreateIn: (dirPath: string) => void;
  onCommitCreate: (dirPath: string, name: string) => void;
  onCancelCreate: () => void;
  onCommitCreateFolder: (dirPath: string, name: string) => void;
  onCancelCreateFolder: () => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, name: string) => void;
  onCancelRename: () => void;
  onDeleteFile: (path: string) => void;
  onAddFileToModel: (path: string) => void;
}

function DirChildren(props: DirChildrenProps) {
  const { node, dirPath } = props;
  return (
    <ul className="tree-children">
      {[...node.dirs.entries()].map(([name, child]) => {
        const childPath = dirPath === '' ? name : `${dirPath}/${name}`;
        return (
          <li className="tree-node folder" key={name}>
            <div
              className={`folder-row${props.selectedDir === childPath ? ' selected' : ''}${props.dropDir === childPath ? ' drop-target' : ''}`}
              title={`${childPath}/ — New file / New folder create here while selected`}
              onClick={() => props.onSelectDir(childPath)}
              {...props.folderDropProps(childPath)}
            >
              <span className="icon">📁</span>
              <span className="name">{name}</span>
              {props.canEdit && (
                <span
                  className="btn-icon folder-add"
                  role="button"
                  aria-label={`New file in ${childPath}`}
                  title={`New file in ${childPath}/`}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onStartCreateIn(childPath);
                  }}
                >
                  +
                </span>
              )}
            </div>
            <DirChildren {...props} node={child} dirPath={childPath} />
          </li>
        );
      })}
      {props.creatingFolderIn === dirPath && (
        <li className="tree-node folder">
          <div className="tree-node-draft">
            <span className="icon">📁</span>
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
        <li className="tree-node file">
          <div className="tree-node-draft">
            <span className="icon">📄</span>
            <InlineNameInput
              initial="new.cvox"
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
          selected={props.selectedFile === f.path}
          error={props.fileErrors.get(f.path)}
          isNew={f.path === props.newBadgePath}
          unreferenced={props.isUnreferenced(f.path)}
          renaming={props.renamingPath === f.path}
          ops={props.rowOps(f.path)}
          draggable={props.isMovable(f.path)}
          dragging={props.draggingPath === f.path}
          onDragStartFile={props.onFileDragStart}
          onDragEndFile={props.onFileDragEnd}
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
  selected,
  error,
  isNew,
  unreferenced,
  renaming,
  ops,
  draggable,
  dragging,
  onDragStartFile,
  onDragEndFile,
  validateRename,
  onOpenPath,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDeleteFile,
  onAddFileToModel,
}: {
  path: string;
  name: string;
  selected?: boolean;
  error?: string | undefined;
  isNew?: boolean;
  unreferenced?: boolean;
  renaming: boolean;
  ops: RowOps;
  draggable: boolean;
  dragging: boolean;
  onDragStartFile: (path: string) => void;
  onDragEndFile: () => void;
  validateRename: (name: string) => boolean;
  onOpenPath: (path: string) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, name: string) => void;
  onCancelRename: () => void;
  onDeleteFile: (path: string) => void;
  onAddFileToModel: (path: string) => void;
}) {
  if (renaming) {
    return (
      <li className="tree-node file">
        <div className="tree-node-draft">
          <span className="icon">📄</span>
          <InlineNameInput
            initial={path}
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
    <li
      className={`tree-node file${selected === true ? ' selected' : ''}${error !== undefined ? ' error' : ''}${unreferenced === true ? ' unreferenced' : ''}${dragging ? ' dragging' : ''}`}
      title={error !== undefined ? `Syntax error: ${error}` : path}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.effectAllowed = 'move';
        // Some browsers refuse to start a drag without a payload set.
        e.dataTransfer.setData('text/plain', path);
        onDragStartFile(path);
      }}
      onDragEnd={onDragEndFile}
    >
      <button
        type="button"
        className="tree-node-button"
        onClick={() => onOpenPath(path)}
        onDoubleClick={() => {
          if (ops.renameReason === null) onStartRename(path);
        }}
      >
        <span className="icon">📄</span>
        <span className="name">{name}</span>
        {isNew === true && <span className="badge">new</span>}
        {unreferenced === true && (
          <span
            className="badge"
            title="Not in the manifest geometry list — its parts are not loaded into the model"
          >
            not loaded
          </span>
        )}
        {ops.addReason !== 'hidden' && (
          <span
            className="btn-icon file-add"
            role="button"
            aria-disabled={ops.addReason !== null}
            aria-label={`Load ${path} into the model`}
            title={
              ops.addReason ??
              `Add ${path} to the manifest geometry list so its parts load`
            }
            onClick={(e) => {
              e.stopPropagation();
              if (ops.addReason === null) onAddFileToModel(path);
            }}
          >
            +
          </span>
        )}
        {ops.deleteReason !== 'hidden' && (
          <span
            className="btn-icon file-delete"
            role="button"
            aria-disabled={ops.deleteReason !== null}
            aria-label={`Delete ${path}`}
            title={
              ops.deleteReason ?? `Delete ${path} (undo restores it)`
            }
            onClick={(e) => {
              e.stopPropagation();
              if (ops.deleteReason === null) onDeleteFile(path);
            }}
          >
            ×
          </span>
        )}
      </button>
    </li>
  );
}

function canCreateManifest(source: LoadedSource): boolean {
  if (source.kind === 'cvox-only') return true;
  if (source.kind === 'folder' && source.manifest === undefined) return true;
  return false;
}
