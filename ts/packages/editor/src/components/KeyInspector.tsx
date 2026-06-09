import type { AttrValue, Keyframe } from '@cuboidy/core';
import type { SelectedKey } from '../lib/types.js';
import { NumberInput } from './NumberInput.js';

interface Props {
  selectedKey: SelectedKey;
  // The keyframe entry at selectedKey.timeKey (carries the attribute value).
  keyframe: Keyframe;
  disabled: boolean;
  onSetField: (value: AttrValue) => void;
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
// axis fields; visible as a checkbox. The time-key is read-only (retiming is
// a later milestone). Edits flow straight back to the manifest via onSetField.
export function KeyInspector({
  selectedKey,
  keyframe,
  disabled,
  onSetField,
  onDelete,
}: Props) {
  const { part, attr, timeKey } = selectedKey;

  return (
    <div className="anim-inspector">
      <div className="anim-inspector-header">
        <span className="anim-inspector-title">
          {part} · {attr}
        </span>
        <span className="anim-inspector-time">@ {timeKey}s</span>
      </div>

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

      <button
        type="button"
        className="anim-inspector-delete"
        disabled={disabled}
        onClick={onDelete}
      >
        Delete key
      </button>
    </div>
  );
}
