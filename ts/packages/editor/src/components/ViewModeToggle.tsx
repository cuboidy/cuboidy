import type { ViewMode } from '../lib/types.js';

interface Props {
  mode: ViewMode;
  rigAvailable: boolean;
  animAvailable: boolean;
  onChange: (mode: ViewMode) => void;
}

// Segmented toggle for the 3D pane:
//   - Geometry view: parts at origin (geometry-file-faithful)
//   - Rig view:      parts at manifest positions (requires a cuboidy.json)
//   - Anim view:     animation playback + keyframe editing (requires a manifest)
// A view is disabled when its requirement is unmet; the tooltip explains why.

export function ViewModeToggle({
  mode,
  rigAvailable,
  animAvailable,
  onChange,
}: Props) {
  return (
    <div className="view-toggle" role="tablist" aria-label="View mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'geometry'}
        className={mode === 'geometry' ? 'active' : ''}
        onClick={() => onChange('geometry')}
      >
        Geometry view
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
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'anim'}
        className={mode === 'anim' ? 'active' : ''}
        disabled={!animAvailable}
        title={
          animAvailable
            ? 'Play and edit the model’s animations'
            : 'Requires a cuboidy.json (load a folder or click Create manifest)'
        }
        onClick={() => animAvailable && onChange('anim')}
      >
        Anim view
      </button>
    </div>
  );
}
