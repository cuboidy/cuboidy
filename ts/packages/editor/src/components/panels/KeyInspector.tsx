import { EASING_NAMES, formatTimeKey, type AttrValue, type EasingName, type Keyframe } from '@cuboidy/core';

import { NumberInput } from '../ui/NumberInput.js';
import type { SelectedKey } from '@cuboidy/ui';

interface Props {
  selectedKey: SelectedKey;
  // The keyframe entry at selectedKey.timeKey (carries the attribute value).
  keyframe: Keyframe;
  disabled: boolean;
  // Retime the selected key. The handler clamps like a marker drag (grid,
  // same-attr neighbors, clip range); the field commits on blur/Enter so
  // mid-typing values are never clamped out from under the user.
  onSetTime: (t: number) => void;
  onSetField: (value: AttrValue) => void;
  // Set the SELECTED attribute's ease on this key; undefined clears the
  // entry back to linear. Never called for `visible` (its editor has no
  // ease field — §6.5).
  onSetEase: (ease: EasingName | undefined) => void;
  // Keyframe clipboard: copy this whole time-key entry / merge the copied
  // one at the playhead on this part. null summary = nothing copied yet.
  clipboardSummary: string | null;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
}

type Vec3 = [number, number, number];

// Defensive display fallback only. A lane marker exists iff that attribute's
// field is present at the time-key (Timeline derives markers from `attr in
// keyframe`), and the selection is pruned unless `attr in keyframe` — so
// `keyframe[attr]` is always defined for a real selection and this is never
// hit. It is therefore safe re: SPEC §6.5 carryover (we never overwrite a
// carried-over field, because such a field has no marker to select).
function restVec(attr: SelectedKey['attr']): Vec3 {
  return attr === 'scale' ? [1, 1, 1] : [0, 0, 0];
}

// Inspector for the selected keyframe attribute. rot/pos/scale edit as three
// axis fields; visible as a checkbox; the time field retimes the key (the
// "0.0" start key is locked per SPEC §6.6, like dragging). Edits flow
// straight back to the manifest.
export function KeyInspector({
  selectedKey,
  keyframe,
  disabled,
  onSetTime,
  onSetField,
  onSetEase,
  clipboardSummary,
  onCopy,
  onPaste,
  onDelete,
}: Props) {
  const { part, attr, timeKey } = selectedKey;
  const timeLocked = timeKey === formatTimeKey(0);

  return (
    <div className="anim-inspector">
      <div className="anim-inspector-header">
        <span className="anim-inspector-title">
          {part} · {attr}
        </span>
      </div>

      <label
        className="anim-inspector-time-field"
        title={
          timeLocked
            ? 'Start key — its time is locked (SPEC §6.6)'
            : 'Time in seconds. Commits on Enter / focus out; clamped between neighboring keys.'
        }
      >
        <span className="anim-inspector-time-label">time</span>
        <NumberInput
          value={Number(timeKey)}
          disabled={disabled || timeLocked}
          commitOnBlur
          onChange={onSetTime}
        />
        <span className="anim-inspector-time-unit">s</span>
      </label>

      {attr === 'visible' ? (
        <label className="anim-inspector-visible">
          <input
            type="checkbox"
            checked={keyframe.visible ?? true}
            disabled={disabled}
            onChange={(e) => onSetField(e.target.checked)}
          />
          <span>visible</span>
        </label>
      ) : (
        <div className="property-position">
          {(() => {
            const v = (keyframe[attr] as Vec3 | undefined) ?? restVec(attr);
            return (['x', 'y', 'z'] as const).map((axis, i) => (
              <NumberInput
                key={axis}
                label={axis}
                value={v[i]!}
                disabled={disabled}
                onChange={(n) => {
                  const next: Vec3 = [v[0], v[1], v[2]];
                  next[i] = n;
                  onSetField(next);
                }}
              />
            ));
          })()}
        </div>
      )}

      {attr !== 'visible' && (
        <label
          className="anim-inspector-ease"
          title={`Easing of ${attr}'s segment from this keyframe to the next (SPEC §6.7). Affects only ${attr}, only this segment; "linear" stores nothing.`}
        >
          <span className="anim-inspector-ease-label">ease</span>
          <select
            value={keyframe.ease?.[attr] ?? 'linear'}
            disabled={disabled}
            onChange={(e) =>
              onSetEase(
                e.target.value === 'linear'
                  ? undefined
                  : (e.target.value as EasingName),
              )
            }
          >
            {EASING_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="anim-inspector-clipboard">
        <button
          type="button"
          className="btn btn-sm"
          disabled={disabled}
          title={`Copy this keyframe — every attribute at ${timeKey}s plus its ease (Ctrl+C)`}
          onClick={onCopy}
        >
          Copy
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={disabled || clipboardSummary === null}
          title={
            clipboardSummary !== null
              ? `Paste ${clipboardSummary} at the playhead on ${part} (Ctrl+V). Existing fields at that time are overwritten; others kept.`
              : 'Nothing copied yet (Ctrl+C on a selected key)'
          }
          onClick={onPaste}
        >
          Paste
        </button>
      </div>

      <button
        type="button"
        className="btn btn-danger btn-sm anim-inspector-delete"
        disabled={disabled}
        onClick={onDelete}
      >
        Delete key
      </button>
    </div>
  );
}
