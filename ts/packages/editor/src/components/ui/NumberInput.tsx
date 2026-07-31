import {
  useEffect,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';

interface Props {
  // Short label shown left of the field (e.g. an axis "x"/"y"/"z"). Omit for
  // an unlabelled input.
  label?: string;
  value: number;
  disabled?: boolean;
  step?: string;
  // When true, the typed value is committed on blur / Enter instead of per
  // keystroke. Use when the parent clamps or rewrites committed values
  // (e.g. a keyframe time clamped between its neighbors): live commits
  // would clamp a half-typed number and the [value] resync would then eat
  // the rest of the typing.
  commitOnBlur?: boolean;
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
export function NumberInput({
  label,
  value,
  disabled = false,
  step = 'any',
  commitOnBlur = false,
  onChange,
}: Props) {
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
    if (commitOnBlur) return;
    // Commit only a complete, finite number. Intermediate input — '', '-',
    // '.', '-.' — is buffered WITHOUT committing, so a partial negative or
    // decimal isn't snapped back to the old value (and doesn't churn the
    // manifest). Committing 0 for '-' here would update the parent to 0, and
    // the [value] effect would then reset the buffer, eating the '-'.
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) onChange(n);
  };

  const commit = () => {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n) && n !== value) onChange(n);
    // Snap the buffer back to the prop; if the commit changes the value the
    // [value] resync immediately rewrites it to the (possibly clamped)
    // result, otherwise this restores the original.
    setText(String(value));
  };

  const handleBlur = () => {
    if (commitOnBlur) commit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!commitOnBlur) return;
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') setText(String(value));
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
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
    </label>
  );
}
