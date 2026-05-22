import type { Cvox } from '@cuboidy/core';
import { PalettePanel } from './PalettePanel.js';

interface Props {
  cvox: Cvox;
  // Disabled when the cvox source has parse errors — palette edits
  // would re-serialize from a stale AST and clobber the user's
  // in-progress text. See PalettePanel for the gating rationale.
  cvoxEditsDisabled?: boolean;
  onCvoxChange: (next: Cvox) => void;
}

// Right sidebar container. Holds tools that operate on the loaded
// model from any main-pane tab (Preview / cvox / manifest). Today
// just the palette; future stages will stack voxel-painter,
// socket-inspector, and pivot-tool sections here.

export function RightPanel({ cvox, cvoxEditsDisabled, onCvoxChange }: Props) {
  return (
    <aside className="right-panel">
      <PalettePanel
        cvox={cvox}
        disabled={cvoxEditsDisabled === true}
        onChange={onCvoxChange}
      />
    </aside>
  );
}
