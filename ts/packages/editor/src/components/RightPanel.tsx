import type { Cvox, Manifest } from '@cuboidy/core';
import { PalettePanel } from './PalettePanel.js';
import { RigSection } from './RigSection.js';

interface Props {
  cvox: Cvox;
  cvoxEditsDisabled?: boolean;
  onCvoxChange: (next: Cvox) => void;
  // Optional manifest props. Absent when no manifest is loaded; the
  // Rig section then doesn't render at all (no greyed empty UI).
  manifest?: Manifest;
  manifestEditsDisabled?: boolean;
  onManifestChange?: (next: Manifest) => void;
}

// Right sidebar container. Stacks tool sections vertically: palette
// (always when source loaded) + rig editor (when manifest present).
// Each section gates itself on its own parse-error flag so the user
// can keep editing one file while the other is temporarily broken.

export function RightPanel({
  cvox,
  cvoxEditsDisabled,
  onCvoxChange,
  manifest,
  manifestEditsDisabled,
  onManifestChange,
}: Props) {
  return (
    <aside className="right-panel">
      <PalettePanel
        cvox={cvox}
        disabled={cvoxEditsDisabled === true}
        onChange={onCvoxChange}
      />
      {manifest !== undefined && onManifestChange !== undefined && (
        <RigSection
          manifest={manifest}
          disabled={manifestEditsDisabled === true}
          onChange={onManifestChange}
        />
      )}
    </aside>
  );
}
