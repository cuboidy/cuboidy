import type { Cvox, Manifest } from '@cuboidy/core';
import { Panel } from './Panel.js';
import { MAX_PALETTE, PalettePanel } from './PalettePanel.js';
import { PartProperties } from './PartProperties.js';

interface Props {
  cvox: Cvox;
  cvoxEditsDisabled?: boolean;
  // Tag = optional undo-coalescing identity, forwarded from PalettePanel.
  onCvoxChange: (next: Cvox, tag?: string) => void;
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
      <Panel
        title="Palette"
        meta={`${cvox.palette.length} / ${MAX_PALETTE}`}
      >
        <PalettePanel
          cvox={cvox}
          disabled={cvoxEditsDisabled === true}
          onChange={onCvoxChange}
        />
      </Panel>
      {selectedPart !== null && (
        <Panel title="Properties">
          <PartProperties
            selectedPart={selectedPart}
            cvox={cvox}
            manifest={manifest}
            manifestEditsDisabled={manifestEditsDisabled}
            onChangeParent={onChangePartParent}
            onChangePosition={onChangePartPosition}
            onCreateManifest={onCreateManifest}
          />
        </Panel>
      )}
    </aside>
  );
}
