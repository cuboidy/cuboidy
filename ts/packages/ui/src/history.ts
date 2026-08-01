// Generic undo/redo history as a pure reducer. The document and its history
// live in ONE reducer state so they update atomically and stay pure under
// React StrictMode's double-invocation (no side-effectful pushes from inside
// setState updaters).
//
// Entries are whole-document references — the editor's state is immutably
// updated everywhere, so a snapshot is a pointer copy and unchanged
// sub-objects are structurally shared across the stack.
//
// Coalescing: an `edit` carries an optional identity `tag`. Consecutive
// edits with the same tag within COALESCE_MS merge into one entry — the
// stack keeps the burst's original pre-state and `present` slides along.
// This is what keeps per-keystroke commits (number inputs, textarea typing,
// the OS color picker's continuous onChange) from flooding the stack.
// `tag: null` means "always push" (discrete operations).

export const HISTORY_CAP = 100;
export const COALESCE_MS = 800;

export interface HistoryState<T> {
  present: T;
  // Pre-state snapshots, oldest → newest.
  past: readonly T[];
  // Redo targets, most-recently-undone first.
  future: readonly T[];
  // Coalescing identity of the last pushed edit; null after undo/redo so an
  // edit never coalesces across a restore.
  lastTag: string | null;
  lastEditAt: number;
}

export type HistoryAction<T> =
  // A document edit. `apply` is the (pure) updater; returning the input
  // unchanged records nothing. `at` is captured by the dispatcher —
  // Date.now() must not run inside the reducer.
  | { type: 'edit'; tag: string | null; at: number; apply: (t: T) => T }
  // Replace `present` without touching history — for the debounced
  // reparse success, which is the AST half of an already-recorded text edit.
  | { type: 'amend'; apply: (t: T) => T }
  // New document (load / reset): history cleared.
  | { type: 'replace'; next: T }
  | { type: 'undo' }
  | { type: 'redo' };

export function makeHistory<T>(initial: T): HistoryState<T> {
  return {
    present: initial,
    past: [],
    future: [],
    lastTag: null,
    lastEditAt: 0,
  };
}

export function historyReducer<T>(
  s: HistoryState<T>,
  a: HistoryAction<T>,
): HistoryState<T> {
  switch (a.type) {
    case 'edit': {
      const next = a.apply(s.present);
      // Guard-failure updaters return their input — record nothing.
      if (next === s.present) return s;
      if (
        a.tag !== null &&
        a.tag === s.lastTag &&
        a.at - s.lastEditAt <= COALESCE_MS
      ) {
        // Coalesce into the current entry: the stack keeps the burst's
        // original pre-state; the window slides with each edit.
        return { ...s, present: next, lastEditAt: a.at };
      }
      const past =
        s.past.length >= HISTORY_CAP
          ? [...s.past.slice(s.past.length - HISTORY_CAP + 1), s.present]
          : [...s.past, s.present];
      return { present: next, past, future: [], lastTag: a.tag, lastEditAt: a.at };
    }
    case 'amend': {
      const next = a.apply(s.present);
      if (next === s.present) return s;
      return { ...s, present: next };
    }
    case 'replace':
      return makeHistory(a.next);
    case 'undo': {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1]!;
      return {
        present: prev,
        past: s.past.slice(0, -1),
        future: [s.present, ...s.future],
        lastTag: null,
        lastEditAt: 0,
      };
    }
    case 'redo': {
      if (s.future.length === 0) return s;
      const next = s.future[0]!;
      return {
        present: next,
        past: [...s.past, s.present],
        future: s.future.slice(1),
        lastTag: null,
        lastEditAt: 0,
      };
    }
  }
}
