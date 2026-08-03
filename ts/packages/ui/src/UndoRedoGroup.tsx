import { Redo2, Undo2 } from 'lucide-react';
import { HeaderGroup } from './AppHeader.js';

// The header's undo/redo pair — same pair, same place, same shortcuts in
// both apps (the shortcuts themselves are useUndoRedoShortcuts' job).
export function UndoRedoGroup({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <HeaderGroup>
      <button
        type="button"
        className="icon-btn"
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        onClick={onUndo}
      >
        <Undo2 size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
        onClick={onRedo}
      >
        <Redo2 size={16} />
      </button>
    </HeaderGroup>
  );
}
