import { describe, expect, it } from 'vitest';
import { TokenCursor } from '../src/cvox/cursor.js';
import { PaletteParser } from '../src/cvox/palette.js';
import { CvoxParser } from '../src/cvox/parse.js';
import { tokenize, type Token } from '../src/cvox/tokenize.js';

function parsePalette(input: string) {
  const cursor = new TokenCursor(tokenize(input));
  const cvoxParser = new CvoxParser(new TokenCursor([]));
  const kw: Token = { text: 'palette', line: 1, col: 1 };
  return new PaletteParser(cursor, cvoxParser).parse(kw);
}

describe('PaletteParser', () => {
  describe('valid', () => {
    it('parses #RRGGBB colors', () => {
      const r = parsePalette('#8B4513 #000000');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toEqual([
          { r: 0x8b, g: 0x45, b: 0x13, a: 0xff },
          { r: 0x00, g: 0x00, b: 0x00, a: 0xff },
        ]);
      }
    });

    it('parses #RGB short form (expand to RRGGBB)', () => {
      const r = parsePalette('#F00');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toEqual([{ r: 0xff, g: 0x00, b: 0x00, a: 0xff }]);
      }
    });

    it('parses #RGBA short form', () => {
      const r = parsePalette('#F008');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toEqual([{ r: 0xff, g: 0x00, b: 0x00, a: 0x88 }]);
      }
    });

    it('parses #RRGGBBAA full alpha form', () => {
      const r = parsePalette('#FF00FF80');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toEqual([{ r: 0xff, g: 0x00, b: 0xff, a: 0x80 }]);
      }
    });

    it('accepts mixed-case hex', () => {
      const r = parsePalette('#aBc #DeF123');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toHaveLength(2);
      }
    });

    it('accepts exactly 62 colors (max)', () => {
      const args = Array.from({ length: 62 }, () => '#000000').join(' ');
      const r = parsePalette(args);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toHaveLength(62);
      }
    });

    it('stops at the next reserved token (leaves it for caller)', () => {
      const cursor = new TokenCursor(tokenize('#000 part'));
      const cvoxParser = new CvoxParser(new TokenCursor([]));
      const kw: Token = { text: 'palette', line: 1, col: 1 };
      const r = new PaletteParser(cursor, cvoxParser).parse(kw);
      expect(r.ok).toBe(true);
      expect(cursor.peek()?.text).toBe('part');
    });
  });

  describe('errors', () => {
    it('E17: rejects empty palette (EOF)', () => {
      const r = parsePalette('');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('wrong-arity');
    });

    it('E17: rejects empty palette (immediate reserved)', () => {
      const r = parsePalette('part');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('wrong-arity');
    });

    it('a bare token without # prefix is not color-like, so palette stops empty', () => {
      // Boundary is "# prefix"; '8B4513' doesn't qualify, palette consumes
      // 0 colors → wrong-arity. The bare token is left for the caller.
      const r = parsePalette('8B4513');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('wrong-arity');
    });

    it('E02: rejects color with wrong hex length', () => {
      const r = parsePalette('#FF');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-value');
    });

    it('E02: rejects color with non-hex chars', () => {
      const r = parsePalette('#GGGGGG');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-value');
    });

    it('E02: error references the offending color token line', () => {
      const r = parsePalette('#000\n#GG');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('line 2');
    });

    it('E16: rejects palette of 63 colors (overflow)', () => {
      const args = Array.from({ length: 63 }, () => '#000000').join(' ');
      const r = parsePalette(args);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('wrong-arity');
        expect(r.message).toMatch(/62/);
      }
    });

    it('rejects a duplicate palette declaration (parent CvoxParser state)', () => {
      const cursor = new TokenCursor(tokenize('#FFF'));
      const cvoxParser = new CvoxParser(new TokenCursor([]));
      cvoxParser.setPalette([], 5);
      const kw: Token = { text: 'palette', line: 10, col: 1 };
      const r = new PaletteParser(cursor, cvoxParser).parse(kw);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('duplicate');
        expect(r.message).toContain('line 10');
        expect(r.message).toContain('first at line 5');
      }
    });
  });
});
