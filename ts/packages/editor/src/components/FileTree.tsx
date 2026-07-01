import type { LoadedSource } from '../lib/types.js';

// The two source files the tree can open as dock panels.
type SourceFile = 'cvox' | 'manifest';

interface Props {
  source: LoadedSource;
  // Which source panels are currently *visible* (the active tab of their
  // leaf). A set rather than a single value because, once panelized, cvox
  // and manifest can be docked apart and shown at the same time.
  activeFiles: ReadonlySet<SourceFile>;
  // Current syntax error per file (undefined = none). Drives a VS Code-style
  // red filename so a broken file is visible without hovering for the tooltip.
  cvoxError?: string | undefined;
  manifestError?: string | undefined;
  onOpenFile: (file: SourceFile) => void;
  onCreateManifest: () => void;
}

// Read-only file tree for the Files sidebar section. VS Code Explorer-
// shaped: folder loads show the folder as the root node with child
// files indented one level under it; cvox-only loads show a single
// file at the root (no synthetic folder wrap).
//
// Clicking a file brings its dock panel to the foreground (App.openPanelById,
// re-opening it if it was closed). A file is highlighted while its panel is
// the visible tab of its leaf, so the tree is a constant indicator of "what
// am I viewing right now."

export function FileTree({
  source,
  activeFiles,
  cvoxError,
  manifestError,
  onOpenFile,
  onCreateManifest,
}: Props) {
  return (
    <div className="file-tree">
      {source.kind === 'folder' ? (
        <FolderTree
          source={source}
          activeFiles={activeFiles}
          cvoxError={cvoxError}
          manifestError={manifestError}
          onOpenFile={onOpenFile}
        />
      ) : (
        <ul className="tree-root">
          <CvoxFileNode
            name={source.cvoxFile.name}
            active={activeFiles.has('cvox')}
            error={cvoxError}
            onClick={() => onOpenFile('cvox')}
          />
        </ul>
      )}
      {canCreateManifest(source) && (
        <button
          type="button"
          className="create-manifest"
          onClick={onCreateManifest}
        >
          + Create manifest
        </button>
      )}
    </div>
  );
}

interface FolderTreeProps {
  source: Extract<LoadedSource, { kind: 'folder' }>;
  activeFiles: ReadonlySet<SourceFile>;
  cvoxError?: string | undefined;
  manifestError?: string | undefined;
  onOpenFile: (file: SourceFile) => void;
}

function FolderTree({
  source,
  activeFiles,
  cvoxError,
  manifestError,
  onOpenFile,
}: FolderTreeProps) {
  return (
    <ul className="tree-root">
      <li className="tree-node folder">
        <div className="folder-row">
          <span className="icon">📁</span>
          <span className="name">{source.folderName}</span>
          {source.synthetic && <span className="badge">unsaved</span>}
        </div>
        <ul className="tree-children">
          <CvoxFileNode
            name={source.cvoxFile.name}
            active={activeFiles.has('cvox')}
            error={cvoxError}
            onClick={() => onOpenFile('cvox')}
          />
          {source.manifestFile !== undefined ? (
            <li
              className={`tree-node file${activeFiles.has('manifest') ? ' active' : ''}${manifestError !== undefined ? ' error' : ''}`}
              title={
                manifestError !== undefined
                  ? `Manifest syntax error: ${manifestError}`
                  : 'Rig manifest'
              }
            >
              <button
                type="button"
                className="tree-node-button"
                onClick={() => onOpenFile('manifest')}
              >
                <span className="icon">📄</span>
                <span className="name">{source.manifestFile.name}</span>
                {source.synthetic && <span className="badge">new</span>}
              </button>
            </li>
          ) : (
            <li
              className="tree-node file missing"
              title="Not present in this folder"
            >
              <span className="icon">📄</span>
              <span className="name">cuboidy.json</span>
            </li>
          )}
        </ul>
      </li>
    </ul>
  );
}

function CvoxFileNode({
  name,
  active,
  error,
  onClick,
}: {
  name: string;
  active: boolean;
  error?: string | undefined;
  onClick: () => void;
}) {
  return (
    <li
      className={`tree-node file${active ? ' active' : ''}${error !== undefined ? ' error' : ''}`}
      title={error !== undefined ? `Syntax error: ${error}` : 'Voxel definition'}
    >
      <button type="button" className="tree-node-button" onClick={onClick}>
        <span className="icon">📄</span>
        <span className="name">{name}</span>
      </button>
    </li>
  );
}

function canCreateManifest(source: LoadedSource): boolean {
  if (source.kind === 'cvox-only') return true;
  if (source.kind === 'folder' && source.manifest === undefined) return true;
  return false;
}
