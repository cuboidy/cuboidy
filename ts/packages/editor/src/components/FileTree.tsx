import { useMemo } from 'react';
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
}

// The Files sidebar: the WHOLE package as a VS Code Explorer-shaped tree
// (v0.7 — every text file collected at load, not just the fixed pair).
// Clicking a file brings its dock panel to the foreground: the primary
// geometry opens the classic cvox panel, cuboidy.json the manifest
// panel, and any other file a dynamic `file:<path>` editor tab.
export function FileTree({
  source,
  activePaths,
  fileErrors,
  onOpenPath,
  onCreateManifest,
}: Props) {
  const tree = useMemo(() => {
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
    return buildFsTree(paths);
  }, [source]);

  const hasManifest =
    source.kind === 'folder' && source.manifestFile !== undefined;

  return (
    <div className="file-tree">
      {source.kind === 'folder' ? (
        <ul className="tree-root">
          <li className="tree-node folder">
            <div className="folder-row">
              <span className="icon">📁</span>
              <span className="name">{source.folderName}</span>
              {source.synthetic && <span className="badge">unsaved</span>}
            </div>
            <DirChildren
              node={tree}
              activePaths={activePaths}
              fileErrors={fileErrors}
              newBadgePath={
                source.synthetic ? source.manifestFile?.name : undefined
              }
              onOpenPath={onOpenPath}
            />
            {!hasManifest && (
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
            path={source.cvoxFile.name}
            name={source.cvoxFile.name}
            active={activePaths.has(source.cvoxFile.name)}
            error={fileErrors.get(source.cvoxFile.name)}
            onOpenPath={onOpenPath}
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
  onOpenPath: (path: string) => void;
}

function DirChildren(props: DirChildrenProps) {
  const { node, activePaths, fileErrors, newBadgePath, onOpenPath } = props;
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
          active={activePaths.has(f.path)}
          error={fileErrors.get(f.path)}
          isNew={f.path === newBadgePath}
          onOpenPath={onOpenPath}
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
  onOpenPath,
}: {
  path: string;
  name: string;
  active: boolean;
  error?: string | undefined;
  isNew?: boolean;
  onOpenPath: (path: string) => void;
}) {
  return (
    <li
      className={`tree-node file${active ? ' active' : ''}${error !== undefined ? ' error' : ''}`}
      title={error !== undefined ? `Syntax error: ${error}` : path}
    >
      <button
        type="button"
        className="tree-node-button"
        onClick={() => onOpenPath(path)}
      >
        <span className="icon">📄</span>
        <span className="name">{name}</span>
        {isNew === true && <span className="badge">new</span>}
      </button>
    </li>
  );
}

function canCreateManifest(source: LoadedSource): boolean {
  if (source.kind === 'cvox-only') return true;
  if (source.kind === 'folder' && source.manifest === undefined) return true;
  return false;
}
