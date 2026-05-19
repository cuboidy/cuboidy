import { describe, expect, it } from 'vitest';
import { TokenCursor } from '../src/cvox/cursor.js';
import { parseCvox } from '../src/cvox/parse.js';
import { SizeParser } from '../src/cvox/size.js';
import { tokenize, type Token } from '../src/cvox/tokenize.js';

function lex(input: string): Token[] {
  const r = tokenize(input);
  if (!r.ok) throw new Error(`tokenize failed: ${r.message}`);
  return r.value;
}

function parseSize(input: string) {
  const cursor = new TokenCursor(lex(input));
  const kw: Token = { text: 'size', line: 1, col: 1 };
  return new SizeParser(cursor).parse(kw);
}

describe('SizeParser', () => {
  it('parses W H D', () => {
    const r = parseSize('3 4 5');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ w: 3, h: 4, d: 5 });
  });

  it('rejects zero dimensions (v0.2: min 1)', () => {
    const r = parseSize('0 1 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects dimensions exceeding 1024 (v0.2 max)', () => {
    const r = parseSize('1025 1 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('accepts max dimension 1024', () => {
    const r = parseSize('1024 1 1');
    expect(r.ok).toBe(true);
  });

  it('rejects too few args (EOF)', () => {
    const r = parseSize('3 3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('rejects bare reserved word in number slot', () => {
    const r = parseSize('3 3 part');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Reserved tokens are not number-shaped, so parseNonNegInt rejects
      // them like any other non-numeric text — no need for a separate
      // "reserved" check in the size parser.
      expect(r.code).toBe('invalid-value');
      expect(r.message).toContain("'part'");
    }
  });

  it('E17: rejects negative dimensions', () => {
    const r = parseSize('-1 3 3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E17: rejects fractional dimensions', () => {
    const r = parseSize('3.5 3 3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E17: rejects non-numeric dimensions', () => {
    const r = parseSize('abc 3 3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('error message includes the offending token line (not the kw line)', () => {
    const r = parseSize('3\nabc 5');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('line 2');
  });

  it('leaves later tokens for the caller (stops after 3rd value)', () => {
    const cursor = new TokenCursor(lex('3 4 5 part'));
    const kw: Token = { text: 'size', line: 1, col: 1 };
    const r = new SizeParser(cursor).parse(kw);
    expect(r.ok).toBe(true);
    expect(cursor.peek()?.text).toBe('part');
  });
});

// PartParser header validation runs as part of the full parse and is
// exercised through parseCvox. The identifier rule itself is tested in
// identifier.test.ts; here we verify the wiring (header pulls the name,
// applies the rule, surfaces the right error code).
describe('PartParser header validation (via parseCvox)', () => {
  it('accepts a bare identifier name', () => {
    const r = parseCvox('palette #fff\npart head\nsize 1 1 1\nvoxels { . }');
    expect(r.ok).toBe(true);
  });

  it('rejects an invalid identifier (leading digit)', () => {
    const r = parseCvox('palette #fff\npart 1bad\nsize 1 1 1\nvoxels { . }');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-value');
      expect(r.message).toContain('1bad');
    }
  });

  it('rejects quoted identifier (cvox names are bare)', () => {
    const r = parseCvox('palette #fff\npart "head"\nsize 1 1 1\nvoxels { . }');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-value');
      expect(r.message).toContain('quoted string');
      expect(r.message).toContain('head');
    }
  });

  it('rejects bare reserved word in name slot', () => {
    const r = parseCvox('palette #fff\npart size 1 1 1');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Bare `size` is a reserved keyword — isIdentifier rejects it.
      expect(r.code).toBe('invalid-value');
      expect(r.message).toContain('invalid identifier');
      expect(r.message).toContain('size');
    }
  });

  it('rejects missing identifier at EOF', () => {
    const r = parseCvox('palette #fff\npart');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });
});
