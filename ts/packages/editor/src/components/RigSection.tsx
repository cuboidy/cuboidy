import type {
  Manifest,
  ManifestPart,
} from '@cuboidy/core';
import { useEffect, useState, type ChangeEvent } from 'react';

interface Props {
  manifest: Manifest;
  // Disabled while the manifest source has parse errors — same gating
  // as PalettePanel: a structural edit here would re-serialize from a
  // stale AST and clobber the user's in-progress text.
  disabled?: boolean;
  onChange: (next: Manifest) => void;
}

// Structured editor for cuboidy.json rig: each manifest part gets a
// row with parent dropdown + position inputs. Sits in the right
// panel below the palette, so rig editing is reachable from any
// main-pane tab. Renames and add/remove are deferred — renaming
// requires syncing with voxels.cvox part names (cross-file mutation),
// and add/remove without a matching cvox part would just trigger
// cross-file lint errors. Source view edit remains the escape for
// those structural changes.

const NONE_VALUE = '__none__';

export function RigSection({ manifest, disabled = false, onChange }: Props) {
  const updatePart = (index: number, build: (p: ManifestPart) => ManifestPart) => {
    if (disabled) return;
    const newParts = manifest.parts.map((p, i) => (i === index ? build(p) : p));
    onChange({ ...manifest, parts: newParts });
  };

  return (
    <section className={`rig-section${disabled ? ' disabled' : ''}`}>
      <div className="panel-header">
        <h3>Rig</h3>
        <span className="panel-meta">
          {manifest.parts.length} part{manifest.parts.length === 1 ? '' : 's'}
        </span>
      </div>
      {disabled && (
        <p className="panel-note">
          Manifest source has parse errors — fix to enable rig editing.
        </p>
      )}
      <ul className="rig-list">
        {manifest.parts.map((part, i) => (
          <RigPartRow
            key={part.name}
            part={part}
            allParts={manifest.parts}
            disabled={disabled}
            onChangeParent={(parent) =>
              updatePart(i, (p) => withParent(p, parent))
            }
            onChangePosition={(axis, value) =>
              updatePart(i, (p) => withPosition(p, axis, value))
            }
          />
        ))}
      </ul>
    </section>
  );
}

interface RowProps {
  part: ManifestPart;
  allParts: ReadonlyArray<ManifestPart>;
  disabled: boolean;
  onChangeParent: (parent: string | null) => void;
  onChangePosition: (axis: 0 | 1 | 2, value: number) => void;
}

function RigPartRow({
  part,
  allParts,
  disabled,
  onChangeParent,
  onChangePosition,
}: RowProps) {
  const position = part.position ?? [0, 0, 0];
  const handleParent = (e: ChangeEvent<HTMLSelectElement>) => {
    onChangeParent(e.target.value === NONE_VALUE ? null : e.target.value);
  };

  return (
    <li className="rig-row">
      <div className="rig-row-name">{part.name}</div>
      <label className="rig-field">
        <span className="rig-field-label">parent</span>
        <select
          value={part.parent ?? NONE_VALUE}
          disabled={disabled}
          onChange={handleParent}
        >
          <option value={NONE_VALUE}>(none)</option>
          {allParts
            .filter((p) => p.name !== part.name)
            .map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <div className="rig-position">
        <PositionInput
          axis="x"
          value={position[0]}
          disabled={disabled}
          onChange={(v) => onChangePosition(0, v)}
        />
        <PositionInput
          axis="y"
          value={position[1]}
          disabled={disabled}
          onChange={(v) => onChangePosition(1, v)}
        />
        <PositionInput
          axis="z"
          value={position[2]}
          disabled={disabled}
          onChange={(v) => onChangePosition(2, v)}
        />
      </div>
    </li>
  );
}

interface PositionInputProps {
  axis: 'x' | 'y' | 'z';
  value: number;
  disabled: boolean;
  onChange: (next: number) => void;
}

// Number inputs need a local string state so users can type
// intermediate values like `-`, `.`, `1.` without the controlled
// input snapping back to the parsed numeric value. The classic
// controlled-input bug: typing `-` fails to parse → state stays at
// last numeric → React resets the input back, eating the `-`. Here
// we hold the raw text locally and only commit to the parent's
// numeric state when the text is a finite number; the input is
// always controlled by `text`, so partial inputs persist visually.
//
// External changes to `value` (e.g., source-view JSON edit) sync
// back into `text` via the effect — but only when the displayed
// text doesn't already represent the new numeric value, preventing
// the sync from clobbering an in-progress typed string.
function PositionInput({ axis, value, disabled, onChange }: PositionInputProps) {
  const [text, setText] = useState<string>(() => String(value));

  useEffect(() => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed !== value) {
      setText(String(value));
    }
    // `text` intentionally omitted: we don't want this effect to fire
    // every time the user types — only when the parent value changes
    // out from under us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);
    if (raw === '' || raw === '-') {
      // Treat as 0 in the AST while keeping the typed string visible.
      onChange(0);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(n);
    // else: in-progress like `.`, `-.`, `1e` — keep text, don't commit.
  };

  return (
    <label className="rig-pos-input">
      <span className="rig-pos-axis">{axis}</span>
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

// Helpers that respect `exactOptionalPropertyTypes`: we never assign
// `undefined` to an optional field. Removing parent means rebuilding
// the object without the parent key entirely.
function withParent(part: ManifestPart, parent: string | null): ManifestPart {
  if (parent === null) {
    const { parent: _drop, ...rest } = part;
    return rest;
  }
  return { ...part, parent };
}

function withPosition(
  part: ManifestPart,
  axis: 0 | 1 | 2,
  value: number,
): ManifestPart {
  const cur = part.position ?? [0, 0, 0];
  const next: [number, number, number] = [cur[0], cur[1], cur[2]];
  next[axis] = value;
  return { ...part, position: next };
}
