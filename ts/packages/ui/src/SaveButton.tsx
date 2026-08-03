import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Save } from 'lucide-react';

// The header save affordance both apps render: the three-state button
// and the hook that owns the success flash's decay. Each app had its own
// copy of the ternary and its own bare setTimeout — bare, so a save
// started during a flash could be knocked back to idle by the previous
// timer; the hook clears the pending timer on every transition.

export type SaveState = 'idle' | 'saving' | 'saved';

const SAVE_FLASH_MS = 2000;

export function useSaveFlash(): {
  state: SaveState;
  // In flight — disables the button.
  setSaving: () => void;
  // Show "Saved", then decay back to idle after the flash.
  flashSaved: () => void;
  // Back to idle immediately (the failure path).
  reset: () => void;
} {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<number | null>(null);
  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  useEffect(() => clear, [clear]);
  const setSaving = useCallback(() => {
    clear();
    setState('saving');
  }, [clear]);
  const flashSaved = useCallback(() => {
    clear();
    setState('saved');
    timer.current = window.setTimeout(() => setState('idle'), SAVE_FLASH_MS);
  }, [clear]);
  const reset = useCallback(() => {
    clear();
    setState('idle');
  }, [clear]);
  return { state, setSaving, flashSaved, reset };
}

export function SaveButton({
  state,
  disabled = false,
  className,
  onClick,
}: {
  state: SaveState;
  // Additional reason the button is unavailable; 'saving' disables it
  // regardless.
  disabled?: boolean;
  className?: string | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`btn btn-primary${className !== undefined ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled || state === 'saving'}
    >
      {state === 'saving' ? (
        'Saving…'
      ) : state === 'saved' ? (
        <>
          <Check size={14} />
          Saved
        </>
      ) : (
        <>
          <Save size={14} />
          Save
        </>
      )}
    </button>
  );
}
