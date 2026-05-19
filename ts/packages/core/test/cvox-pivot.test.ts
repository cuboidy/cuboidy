import { describe, expect, it } from 'vitest';
import { TokenCursor } from '../src/cvox/cursor.js';
import { PivotParser } from '../src/cvox/pivot.js';
import { tokenize, type Token } from '../src/cvox/tokenize.js';

function lex(input: string): Token[] {
  const r = tokenize(input);
  if (!r.ok) throw new Error(`tokenize failed: ${r.message}`);
  return r.value;
}

function parsePivot(input: string) {
  const cursor = new TokenCursor(lex(input));
  const kw: Token = { text: 'pivot', line: 1, col: 1 };
  return new PivotParser(cursor).parse(kw);
}

describe('PivotParser', () => {
  it('parses integer coords (pos only)', () => {
    const r = parsePivot('1 0 1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pos).toEqual({ x: 1, y: 0, z: 1 });
      expect(r.value.rot).toBeUndefined();
    }
  });

  it('parses fractional coords (pos only)', () => {
    const r = parsePivot('1.5 0 1.5');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pos).toEqual({ x: 1.5, y: 0, z: 1.5 });
  });

  it('accepts negative coords (warning is a lint concern, not parse error)', () => {
    const r = parsePivot('-1 0 1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pos).toEqual({ x: -1, y: 0, z: 1 });
  });

  it('parses pivot with rotation', () => {
    const r = parsePivot('1 0 1 rot 0 90 0');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.pos).toEqual({ x: 1, y: 0, z: 1 });
      expect(r.value.rot).toEqual({ x: 0, y: 90, z: 0 });
    }
  });

  it('E05: rejects rot with no triple (EOF)', () => {
    const r = parsePivot('1 0 1 rot');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E05: rejects rot with too few triple args (EOF)', () => {
    const r = parsePivot('1 0 1 rot 0 90');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E05: rejects too few pos args (EOF)', () => {
    const r = parsePivot('1 0');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E05: rejects bare reserved word in pos slot', () => {
    const r = parsePivot('1 0 part');
    expect(r.ok).toBe(false);
    // Bare reserved tokens are not number-shaped; expectVec3 reports the
    // type mismatch rather than treating it as "too few args".
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E05: rejects non-numeric pos coord', () => {
    const r = parsePivot('abc 0 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E05: rejects non-numeric rot coord', () => {
    const r = parsePivot('1 0 1 rot abc 90 0');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it("returns pos-only when next token is not 'rot' (leaves it for caller)", () => {
    const cursor = new TokenCursor(lex('1 0 1 socket hat 1 1 1'));
    const kw: Token = { text: 'pivot', line: 1, col: 1 };
    const r = new PivotParser(cursor).parse(kw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rot).toBeUndefined();
    expect(cursor.peek()?.text).toBe('socket');
  });
});
