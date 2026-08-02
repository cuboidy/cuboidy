import { useCallback, useEffect, useReducer } from 'react';
import { historyReducer, makeHistory, type HistoryState } from '@cuboidy/ui';
import { emptyScene, type Scene } from './scene.js';

export interface SceneHistory {
  scene: Scene;
  canUndo: boolean;
  canRedo: boolean;
  // A recorded edit. `tag` is the coalescing identity: consecutive edits
  // with the same tag inside the reducer's window merge into one entry,
  // which is what stops a number field's per-keystroke commits from
  // filling the stack with a hundred one-digit steps. `null` always
  // pushes.
  edit: (tag: string | null, apply: (s: Scene) => Scene) => void;
  // A change that is NOT an edit to the document: playback. `anim` lives
  // on Instance for convenience but is never written to the file, and
  // pressing play is not something Ctrl+Z should take back.
  amend: (apply: (s: Scene) => Scene) => void;
  // A different document (folder opened, scene opened, New scene). The
  // stack is cleared: undoing across a load would restore a scene into a
  // library that may not have the models for it.
  replace: (next: Scene) => void;
  undo: () => void;
  redo: () => void;
}

// Undo/redo for the scene, over @cuboidy/ui's history reducer — the same
// one the editor's document uses.
//
// The workspace had none, which is why the Delete key was held back: with
// nothing to take it back, a keypress that loses an instance's placement,
// rotation and attachment is worse than the row button it would replace.
// This covers every mutation, not just that one.
export function useSceneHistory(): SceneHistory {
  const [history, dispatch] = useReducer(
    historyReducer<Scene>,
    undefined,
    (): HistoryState<Scene> => makeHistory(emptyScene()),
  );

  const edit = useCallback(
    (tag: string | null, apply: (s: Scene) => Scene) => {
      // Date.now() is captured HERE, not in the reducer: a reducer that
      // reads the clock is not a pure function of its inputs, and React
      // calls it twice in StrictMode.
      dispatch({ type: 'edit', tag, at: Date.now(), apply });
    },
    [],
  );
  const amend = useCallback(
    (apply: (s: Scene) => Scene) => dispatch({ type: 'amend', apply }),
    [],
  );
  const replace = useCallback(
    (next: Scene) => dispatch({ type: 'replace', next }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;
      // Mid-IME-composition keystrokes are the IME's business.
      if (e.isComposing || e.keyCode === 229) return;
      // Inside a text field the browser's own undo applies — taking the
      // whole scene back because someone mistyped a name would be a
      // surprising trade.
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest(
          'textarea, input, select, [contenteditable=""], [contenteditable="true"]',
        ) !== null
      ) {
        return;
      }
      e.preventDefault();
      if (isUndo) undo();
      else redo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return {
    scene: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    edit,
    amend,
    replace,
    undo,
    redo,
  };
}
