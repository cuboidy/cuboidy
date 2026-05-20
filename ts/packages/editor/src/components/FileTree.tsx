import type { LoadedSource } from '../lib/types.js';

interface Props {
  source: LoadedSource;
  onCreateManifest: () => void;
}

// Read-only file tree for the Files sidebar section. VS Code Explorer-
// shaped: folder loads show the folder as the root node with child
// files indented one level under it; cvox-only loads show a single
// file at the root (no synthetic folder wrap).
//
// Future stages will add per-file selection (click → open a dedicated
// editor surface, A2-rig-3+); this stage just surfaces what's loaded.
// Create manifest sits below the tree so the upcoming file appears
// "right next to" where it'll be inserted.

export function FileTree({ source, onCreateManifest }: Props) {
  return (
    <div className="file-tree">
      {source.kind === 'folder' ? (
        <FolderTree source={source} />
      ) : (
        <ul className="tree-root">
          <li className="tree-node file" title="Voxel definition">
            <span className="icon">📄</span>
            <span className="name">{source.cvoxFile.name}</span>
          </li>
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

function FolderTree({ source }: { source: Extract<LoadedSource, { kind: 'folder' }> }) {
  return (
    <ul className="tree-root">
      <li className="tree-node folder">
        <div className="folder-row">
          <span className="icon">📁</span>
          <span className="name">{source.folderName}</span>
          {source.synthetic && <span className="badge">unsaved</span>}
        </div>
        <ul className="tree-children">
          <li className="tree-node file" title="Voxel definition">
            <span className="icon">📄</span>
            <span className="name">{source.cvoxFile.name}</span>
          </li>
          {source.manifestFile !== undefined ? (
            <li
              className="tree-node file"
              title={
                source.manifestError !== undefined
                  ? `Manifest parse error: ${source.manifestError}`
                  : 'Rig manifest'
              }
            >
              <span className="icon">📄</span>
              <span className="name">{source.manifestFile.name}</span>
              {source.synthetic && <span className="badge">new</span>}
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

function canCreateManifest(source: LoadedSource): boolean {
  if (source.kind === 'cvox-only') return true;
  if (source.kind === 'folder' && source.manifest === undefined) return true;
  return false;
}
