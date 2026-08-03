import { useEffect } from 'react';
import { isTextEntryTarget } from '@cuboidy/ui';

// Delete / Backspace fires `onDelete` (removing the selected instance).
//
// Held back until there was an undo stack to take it back: without one,
// a keypress losing an instance's placement, rotation and attachment
// would have been the only irreversible single-key action in either
// app — worse than the row × it replaces, which is why that moved to
// Properties in the first place.
export function useDeleteKey(onDelete: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // In a text field these keys are text editing, not scene editing.
      if (isTextEntryTarget(e.target)) return;
      e.preventDefault();
      onDelete();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDelete]);
}
