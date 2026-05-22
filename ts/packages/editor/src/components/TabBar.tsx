import type { LoadedSource, SelectedTab } from '../lib/types.js';

interface Props {
  source: LoadedSource;
  selected: SelectedTab;
  onSelect: (tab: SelectedTab) => void;
}

// Tab bar above the main pane. Tabs:
//   - Preview: always (the 3D scene)
//   - voxels.cvox: always (the cvox file is required)
//   - cuboidy.json: only when the manifest is loaded
// Clicking a tab switches the main pane's content. The file tree's
// click handler routes to the same handler so selection state stays
// in one place (App.tsx). Active tab is highlighted with a stronger
// background and a colored bottom edge.

export function TabBar({ source, selected, onSelect }: Props) {
  const hasManifest =
    source.kind === 'folder' && source.manifestFile !== undefined;

  return (
    <div className="tab-bar" role="tablist">
      <Tab
        label="Preview"
        active={selected === 'preview'}
        onClick={() => onSelect('preview')}
      />
      <Tab
        label={source.cvoxFile.name}
        icon="📄"
        active={selected === 'cvox'}
        onClick={() => onSelect('cvox')}
      />
      {hasManifest && (
        <Tab
          label={source.manifestFile?.name ?? 'cuboidy.json'}
          icon="📄"
          active={selected === 'manifest'}
          onClick={() => onSelect('manifest')}
        />
      )}
    </div>
  );
}

interface TabProps {
  label: string;
  icon?: string;
  active: boolean;
  onClick: () => void;
}

function Tab({ label, icon, active, onClick }: TabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`tab${active ? ' active' : ''}`}
      onClick={onClick}
    >
      {icon !== undefined && <span className="tab-icon">{icon}</span>}
      <span className="tab-label">{label}</span>
    </button>
  );
}
