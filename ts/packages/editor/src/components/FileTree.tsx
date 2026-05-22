import type { LoadedSource, SelectedTab } from '../lib/types.js';

interface Props {
  source: LoadedSource;
  selectedTab: SelectedTab;
  onSelectTab: (tab: SelectedTab) => void;
  onCreateManifest: () => void;
}

// Read-only file tree for the Files sidebar section. VS Code Explorer-
// shaped: folder loads show the folder as the root node with child
// files indented one level under it; cvox-only loads show a single
// file at the root (no synthetic folder wrap).
//
// Clicking a file activates its tab in the main pane (the file tree
// and the tab bar share `selectedTab` state via App). The active file
// gets a highlighted background so the tree is a constant indicator
// of "what am I viewing right now."

export function FileTree({
  source,
  selectedTab,
  onSelectTab,
  onCreateManifest,
}: Props) {
  return (
    <div className="file-tree">
      {source.kind === 'folder' ? (
        <FolderTree
          source={source}
          selectedTab={selectedTab}
          onSelectTab={onSelectTab}
        />
      ) : (
        <ul className="tree-root">
          <CvoxFileNode
            name={source.cvoxFile.name}
            active={selectedTab === 'cvox'}
            onClick={() => onSelectTab('cvox')}
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
  selectedTab: SelectedTab;
  onSelectTab: (tab: SelectedTab) => void;
}

function FolderTree({ source, selectedTab, onSelectTab }: FolderTreeProps) {
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
            active={selectedTab === 'cvox'}
            onClick={() => onSelectTab('cvox')}
          />
          {source.manifestFile !== undefined ? (
            <li
              className={`tree-node file${selectedTab === 'manifest' ? ' active' : ''}`}
              title={
                source.manifestError !== undefined
                  ? `Manifest parse error: ${source.manifestError}`
                  : 'Rig manifest'
              }
            >
              <button
                type="button"
                className="tree-node-button"
                onClick={() => onSelectTab('manifest')}
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
  onClick,
}: {
  name: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li
      className={`tree-node file${active ? ' active' : ''}`}
      title="Voxel definition"
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
