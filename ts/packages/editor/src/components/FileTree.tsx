import { useMemo, useState } from 'react';
import { InlineNameInput } from './InlineNameInput.js';
import type { LoadedSource } from '../lib/types.js';

interface Props {
  source: LoadedSource;
  // Paths of files whose dock panel is currently *visible* (the active
  // tab of its leaf) — highlighted so the tree is a constant indicator
  // of "what am I viewing right now".
  activePaths: ReadonlySet<string>;
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
  activePaths,
  fileErrors,
  onOpenPath,
  onCreateManifest,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
}: Props) {
  // Directory path ('' = package root) that has an open new-file draft,
  // or null. Folder "+" buttons target their own directory.
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  // Session-draft empty folders (paths). Materialize on disk only once a
  // file is created inside; pruned automatically when that happens
  // (buildFsTree already shows dirs that contain files).
  const [draftDirs, setDraftDirs] = useState<ReadonlySet<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

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

  const isFolder = source.kind === 'folder';
  const canEdit = isFolder && source.files !== undefined;
  const anchor = isFolder ? (source.manifestFile?.name ?? 'cuboidy.json') : null;
  const primary = source.cvoxFile.name;
  const hasManifest = isFolder && source.manifest !== undefined;
  const hasManifestFile = isFolder && source.manifestFile !== undefined;

  const rowOps = (path: string): RowOps => {
    if (!canEdit) return { renameReason: 'hidden', deleteReason: 'hidden' };
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
    return { renameReason, deleteReason };
  };

  const validNewSegments = (name: string): boolean =>
    !name.startsWith('/') &&
    !name.includes('\\') &&
    !name.includes(':') &&
    !name.split('/').some((s) => s === '' || s === '.' || s === '..');

  const validateNewPath = (path: string): boolean =>
    CREATABLE_RE.test(path) && validNewSegments(path) && !allPaths.has(path);

  const validateNewFolder = (name: string): boolean =>
    validNewSegments(name) &&
    !allPaths.has(name) &&
    !draftDirs.has(name);

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

  return (
    <div className="file-tree">
      {canEdit && (
        <div className="parts-toolbar">
          <button
            type="button"
            className="btn btn-sm"
            title="New file (use / for folders, e.g. anims/idle.json)"
            onClick={() => {
              setCreatingFolder(false);
              setCreatingIn('');
            }}
          >
            + New file
          </button>
          <button
            type="button"
            className="btn btn-sm"
            title="New folder (kept for this session; saved to disk once a file is created inside)"
            onClick={() => {
              setCreatingIn(null);
              setCreatingFolder(true);
            }}
          >
            + New folder
          </button>
        </div>
      )}
      {isFolder ? (
        <ul className="tree-root">
          <li className="tree-node folder">
            <div className="folder-row">
              <span className="icon">📁</span>
              <span className="name">{source.folderName}</span>
              {source.synthetic && <span className="badge">unsaved</span>}
            </div>
            {creatingFolder && (
              <ul className="tree-children">
                <li className="tree-node folder">
                  <div className="tree-node-draft">
                    <span className="icon">📁</span>
                    <InlineNameInput
                      initial="folder"
                      ariaLabel="New folder name"
                      validate={validateNewFolder}
                      onCommit={(name) => {
                        setDraftDirs((prev) => new Set(prev).add(name));
                        setCreatingFolder(false);
                        // Flow straight into "new file inside it".
                        setCreatingIn(name);
                      }}
                      onCancel={() => setCreatingFolder(false)}
                    />
                  </div>
                </li>
              </ul>
            )}
            <DirChildren
              node={tree}
              dirPath=""
              activePaths={activePaths}
              fileErrors={fileErrors}
              newBadgePath={
                source.synthetic ? source.manifestFile?.name : undefined
              }
              canEdit={canEdit}
              creatingIn={creatingIn}
              renamingPath={renamingPath}
              rowOps={rowOps}
              validateNewPath={validateNewPath}
              validateRename={validateRename}
              onOpenPath={onOpenPath}
              onStartCreateIn={(dir) => {
                setCreatingFolder(false);
                setCreatingIn(dir);
              }}
              onCommitCreate={commitCreateFile}
              onCancelCreate={() => setCreatingIn(null)}
              onStartRename={setRenamingPath}
              onCommitRename={(oldPath, name) => {
                onRenameFile(oldPath, name);
                setRenamingPath(null);
              }}
              onCancelRename={() => setRenamingPath(null)}
              onDeleteFile={onDeleteFile}
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
            className={`tree-node file${activePaths.has(primary) ? ' active' : ''}${fileErrors.has(primary) ? ' error' : ''}`}
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
  activePaths: ReadonlySet<string>;
  fileErrors: ReadonlyMap<string, string>;
  newBadgePath?: string | undefined;
  canEdit: boolean;
  creatingIn: string | null;
  renamingPath: string | null;
  rowOps: (path: string) => RowOps;
  validateNewPath: (path: string) => boolean;
  validateRename: (oldPath: string) => (name: string) => boolean;
  onOpenPath: (path: string) => void;
  onStartCreateIn: (dirPath: string) => void;
  onCommitCreate: (dirPath: string, name: string) => void;
  onCancelCreate: () => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, name: string) => void;
  onCancelRename: () => void;
  onDeleteFile: (path: string) => void;
}

function DirChildren(props: DirChildrenProps) {
  const { node, dirPath } = props;
  return (
    <ul className="tree-children">
      {[...node.dirs.entries()].map(([name, child]) => {
        const childPath = dirPath === '' ? name : `${dirPath}/${name}`;
        return (
          <li className="tree-node folder" key={name}>
            <div className="folder-row">
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
          active={props.activePaths.has(f.path)}
          error={props.fileErrors.get(f.path)}
          isNew={f.path === props.newBadgePath}
          renaming={props.renamingPath === f.path}
          ops={props.rowOps(f.path)}
          validateRename={props.validateRename(f.path)}
          onOpenPath={props.onOpenPath}
          onStartRename={props.onStartRename}
          onCommitRename={props.onCommitRename}
          onCancelRename={props.onCancelRename}
          onDeleteFile={props.onDeleteFile}
        />
      ))}
    </ul>
  );
}

function FileNode({
  path,
  name,
  active,
  error,
  isNew,
  renaming,
  ops,
  validateRename,
  onOpenPath,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDeleteFile,
}: {
  path: string;
  name: string;
  active: boolean;
  error?: string | undefined;
  isNew?: boolean;
  renaming: boolean;
  ops: RowOps;
  validateRename: (name: string) => boolean;
  onOpenPath: (path: string) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, name: string) => void;
  onCancelRename: () => void;
  onDeleteFile: (path: string) => void;
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
      className={`tree-node file${active ? ' active' : ''}${error !== undefined ? ' error' : ''}`}
      title={error !== undefined ? `Syntax error: ${error}` : path}
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
