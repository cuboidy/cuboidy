import { useEffect, useState, type ChangeEvent } from 'react';

interface Props {
  // Short label shown left of the field (e.g. an axis "x"/"y"/"z"). Omit for
  // an unlabelled input.
  label?: string;
  value: number;
  disabled?: boolean;
  step?: string;
  onChange: (next: number) => void;
}

// Number input with a LOCAL text buffer so users can type intermediate
// values like `-`, `.`, `1.` without React snapping back to the parsed
// numeric value. Without the buffer, typing `-` would parse to NaN, the
// committed numeric state would stay put, and React would re-render with the
// old string — eating the `-`.
//
// Extracted from PartProperties' PositionInput so the keyframe inspector and
// the rig inspector share one implementation of this subtle behavior.
export function NumberInput({ label, value, disabled = false, step = 'any', onChange }: Props) {
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
    // Commit only a complete, finite number. Intermediate input — '', '-',
    // '.', '-.' — is buffered WITHOUT committing, so a partial negative or
    // decimal isn't snapped back to the old value (and doesn't churn the
    // manifest). Committing 0 for '-' here would update the parent to 0, and
    // the [value] effect would then reset the buffer, eating the '-'.
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) onChange(n);
  };

  return (
    <label className="property-position-input">
      {label !== undefined && <span className="property-position-axis">{label}</span>}
      <input
        type="number"
        value={text}
        step={step}
        disabled={disabled}
        onChange={handleChange}
      />
    </label>
  );
}
