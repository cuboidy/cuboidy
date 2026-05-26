import {
  useEffect,
  useState,
  type ChangeEvent,
} from 'react';
import type { Cvox, Manifest, ManifestPart } from '@cuboidy/core';
import { findManifestPart } from '../lib/part-tree.js';

interface Props {
  selectedPart: string;
  cvox: Cvox;
  manifest: Manifest | undefined;
  // Disabled while the manifest source has parse errors — a
  // structural edit here would re-serialize from a stale AST and
  // clobber the user's in-progress source-tab text.
  manifestEditsDisabled: boolean;
  onChangeParent: (partName: string, parent: string | null) => void;
  onChangePosition: (partName: string, axis: 0 | 1 | 2, value: number) => void;
  onCreateManifest: () => void;
}

const NONE_VALUE = '__none__';

// Right-panel inspector for a single selected part. Phase 1 surfaces
// the rig fields (parent + position) only; cvox-side fields (size /
// pivot / sockets) get their own section in a follow-up stage.

export function PartProperties({
  selectedPart,
  cvox,
  manifest,
  manifestEditsDisabled,
  onChangeParent,
  onChangePosition,
  onCreateManifest,
}: Props) {
  const cvoxPart = cvox.parts.find((p) => p.name === selectedPart);
  if (cvoxPart === undefined) {
    // Selection points at a part that no longer exists in cvox (e.g.,
    // the user just edited the source view to remove it). Render
    // nothing — the App will clear selection on the next render via
    // the same effect that prunes stale state elsewhere.
    return null;
  }

  const manifestPart =
    manifest !== undefined ? findManifestPart(manifest, selectedPart) : undefined;
  const hasManifest = manifest !== undefined;
  const rigDisabled = !hasManifest || manifestEditsDisabled;

  return (
    <section className="part-properties">
      <div className="part-properties-header">
        <h3 className="part-properties-name">{selectedPart}</h3>
        <span className="part-properties-meta">
          {cvoxPart.size.w}×{cvoxPart.size.h}×{cvoxPart.size.d}
        </span>
      </div>

      <div className={`property-group${rigDisabled ? ' disabled' : ''}`}>
        <div className="property-group-header">
          <h4>Rig</h4>
        </div>
        {!hasManifest && (
          <div className="property-group-empty">
            <p>No manifest — parent and position can't be set yet.</p>
            <button
              type="button"
              className="create-manifest-inline"
              onClick={onCreateManifest}
            >
              + Create manifest
            </button>
          </div>
        )}
        {hasManifest && manifestEditsDisabled && (
          <p className="property-group-note">
            Manifest source has parse errors — fix to enable rig editing.
          </p>
        )}
        {hasManifest && (
          <RigFields
            selectedPart={selectedPart}
            cvox={cvox}
            manifestPart={manifestPart}
            disabled={manifestEditsDisabled}
            onChangeParent={onChangeParent}
            onChangePosition={onChangePosition}
          />
        )}
      </div>
    </section>
  );
}

interface RigFieldsProps {
  selectedPart: string;
  cvox: Cvox;
  manifestPart: ManifestPart | undefined;
  disabled: boolean;
  onChangeParent: (partName: string, parent: string | null) => void;
  onChangePosition: (partName: string, axis: 0 | 1 | 2, value: number) => void;
}

function RigFields({
  selectedPart,
  cvox,
  manifestPart,
  disabled,
  onChangeParent,
  onChangePosition,
}: RigFieldsProps) {
  const position = manifestPart?.position ?? [0, 0, 0];
  const parent = manifestPart?.parent ?? null;

  const handleParent = (e: ChangeEvent<HTMLSelectElement>) => {
    onChangeParent(
      selectedPart,
      e.target.value === NONE_VALUE ? null : e.target.value,
    );
  };

  return (
    <>
      <label className="property-field">
        <span className="property-field-label">parent</span>
        <select
          value={parent ?? NONE_VALUE}
          disabled={disabled}
          onChange={handleParent}
        >
          <option value={NONE_VALUE}>(none)</option>
          {cvox.parts
            .filter((p) => p.name !== selectedPart)
            .map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <div className="property-position">
        <PositionInput
          axis="x"
          value={position[0]}
          disabled={disabled}
          onChange={(v) => onChangePosition(selectedPart, 0, v)}
        />
        <PositionInput
          axis="y"
          value={position[1]}
          disabled={disabled}
          onChange={(v) => onChangePosition(selectedPart, 1, v)}
        />
        <PositionInput
          axis="z"
          value={position[2]}
          disabled={disabled}
          onChange={(v) => onChangePosition(selectedPart, 2, v)}
        />
      </div>
    </>
  );
}

interface PositionInputProps {
  axis: 'x' | 'y' | 'z';
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}

// Local text state so users can type intermediate values like `-`,
// `.`, `1.` without React snapping back to the parsed numeric value.
// Without the local buffer, typing `-` would parse to NaN, the
// committed numeric state would stay at its previous value, and
// React would re-render with the old string — eating the `-`.
function PositionInput({ axis, value, disabled, onChange }: PositionInputProps) {
  const [text, setText] = useState<string>(() => String(value));

  useEffect(() => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed !== value) {
      setText(String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    if (raw === '' || raw === '-') {
      onChange(0);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(n);
  };

  return (
    <label className="property-position-input">
      <span className="property-position-axis">{axis}</span>
      <input
        type="number"
        value={text}
        step="any"
        disabled={disabled}
        onChange={handleChange}
      />
    </label>
  );
}
