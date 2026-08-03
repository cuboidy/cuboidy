import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

// Shared inline text field for naming things in tree rows — the editor's
// part and file create/rename, the workspace's instance rename. Here
// rather than in either app because its styling already was: `tree.css`
// owns the shape a tree row takes in this product, and the field you type
// a name into is part of that shape.
//
// Auto-focuses and
// selects its text; Enter commits a valid, non-empty name; Escape or
// blurring away (clicking elsewhere) cancels — so an accidental click
// never commits. Invalid names flash red and keep the field open. A
// `done` latch keeps the unmount-blur from firing after Enter/Escape
// already resolved it.
//
// `leadingIcon`, when given, renders a per-keystroke icon before the
// field (file rows pass `fileIcon` so the glyph tracks the typed
// extension live — type `.md` and it flips from the JSON braces to the
// braces icon). Rows without an icon (folders, parts) just omit it.
//
// `trailing` makes the field a COMPOSITE row (the part-create draft adds
// a target-file picker): the extra control renders after the input, and
// commit/cancel move to a display:contents container — Enter commits
// from either control, and only focus leaving the WHOLE row cancels, so
// tabbing into the picker doesn't throw the draft away.
export function InlineNameInput({
  initial,
  ariaLabel,
  validate,
  onCommit,
  onCancel,
  leadingIcon,
  trailing,
}: {
  initial: string;
  ariaLabel: string;
  validate: (name: string) => boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
  leadingIcon?: (name: string) => ReactNode;
  trailing?: ReactNode;
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
      // In a composite row the commit may come from the trailing control;
      // the fix happens in the name field, so put focus back there.
      ref.current?.focus();
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

  const composite = trailing !== undefined;
  const body = (
    <>
      {leadingIcon !== undefined && (
        <span className="tree-icon">{leadingIcon(text)}</span>
      )}
      <input
        ref={ref}
        type="text"
        className={`tree-name-input${invalid ? ' invalid' : ''}`}
        value={text}
        aria-label={ariaLabel}
        spellCheck={false}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        {...(!composite && {
          onKeyDown: handleKeyDown,
          onBlur: () => finish(false),
        })}
        onAnimationEnd={() => setInvalid(false)}
      />
      {trailing}
    </>
  );
  if (!composite) return body;
  return (
    // display:contents (tree.css), so the row's flex layout still sees
    // the input and the trailing control as direct items.
    <span
      className="inline-name-row"
      onKeyDown={handleKeyDown}
      onBlur={(e) => {
        // focusout whose relatedTarget is still inside the row is just
        // the user moving between the controls — not a cancel.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        finish(false);
      }}
    >
      {body}
    </span>
  );
}
