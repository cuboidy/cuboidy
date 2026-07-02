import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

// Shared inline text field for naming things in tree rows — part
// create/rename and file create/rename all use it. Auto-focuses and
// selects its text; Enter commits a valid, non-empty name; Escape or
// blurring away (clicking elsewhere) cancels — so an accidental click
// never commits. Invalid names flash red and keep the field open. A
// `done` latch keeps the unmount-blur from firing after Enter/Escape
// already resolved it.
export function InlineNameInput({
  initial,
  ariaLabel,
  validate,
  onCommit,
  onCancel,
}: {
  initial: string;
  ariaLabel: string;
  validate: (name: string) => boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (el !== null) {
      el.focus();
      el.select();
    }
  }, []);

  const finish = (commit: boolean): void => {
    if (done.current) return;
    if (!commit) {
      done.current = true;
      onCancel();
      return;
    }
    const next = text.trim();
    if (next === '') {
      done.current = true;
      onCancel();
      return;
    }
    if (!validate(next)) {
      setInvalid(true);
      return;
    }
    done.current = true;
    onCommit(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };

  return (
    <input
      ref={ref}
      type="text"
      className={`part-tree-name-input${invalid ? ' invalid' : ''}`}
      value={text}
      aria-label={ariaLabel}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(false);
      }}
      onKeyDown={handleKeyDown}
      onBlur={() => finish(false)}
      onAnimationEnd={() => setInvalid(false)}
    />
  );
}
