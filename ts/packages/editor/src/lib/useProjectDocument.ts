import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { historyReducer, makeHistory } from './history.js';
import { applyFileEdit } from './source-ops.js';
import type { LoadResult } from './types.js';

// The document itself: its text, its undo history, and the parse state
// that decides whether a structural edit may run.
//
// Two invariants live here and nowhere else.
//
// One: text and derived state move TOGETHER. `handleEditFileText` records
// a file's new text and re-derives everything that file feeds in the same
// dispatch, so there is never a moment when the AST describes text that is
// no longer on screen. Text that does not parse only records the text, and
// the last good derived value stands.
//
// Two: `editsBlocked` is the gate for every structural edit (audit A-6).
// A structural edit re-serializes an AST over a file's text, so it must
// not run while any text is mid-edit unparseable — the last good AST would
// silently overwrite what the user just typed. Reading the CURRENT text's
// parse state is what makes it impossible to go stale; the version this
// replaced asked whether a debounce timer was pending, and let an edit
// through the moment that timer had fired and reported the error.

export function useProjectDocument() {
  // The loaded document plus its undo/redo history, in one pure reducer,
  // so they update atomically and stay pure under StrictMode's double
  // invocation. Every mutation goes through `dispatchEdit` (recorded, with
  // an optional coalescing tag); load/reset `replace` (history cleared).
  const [history, dispatch] = useReducer(
    historyReducer<LoadResult | null>,
    null,
    makeHistory<LoadResult | null>,
  );
  const loaded = history.present;
  // Latest-value ref so a handler can read the CURRENT document without
  // re-binding every callback on each edit.
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const dispatchEdit = useCallback(
    (tag: string | null, apply: (c: LoadResult | null) => LoadResult | null) => {
      dispatch({ type: 'edit', tag, at: Date.now(), apply });
    },
    [],
  );

  // Syntax errors on the CURRENTLY TYPED text, per file path. One map
  // covers every file — the primary geometry and the manifest are just
  // entries in it like any other.
  const [fileParseErrors, setFileParseErrors] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const setFileParseError = useCallback((path: string, msg: string | null) => {
    setFileParseErrors((prev) => {
      if (msg === null && !prev.has(path)) return prev;
      const next = new Map(prev);
      if (msg === null) next.delete(path);
      else next.set(path, msg);
      return next;
    });
  }, []);

  // Named views onto the same map, for the panels that speak in terms of
  // "the geometry source" and "the manifest source".
  const geometryParseError =
    loaded?.source === undefined
      ? null
      : (fileParseErrors.get(loaded.source.primaryPath) ?? null);
  const manifestParseError =
    loaded?.source?.manifestPath === undefined
      ? null
      : (fileParseErrors.get(loaded.source.manifestPath) ?? null);
  const editsBlocked = fileParseErrors.size > 0;

  // Replace the document outright (load / reset): history cleared, parse
  // errors dropped with the package they belonged to.
  const replaceDocument = useCallback((next: LoadResult | null) => {
    setFileParseErrors(new Map());
    dispatch({ type: 'replace', next });
  }, []);

  const handleEditFileText = useCallback(
    (path: string, nextText: string) => {
      const src = loadedRef.current?.source;
      if (src === undefined) return;
      setFileParseError(path, applyFileEdit(src, path, nextText).error);
      // Recorded with a per-file tag: a typing burst (keystrokes < 800ms
      // apart) is one undo entry whose pre-state is the text before the
      // burst started.
      dispatchEdit(`text:${path}`, (current) => {
        const cur = current?.source;
        if (cur === undefined) return current;
        const { source } = applyFileEdit(cur, path, nextText);
        return source === cur ? current : { ...current, source };
      });
    },
    [dispatchEdit, setFileParseError],
  );

  // Re-derive the error map from a restored snapshot's text. A restored
  // state can be a mid-error typing burst's pre-state, so blindly clearing
  // the errors would re-open the gate on text that still does not parse.
  const revalidateRestored = useCallback((restored: LoadResult | null) => {
    const src = restored?.source;
    setFileParseErrors(() => {
      const next = new Map<string, string>();
      if (src === undefined) return next;
      for (const [path, text] of src.files) {
        const { error } = applyFileEdit(src, path, text);
        if (error !== null) next.set(path, error);
      }
      return next;
    });
  }, []);

  // React flushes discrete events synchronously, so consecutive Ctrl+Z
  // presses each see fresh history state through this closure.
  const performUndo = useCallback(() => {
    if (history.past.length === 0) return;
    const target = history.past[history.past.length - 1]!;
    dispatch({ type: 'undo' });
    revalidateRestored(target);
  }, [history, revalidateRestored]);

  const performRedo = useCallback(() => {
    if (history.future.length === 0) return;
    const target = history.future[0]!;
    dispatch({ type: 'redo' });
    revalidateRestored(target);
  }, [history, revalidateRestored]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;
      // Mid-IME-composition keystrokes are the IME's business.
      if (e.isComposing || e.keyCode === 229) return;
      // Inside a text field, the browser's native undo applies (source
      // textareas, number inputs); only intercept document-level undo
      // elsewhere.
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
      if (isUndo) performUndo();
      else performRedo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [performUndo, performRedo]);

  return {
    loaded,
    loadedRef,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    dispatchEdit,
    replaceDocument,
    fileParseErrors,
    setFileParseErrors,
    geometryParseError,
    manifestParseError,
    editsBlocked,
    handleEditFileText,
    performUndo,
    performRedo,
  };
}
