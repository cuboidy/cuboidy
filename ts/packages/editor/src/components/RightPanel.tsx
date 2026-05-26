import type { Cvox, Manifest } from '@cuboidy/core';
import { PalettePanel } from './PalettePanel.js';
import { PartProperties } from './PartProperties.js';

interface Props {
  cvox: Cvox;
  cvoxEditsDisabled?: boolean;
  onCvoxChange: (next: Cvox) => void;
  // The right panel inspector shows properties for the currently
  // selected part. Null hides it entirely (Palette stays on top, no
  // empty placeholder underneath).
  selectedPart: string | null;
  manifest?: Manifest;
  manifestEditsDisabled: boolean;
  onChangePartParent: (partName: string, parent: string | null) => void;
  onChangePartPosition: (
    partName: string,
    axis: 0 | 1 | 2,
    value: number,
  ) => void;
  onCreateManifest: () => void;
}

// Right sidebar container. Stacks tool sections vertically: palette
// (always when source loaded) + per-part properties (when a part is
// selected in the parts tree). Each section gates itself on its own
// parse-error flag so the user can keep editing one file while the
// other is temporarily broken.

export function RightPanel({
  cvox,
  cvoxEditsDisabled,
  onCvoxChange,
  selectedPart,
  manifest,
  manifestEditsDisabled,
  onChangePartParent,
  onChangePartPosition,
  onCreateManifest,
}: Props) {
  return (
    <aside className="right-panel">
      <PalettePanel
        cvox={cvox}
        disabled={cvoxEditsDisabled === true}
        onChange={onCvoxChange}
      />
      {selectedPart !== null && (
        <PartProperties
          selectedPart={selectedPart}
          cvox={cvox}
          manifest={manifest}
          manifestEditsDisabled={manifestEditsDisabled}
          onChangeParent={onChangePartParent}
          onChangePosition={onChangePartPosition}
          onCreateManifest={onCreateManifest}
        />
      )}
    </aside>
  );
}
