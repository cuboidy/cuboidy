import { describe, expect, it } from 'vitest';
import { AIR, parseLayerHeader, parseVoxelRow } from '../src/cvox/layer.js';

describe('parseLayerHeader', () => {
  it('parses layer 0', () => {
    const r = parseLayerHeader(['0']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it('parses layer 42', () => {
    const r = parseLayerHeader(['42']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('E17: rejects empty args', () => {
    const r = parseLayerHeader([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('accepts multiple args (extras are inline-row tokens, handled by caller)', () => {
    // v0.2: layer N may carry inline voxel rows after the index;
    // parseLayerHeader only validates args[0]. The assembler treats args[1..]
    // as inline rows.
    const r = parseLayerHeader(['0', '000', '000']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });

  it('E17: rejects negative index', () => {
    const r = parseLayerHeader(['-1']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E17: rejects fractional index', () => {
    const r = parseLayerHeader(['1.5']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E17: rejects non-numeric index', () => {
    const r = parseLayerHeader(['top']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});

describe('parseVoxelRow', () => {
  it('parses digit row', () => {
    const r = parseVoxelRow('012', 3, 3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([0, 1, 2]);
  });

  it('parses row with air cells', () => {
    const r = parseVoxelRow('.0.', 3, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([AIR, 0, AIR]);
  });

  it('parses lowercase letter palette indices (a=10..z=35)', () => {
    const r = parseVoxelRow('abc', 3, 13);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([10, 11, 12]);
  });

  it('parses uppercase letter palette indices (A=36..Z=61)', () => {
    const r = parseVoxelRow('AZ', 2, 62);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([36, 61]);
  });

  it('parses all-air row', () => {
    const r = parseVoxelRow('...', 3, 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([AIR, AIR, AIR]);
  });

  it('E08: rejects row shorter than W', () => {
    const r = parseVoxelRow('00', 3, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E08: rejects row longer than W', () => {
    const r = parseVoxelRow('0000', 3, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E08: rejects empty row when W > 0', () => {
    const r = parseVoxelRow('', 3, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E11: rejects palette index outside declared palette (digit)', () => {
    const r = parseVoxelRow('012', 3, 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E11: rejects lowercase index outside palette', () => {
    const r = parseVoxelRow('abc', 3, 11);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E11: rejects uppercase index outside palette', () => {
    const r = parseVoxelRow('A', 1, 36);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});
