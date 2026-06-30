import type { LoadedSource, SelectedTab } from '../lib/types.js';
import { FileTree } from './FileTree.js';
import { Panel } from './Panel.js';
import { PartTree } from './PartTree.js';

interface Props {
  source: LoadedSource;
  selectedTab: SelectedTab;
  hiddenParts: ReadonlySet<string>;
  selectedPart: string | null;
  // Current parse/syntax error per source file (undefined = none), used to
  // flag the file tree node. Live edits or a load-time failure both feed in.
  cvoxError?: string | undefined;
  manifestError?: string | undefined;
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
  cvoxError,
  manifestError,
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
      <Panel title="Files">
        <FileTree
          source={source}
          selectedTab={selectedTab}
          cvoxError={cvoxError}
          manifestError={manifestError}
          onSelectTab={onSelectTab}
          onCreateManifest={onCreateManifest}
        />
      </Panel>

      <Panel
        title="Parts"
        meta={`${visibleCount} / ${source.cvox.parts.length}`}
      >
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
      </Panel>
    </aside>
  );
}
