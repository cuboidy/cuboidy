import { useEffect } from 'react';

// Document-level keyboard concerns both apps share. Each app used to
// carry a byte-identical copy of the undo/redo handler, plus a third
// copy of the text-entry selector in the workspace's Delete-key guard.

// Is this event aimed at a text-entry control? Inside one, the browser's
// own editing semantics apply — native undo, Delete deletes characters —
// so document-level shortcuts must stand down.
export function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'textarea, input, select, [contenteditable=""], [contenteditable="true"]',
    ) !== null
  );
}

// Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y for the document history.
// Mid-IME-composition keystrokes are the IME's business; inside a text
// field the browser's native undo applies rather than taking the whole
// document back over a mistyped name.
export function useUndoRedoShortcuts(undo: () => void, redo: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;
      if (e.isComposing || e.keyCode === 229) return;
      if (isTextEntryTarget(e.target)) return;
      e.preventDefault();
      if (isUndo) undo();
      else redo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);
}
