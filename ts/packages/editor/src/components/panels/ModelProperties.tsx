import { Plus } from 'lucide-react';
import type { Manifest } from '@cuboidy/core';
import { TextInput } from '../ui/TextInput.js';

interface Props {
  // The model manifest (cuboidy.json). Undefined for a lone geometry file or a
  // folder that has no manifest yet — the panel then offers to create one.
  manifest: Manifest | undefined;
  // Blocked while the manifest source has syntax errors: a form edit would
  // re-serialize from a stale AST and clobber the in-progress source text
  // (same guard PartProperties' rig section uses).
  disabled: boolean;
  onChangeName: (name: string) => void;
  onChangeVersion: (version: string) => void;
}

// Model-level cuboidy.json inspector: the fields that describe the whole
// model rather than any one part (name / version). Per-part manifest data
// (parent / position) stays in PartProperties — it's edited by selecting a
// part, so it belongs with the part, not here.
export function ModelProperties({
  manifest,
  disabled,
  onChangeName,
  onChangeVersion,
}: Props) {
  // Every model HAS a manifest (SPEC §3) — the loader refuses one that
  // does not. An absent AST therefore means its text does not parse, not
  // that the model lacks one, so the way out is the source tab.
  if (manifest === undefined) {
    return (
      <section className="model-properties">
        <div className="property-group-empty">
          <p>cuboidy.json doesn&apos;t parse — fix it in its source tab.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="model-properties">
      {disabled && (
        <p className="property-group-note">
          Manifest source has syntax errors — fix to edit model fields.
        </p>
      )}
      <div className={`property-group${disabled ? ' disabled' : ''}`}>
        <label className="property-field">
          <span className="property-field-label">name</span>
          <TextInput
            value={manifest.name}
            disabled={disabled}
            ariaLabel="Model name"
            // Required by the schema — reject an empty name (revert-and-flash).
            validate={(v) => v.length > 0}
            onCommit={onChangeName}
          />
        </label>
        <label className="property-field">
          <span className="property-field-label">version</span>
          <TextInput
            value={manifest.version ?? ''}
            disabled={disabled}
            ariaLabel="Model version"
            // Optional free-form string; empty clears it (handler drops the key).
            validate={() => true}
            onCommit={onChangeVersion}
          />
        </label>
      </div>
    </section>
  );
}
