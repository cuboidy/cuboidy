import { describe, expect, it } from 'vitest';
import { parsePaletteFile, parsePaletteFileText } from '../src/palette-file.js';
import { parseHexColor, serializeColor } from '../src/geometry/palette.js';
import { rgba } from './helpers/palette.js';

// SPEC §6.10 (v0.7): external palette file — same color grammar and
// 64-color cap as the inline geometry palette, wrapped in { "colors": [...] }.
describe('parsePaletteFile', () => {
  it('parses long and short hex forms with and without alpha', () => {
    const r = parsePaletteFile({
      colors: ['#1a2b3c', '#F00', '#12345678', '#0f08'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(4);
    expect(r.value[0]).toEqual(rgba(0x1a, 0x2b, 0x3c, 0xff));
    expect(r.value[1]).toEqual(rgba(0xff, 0, 0, 0xff));
    expect(r.value[2]).toEqual(rgba(0x12, 0x34, 0x56, 0x78));
    expect(r.value[3]).toEqual(rgba(0, 0xff, 0, 0x88));
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

  it('rejects more than 64 colors as wrong-arity', () => {
    const colors = Array.from({ length: 65 }, () => '#abc');
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
      expect(r.path).toEqual(['colors', 1]);
    }
  });

  // §7.4 material. The entry grammar is shared with an inline palette, so a
  // palette FILE can say everything a geometry file's own palette can.
  it('reads the object form and its material', () => {
    const r = parsePaletteFile({
      colors: ['#fff', { color: '#C0C4CC', metallic: 1, roughness: 0.25 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]).toEqual(rgba(0xff, 0xff, 0xff));
      expect(r.value[1]).toEqual(
        rgba(0xc0, 0xc4, 0xcc, 255, { metallic: 1, roughness: 0.25 }),
      );
    }
  });

  it('rejects a material value outside 0..1 as invalid-value', () => {
    const r = parsePaletteFile({ colors: [{ color: '#fff', metallic: 2 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Not `wrong-arity`: a bound on a number counts nothing.
      expect(r.code).toBe('invalid-value');
      expect(r.path).toEqual(['colors', 0, 'metallic']);
    }
  });

  it('rejects an unknown material key as unknown', () => {
    const r = parsePaletteFile({ colors: [{ color: '#fff', shiny: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown');
  });

  it('rejects an entry object with no color as missing', () => {
    const r = parsePaletteFile({ colors: [{ metallic: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing');
  });

  it('rejects a non-object root as invalid-value', () => {
    const r = parsePaletteFile(['#fff']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});

// SPEC §7.4: alpha round-trips. The editor's palette panel now has a
// control for it, so a translucent entry has to survive being written back
// out and read in again.
describe('palette alpha round-trip (§7.4)', () => {
  it('writes the short form for an opaque color and the long one otherwise', () => {
    expect(serializeColor(rgba(0x3a, 0xa0, 0xff, 255).color)).toBe('#3AA0FF');
    expect(serializeColor(rgba(0x3a, 0xa0, 0xff, 0x55).color)).toBe('#3AA0FF55');
    expect(serializeColor(rgba(0, 0, 0, 0).color)).toBe('#00000000');
  });

  it('survives parse → serialize → parse for every alpha', () => {
    for (const a of [0, 1, 0x55, 0x80, 0xfe, 255]) {
      const c = { r: 0x12, g: 0x34, b: 0x56, a };
      const back = parseHexColor(serializeColor(c));
      expect(back, `alpha ${a}`).toEqual(c);
    }
  });

  it('reads a translucent palette file back with its alpha', () => {
    const r = parsePaletteFile({ colors: ['#8AF8', '#1A1A1AFF', '#CCC'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((e) => e.color.a)).toEqual([0x88, 255, 255]);
  });
});

// Five call sites had each wrapped `parsePaletteFile` in their own
// `JSON.parse` + try/catch, and every one of them collapsed a malformed
// document to a bare `null` — indistinguishable at the call site from "no
// such file", so none could report what was actually wrong.
describe('parsePaletteFileText', () => {
  it('reads a well-formed file', () => {
    const r = parsePaletteFileText('{"colors":["#FF0000"]}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([rgba(0xff, 0, 0)]);
  });

  it('reports malformed JSON as invalid-value, with the reason', () => {
    const r = parsePaletteFileText('{ not json');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-value');
      expect(r.message).toMatch(/^JSON parse:/);
    }
  });

  it('passes a schema failure straight through', () => {
    const r = parsePaletteFileText('{"colors":[]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('carries a §7.4 material through', () => {
    const r = parsePaletteFileText(
      '{"colors":[{"color":"#C0C4CC","metallic":1}]}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]).toEqual(rgba(0xc0, 0xc4, 0xcc, 255, { metallic: 1 }));
    }
  });
});
