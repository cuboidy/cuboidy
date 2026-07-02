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
// (folders are implicit — `anims/idle.json` creates the folder). Double-
// click renames (full relative path, so a rename can also move); the
// hover × deletes. The manifest anchor is never renamable/deletable; the
// primary geometry is renamable only when a manifest records it, and
// never deletable.
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
  const [creating, setCreating] = useState(false);
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
  const tree = useMemo(() => buildFsTree(allPaths), [allPaths]);

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

  const validateNewPath = (name: string): boolean =>
    CREATABLE_RE.test(name) &&
    !name.startsWith('/') &&
    !name.split('/').some((s) => s === '' || s === '.' || s === '..') &&
    !allPaths.has(name);

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

  return (
    <div className="file-tree">
      {canEdit && (
        <div className="parts-toolbar">
          <button
            type="button"
            className="btn btn-sm"
            title="New file (use / for folders, e.g. anims/idle.json)"
            onClick={() => setCreating(true)}
          >
            + New file
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
            {creating && (
              <ul className="tree-children">
                <li className="tree-node file">
                  <div className="tree-node-draft">
                    <span className="icon">📄</span>
                    <InlineNameInput
                      initial="new.cvox"
                      ariaLabel="New file name"
                      validate={validateNewPath}
                      onCommit={(name) => {
                        onCreateFile(name);
                        setCreating(false);
                      }}
                      onCancel={() => setCreating(false)}
                    />
                  </div>
                </li>
              </ul>
            )}
            <DirChildren
              node={tree}
              activePaths={activePaths}
              fileErrors={fileErrors}
              newBadgePath={
                source.synthetic ? source.manifestFile?.name : undefined
              }
              renamingPath={renamingPath}
              rowOps={rowOps}
              validateRename={validateRename}
              onOpenPath={onOpenPath}
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
          <FileNode
            path={primary}
            name={primary}
            active={activePaths.has(primary)}
            error={fileErrors.get(primary)}
            renaming={false}
            ops={{ renameReason: 'hidden', deleteReason: 'hidden' }}
            validateRename={() => false}
            onOpenPath={onOpenPath}
            onStartRename={() => {}}
            onCommitRename={() => {}}
            onCancelRename={() => {}}
            onDeleteFile={() => {}}
          />
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

function buildFsTree(paths: Iterable<string>): DirNode {
  const root: DirNode = { dirs: new Map(), files: [] };
  for (const path of [...paths].sort()) {
    const segments = path.split('/');
    const name = segments.pop()!;
    let node = root;
    for (const seg of segments) {
      let child = node.dirs.get(seg);
      if (child === undefined) {
        child = { dirs: new Map(), files: [] };
        node.dirs.set(seg, child);
      }
      node = child;
    }
    node.files.push({ path, name });
  }
  return root;
}

interface DirChildrenProps {
  node: DirNode;
  activePaths: ReadonlySet<string>;
  fileErrors: ReadonlyMap<string, string>;
  newBadgePath?: string | undefined;
  renamingPath: string | null;
  rowOps: (path: string) => RowOps;
  validateRename: (oldPath: string) => (name: string) => boolean;
  onOpenPath: (path: string) => void;
  onStartRename: (path: string) => void;
  onCommitRename: (oldPath: string, name: string) => void;
  onCancelRename: () => void;
  onDeleteFile: (path: string) => void;
}

function DirChildren(props: DirChildrenProps) {
  const { node } = props;
  return (
    <ul className="tree-children">
      {[...node.dirs.entries()].map(([name, child]) => (
        <li className="tree-node folder" key={name}>
          <div className="folder-row">
            <span className="icon">📁</span>
            <span className="name">{name}</span>
          </div>
          <DirChildren {...props} node={child} />
        </li>
      ))}
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
