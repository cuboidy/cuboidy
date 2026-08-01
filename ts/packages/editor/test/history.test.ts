import { describe, expect, it } from 'vitest';
import {
  COALESCE_MS,
  HISTORY_CAP,
  historyReducer,
  makeHistory,
} from '@cuboidy/ui';
import type { HistoryState } from '@cuboidy/ui';

// The undo/redo reducer backs every editing operation in App.tsx, so its
// contract — what records an entry, what coalesces, what clears the redo
// stack — is the thing most likely to regress silently when the editing
// pipeline is restructured.

const inc = (n: number) => n + 1;
const same = (n: number) => n;

const edit = (
  s: HistoryState<number>,
  tag: string | null,
  at: number,
  apply: (n: number) => number = inc,
) => historyReducer(s, { type: 'edit', tag, at, apply });

describe('historyReducer — recording', () => {
  it('pushes the pre-state and advances present', () => {
    const s = edit(makeHistory(0), null, 0);
    expect(s.present).toBe(1);
    expect(s.past).toEqual([0]);
    expect(s.future).toEqual([]);
  });

  it('records nothing when the updater returns its input', () => {
    // Guard-failure appliers return `current` unchanged — a dead Ctrl+Z
    // step would be worse than no entry at all.
    const before = edit(makeHistory(0), null, 0);
    const after = historyReducer(before, {
      type: 'edit',
      tag: null,
      at: 10,
      apply: same,
    });
    expect(after).toBe(before);
  });

  it('clears the redo stack', () => {
    let s = edit(makeHistory(0), null, 0);
    s = historyReducer(s, { type: 'undo' });
    expect(s.future).toEqual([1]);
    s = edit(s, null, 10);
    expect(s.future).toEqual([]);
  });

  it('caps the stack at HISTORY_CAP, dropping the oldest', () => {
    let s = makeHistory(0);
    for (let i = 0; i < HISTORY_CAP + 50; i++) s = edit(s, null, i * 10_000);
    expect(s.past).toHaveLength(HISTORY_CAP);
    expect(s.present).toBe(HISTORY_CAP + 50);
    // Oldest surviving pre-state, not the original 0.
    expect(s.past[0]).toBe(50);
  });
});

describe('historyReducer — coalescing', () => {
  it('merges same-tag edits inside the window into one entry', () => {
    let s = edit(makeHistory(0), 'text:geometry', 0);
    s = edit(s, 'text:geometry', 100);
    s = edit(s, 'text:geometry', 200);
    expect(s.present).toBe(3);
    // One entry, holding the state from BEFORE the burst.
    expect(s.past).toEqual([0]);
  });

  it('slides the window with each keystroke rather than fixing it', () => {
    let s = edit(makeHistory(0), 'text:geometry', 0);
    s = edit(s, 'text:geometry', COALESCE_MS);
    s = edit(s, 'text:geometry', COALESCE_MS * 2);
    expect(s.past).toEqual([0]);
  });

  it('starts a new entry once the window lapses', () => {
    let s = edit(makeHistory(0), 'text:geometry', 0);
    s = edit(s, 'text:geometry', COALESCE_MS + 1);
    expect(s.past).toEqual([0, 1]);
  });

  it('never coalesces a null tag (discrete operations)', () => {
    let s = edit(makeHistory(0), null, 0);
    s = edit(s, null, 10);
    expect(s.past).toEqual([0, 1]);
  });

  it('never coalesces across different tags', () => {
    let s = edit(makeHistory(0), 'part:pos:head:0', 0);
    s = edit(s, 'part:pos:head:1', 10);
    expect(s.past).toEqual([0, 1]);
  });
});

describe('historyReducer — amend', () => {
  it('replaces present without touching either stack', () => {
    const before = edit(makeHistory(0), 'text:geometry', 0);
    const after = historyReducer(before, { type: 'amend', apply: inc });
    expect(after.present).toBe(2);
    expect(after.past).toEqual(before.past);
    expect(after.future).toEqual(before.future);
  });

  it('is a no-op when the updater returns its input', () => {
    const before = edit(makeHistory(0), null, 0);
    expect(historyReducer(before, { type: 'amend', apply: same })).toBe(before);
  });

  it('leaves the coalescing window intact', () => {
    // An amend is the AST half of an already-recorded text edit; it must
    // not break the typing burst it belongs to.
    let s = edit(makeHistory(0), 'text:geometry', 0);
    s = historyReducer(s, { type: 'amend', apply: inc });
    s = edit(s, 'text:geometry', 100);
    expect(s.past).toEqual([0]);
  });
});

describe('historyReducer — undo / redo', () => {
  it('round-trips through undo and redo', () => {
    let s = edit(makeHistory(0), null, 0);
    s = edit(s, null, 10_000);
    expect(s.present).toBe(2);
    s = historyReducer(s, { type: 'undo' });
    expect(s.present).toBe(1);
    s = historyReducer(s, { type: 'undo' });
    expect(s.present).toBe(0);
    s = historyReducer(s, { type: 'redo' });
    expect(s.present).toBe(1);
    s = historyReducer(s, { type: 'redo' });
    expect(s.present).toBe(2);
    expect(s.future).toEqual([]);
  });

  it('is a no-op at either end', () => {
    const empty = makeHistory(0);
    expect(historyReducer(empty, { type: 'undo' })).toBe(empty);
    expect(historyReducer(empty, { type: 'redo' })).toBe(empty);
  });

  it('does not let an edit coalesce across a restore', () => {
    // Otherwise the entry the user just undid would be silently merged
    // back into by the next keystroke of the same burst.
    let s = edit(makeHistory(0), 'text:geometry', 0);
    s = edit(s, 'text:geometry', 100);
    s = historyReducer(s, { type: 'undo' });
    expect(s.lastTag).toBeNull();
    s = edit(s, 'text:geometry', 200);
    expect(s.past).toEqual([0]);
    expect(s.present).toBe(1);
  });
});

describe('historyReducer — replace', () => {
  it('clears both stacks (a load is not undoable)', () => {
    let s = edit(makeHistory(0), 'text:geometry', 0);
    s = edit(s, null, 10_000);
    s = historyReducer(s, { type: 'replace', next: 99 });
    expect(s).toEqual(makeHistory(99));
  });
});
