import {
  useEffect,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';

interface Props {
  value: string;
  disabled?: boolean;
  ariaLabel?: string;
  // Shown when the field is empty. Only useful where empty is a MEANINGFUL
  // state the user can choose (an unpublished socket), not where it is
  // simply an unfilled required field.
  placeholder?: string;
  // Gate for a commit. Only consulted when the trimmed text actually
  // differs from `value` — committing the unchanged name is a silent no-op.
  validate: (next: string) => boolean;
  onCommit: (next: string) => void;
}

// Text input that commits on blur / Enter, validating first. Invalid input
// reverts to the prop value with a brief red flash (a silent revert reads
// like a bug); Escape reverts without committing. NumberInput's sibling —
// kept separate because text needs validate-and-revert, not the numeric
// intermediate-state buffering.
export function TextInput({
  value,
  disabled = false,
  ariaLabel,
  placeholder,
  validate,
  onCommit,
}: Props) {
  const [text, setText] = useState<string>(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(value);
  }, [value]);

  const commit = () => {
    const next = text.trim();
    if (next === value) {
      setText(value);
      return;
    }
    if (!validate(next)) {
      setText(value);
      setInvalid(true); // cleared by onAnimationEnd
      return;
    }
    onCommit(next);
    // The [value] resync rewrites the buffer when the commit lands; if the
    // mutation's own guard rejected it (race), this restores the old name.
    setText(value);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') setText(value);
  };

  return (
    <input
      type="text"
      className={`text-input${invalid ? ' invalid' : ''}`}
      value={text}
      disabled={disabled}
      {...(ariaLabel !== undefined && { 'aria-label': ariaLabel })}
      {...(placeholder !== undefined && { placeholder })}
      onChange={handleChange}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      onAnimationEnd={() => setInvalid(false)}
    />
  );
}
