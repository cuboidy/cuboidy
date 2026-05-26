import type { LoadedSource, SelectedTab } from '../lib/types.js';
import { FileTree } from './FileTree.js';
import { PartTree } from './PartTree.js';

interface Props {
  source: LoadedSource;
  selectedTab: SelectedTab;
  hiddenParts: ReadonlySet<string>;
  selectedPart: string | null;
  onSelectTab: (tab: SelectedTab) => void;
  onSelectPart: (name: string | null) => void;
  onToggle: (name: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onChangePartParent: (name: string, parent: string | null) => void;
  onCreateManifest: () => void;
}

// Two-section sidebar: Files (read-only file tree, the project's
// "Explorer" pane) + Parts (hierarchy view of the loaded cvox, with
// visibility checkboxes and click-to-select for the right-panel
// inspector). Parts gets its parent/child structure from the loaded
// manifest when one exists; otherwise it falls back to a flat list.

export function Sidebar({
  source,
  selectedTab,
  hiddenParts,
  selectedPart,
  onSelectTab,
  onSelectPart,
  onToggle,
  onShowAll,
  onHideAll,
  onChangePartParent,
  onCreateManifest,
}: Props) {
  const visibleCount = source.cvox.parts.length - hiddenParts.size;
  const manifest =
    source.kind === 'folder' ? source.manifest : undefined;
  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <div className="sidebar-section-header">
          <h2>Files</h2>
        </div>
        <FileTree
          source={source}
          selectedTab={selectedTab}
          onSelectTab={onSelectTab}
          onCreateManifest={onCreateManifest}
        />
      </section>

      <section className="sidebar-section">
        <div className="sidebar-section-header">
          <h2>Parts</h2>
          <span className="count">
            {visibleCount} / {source.cvox.parts.length}
          </span>
        </div>
        <div className="sidebar-actions">
          <button
            type="button"
            onClick={onShowAll}
            disabled={hiddenParts.size === 0}
          >
            Show all
          </button>
          <button
            type="button"
            onClick={onHideAll}
            disabled={visibleCount === 0}
          >
            Hide all
          </button>
        </div>
        <PartTree
          parts={source.cvox.parts}
          manifest={manifest}
          hiddenParts={hiddenParts}
          selectedPart={selectedPart}
          dndEnabled={manifest !== undefined}
          onToggleVisibility={onToggle}
          onSelectPart={onSelectPart}
          onChangeParent={onChangePartParent}
        />
      </section>
    </aside>
  );
}
