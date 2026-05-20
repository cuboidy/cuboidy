import type { ViewMode } from '../lib/types.js';

interface Props {
  mode: ViewMode;
  rigAvailable: boolean;
  onChange: (mode: ViewMode) => void;
}

// Two-button segmented toggle for switching between Cvox view (parts at
// origin, .cvox-faithful) and Rig view (parts at manifest positions).
// Rig view is disabled when no manifest is loaded — clicking the disabled
// button does nothing; the tooltip explains why.

export function ViewModeToggle({ mode, rigAvailable, onChange }: Props) {
  return (
    <div className="view-toggle" role="tablist" aria-label="View mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'cvox'}
        className={mode === 'cvox' ? 'active' : ''}
        onClick={() => onChange('cvox')}
      >
        Cvox view
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'rig'}
        className={mode === 'rig' ? 'active' : ''}
        disabled={!rigAvailable}
        title={
          rigAvailable
            ? 'View parts placed by the manifest'
            : 'Requires a cuboidy.json (load a folder or click Create manifest)'
        }
        onClick={() => rigAvailable && onChange('rig')}
      >
        Rig view
      </button>
    </div>
  );
}
