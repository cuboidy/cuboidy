import { describe, expect, it } from 'vitest';
import {
  addAttrAtTime,
  deleteAttrAtKey,
  formatTimeKey,
  nearestExistingKey,
  setAttrAtKey,
  sortTrackKeys,
} from '../src/animation-edit.js';
import { samplePart, type AnimationTrack } from '../src/animation.js';

describe('formatTimeKey', () => {
  it('formats integers with a trailing .0', () => {
    expect(formatTimeKey(0)).toBe('0.0');
    expect(formatTimeKey(1)).toBe('1.0');
    expect(formatTimeKey(2)).toBe('2.0');
  });

  it('keeps fractional values', () => {
    expect(formatTimeKey(0.5)).toBe('0.5');
    expect(formatTimeKey(1.25)).toBe('1.25');
  });

  it('snaps float noise to the 1e-3 grid', () => {
    expect(formatTimeKey(0.30000000000000004)).toBe('0.3');
    expect(formatTimeKey(0.1 + 0.2)).toBe('0.3');
  });

  it('round-trips through Number on the grid', () => {
    for (const t of [0, 0.25, 0.4997, 1.333, 2]) {
      expect(Number(formatTimeKey(t))).toBeCloseTo(Math.round(t * 1000) / 1000, 9);
    }
  });
});

describe('nearestExistingKey', () => {
  const track: AnimationTrack = { '0.0': { rot: [0, 0, 0] }, '0.5': { rot: [0, 1, 0] } };
  it('finds a key within half-grid tolerance', () => {
    expect(nearestExistingKey(track, 0.4997)).toBe('0.5');
    expect(nearestExistingKey(track, 0.0003)).toBe('0.0');
  });
  it('returns null when nothing is close', () => {
    expect(nearestExistingKey(track, 0.6)).toBeNull();
  });
});

describe('sortTrackKeys', () => {
  it('reinserts keys in ascending numeric order', () => {
    const track: AnimationTrack = { '1.0': {}, '0.0': {}, '0.5': {} };
    expect(Object.keys(sortTrackKeys(track))).toEqual(['0.0', '0.5', '1.0']);
  });
  it('is idempotent', () => {
    const track: AnimationTrack = { '0.0': {}, '0.5': {} };
    expect(Object.keys(sortTrackKeys(sortTrackKeys(track)))).toEqual(['0.0', '0.5']);
  });
});

describe('setAttrAtKey', () => {
  it('overwrites one field immutably, leaving others intact', () => {
    const track: AnimationTrack = { '0.5': { rot: [0, 0, 0], pos: [1, 0, 0] } };
    const next = setAttrAtKey(track, '0.5', 'rot', [0, 90, 0]);
    expect(next['0.5']).toEqual({ rot: [0, 90, 0], pos: [1, 0, 0] });
    // input untouched
    expect(track['0.5']).toEqual({ rot: [0, 0, 0], pos: [1, 0, 0] });
  });
});

describe('addAttrAtTime', () => {
  it('seeds a 0.0 key when adding the first key to an empty track', () => {
    const { track, timeKey } = addAttrAtTime({}, 0.5, 'rot', [0, 25, 0]);
    expect(timeKey).toBe('0.5');
    expect(Object.keys(track)).toEqual(['0.0', '0.5']);
    expect(track['0.0']).toEqual({ rot: [0, 0, 0] }); // rest seed
    expect(track['0.5']).toEqual({ rot: [0, 25, 0] });
  });

  it('merges into a coincident existing key instead of minting a near-duplicate', () => {
    const track: AnimationTrack = { '0.0': { rot: [0, 0, 0] }, '0.5': { rot: [0, 10, 0] } };
    const { track: next, timeKey } = addAttrAtTime(track, 0.4998, 'pos', [0, 1, 0]);
    expect(timeKey).toBe('0.5');
    expect(next['0.5']).toEqual({ rot: [0, 10, 0], pos: [0, 1, 0] });
    expect(Object.keys(next)).toEqual(['0.0', '0.5']); // no 0.4998 key
  });

  it('only sets the targeted attribute', () => {
    const { track } = addAttrAtTime({}, 1.0, 'pos', [0, 2, 0]);
    expect(track['1.0']).toEqual({ pos: [0, 2, 0] });
    expect('rot' in track['1.0']!).toBe(false);
  });
});

describe('deleteAttrAtKey', () => {
  it('removes one field but keeps the entry when others survive', () => {
    const track: AnimationTrack = { '0.0': { rot: [0, 0, 0] }, '0.5': { rot: [0, 9, 0], pos: [1, 0, 0] } };
    const next = deleteAttrAtKey(track, '0.5', 'rot');
    expect(next['0.5']).toEqual({ pos: [1, 0, 0] });
  });

  it('drops a now-empty entry (never serializes "x": {})', () => {
    const track: AnimationTrack = { '0.0': { rot: [0, 0, 0] }, '0.5': { rot: [0, 9, 0] } };
    const next = deleteAttrAtKey(track, '0.5', 'rot');
    expect('0.5' in next).toBe(false);
  });

  it('re-seeds 0.0 when deleting it leaves surviving keys for that attr', () => {
    const track: AnimationTrack = { '0.0': { rot: [0, 0, 0] }, '0.5': { rot: [0, 30, 0] } };
    const next = deleteAttrAtKey(track, '0.0', 'rot');
    // 0.0 came back at rest so the part keeps a start key and doesn't snap.
    expect(next['0.0']).toEqual({ rot: [0, 0, 0] });
    expect(next['0.5']).toEqual({ rot: [0, 30, 0] });
  });

  it('does not re-seed 0.0 when the attribute is fully removed', () => {
    const track: AnimationTrack = { '0.0': { rot: [0, 0, 0] } };
    const next = deleteAttrAtKey(track, '0.0', 'rot');
    expect(Object.keys(next)).toEqual([]);
  });
});

describe('integration with the sampler', () => {
  it('an added key reads back through samplePart at that time', () => {
    const { track, timeKey } = addAttrAtTime({}, 0.5, 'rot', [0, 40, 0]);
    const pose = samplePart(track, Number(timeKey), 1.0, false);
    expect(pose.rot).toEqual([0, 40, 0]);
  });
});
