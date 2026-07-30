import { describe, expect, it } from 'vitest';
import { parsePaletteFile } from '../src/palette-file.js';

// SPEC §6.10 (v0.7): external palette file — same color grammar and
// 62-color cap as the inline geometry palette, wrapped in { "colors": [...] }.
describe('parsePaletteFile', () => {
  it('parses long and short hex forms with and without alpha', () => {
    const r = parsePaletteFile({
      colors: ['#1a2b3c', '#F00', '#12345678', '#0f08'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(4);
    expect(r.value[0]).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c, a: 0xff });
    expect(r.value[1]).toEqual({ r: 0xff, g: 0, b: 0, a: 0xff });
    expect(r.value[2]).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 0x78 });
    expect(r.value[3]).toEqual({ r: 0, g: 0xff, b: 0, a: 0x88 });
  });

  it('rejects a missing colors field as missing', () => {
    const r = parsePaletteFile({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing');
  });

  it('rejects an unknown field as unknown (strict object)', () => {
    const r = parsePaletteFile({ colors: ['#fff'], extra: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown');
  });

  it('rejects an empty colors array as wrong-arity', () => {
    const r = parsePaletteFile({ colors: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('rejects more than 62 colors as wrong-arity', () => {
    const colors = Array.from({ length: 63 }, () => '#abc');
    const r = parsePaletteFile({ colors });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('rejects a malformed color with its index in the message', () => {
    const r = parsePaletteFile({ colors: ['#fff', '#GGHHII'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-value');
      expect(r.message).toContain('colors.1');
      expect(r.message).toContain('#GGHHII');
    }
  });

  it('rejects a non-object root as invalid-value', () => {
    const r = parsePaletteFile(['#fff']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});
