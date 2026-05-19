import { describe, expect, it } from 'vitest';
import { TokenCursor } from '../src/cvox/cursor.js';
import { CvoxParser, parseCvox } from '../src/cvox/parse.js';
import { PartParser } from '../src/cvox/part.js';
import { SocketParser } from '../src/cvox/socket.js';
import { tokenize, type Token } from '../src/cvox/tokenize.js';

function parseSocket(input: string) {
  const cursor = new TokenCursor(tokenize(input));
  const cvoxParser = new CvoxParser(new TokenCursor([]));
  const partParser = new PartParser(cursor, cvoxParser);
  const kw: Token = { text: 'socket', line: 1, col: 1 };
  return new SocketParser(cursor, partParser).parse(kw);
}

describe('SocketParser', () => {
  it('parses socket without rotation', () => {
    const r = parseSocket('hat 1 3 1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('hat');
      expect(r.value.pos).toEqual({ x: 1, y: 3, z: 1 });
      expect(r.value.rot).toBeUndefined();
    }
  });

  it('parses socket with rotation', () => {
    const r = parseSocket('mouth 1 1 3 rot 0 90 0');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('mouth');
      expect(r.value.pos).toEqual({ x: 1, y: 1, z: 3 });
      expect(r.value.rot).toEqual({ x: 0, y: 90, z: 0 });
    }
  });

  it('accepts kebab-case socket name', () => {
    const r = parseSocket('ear-l 0.5 2 0.5');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe('ear-l');
  });

  it('accepts fractional coords', () => {
    const r = parseSocket('anchor 1.5 2.25 0.5');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pos).toEqual({ x: 1.5, y: 2.25, z: 0.5 });
  });

  it('E06: rejects missing name (EOF)', () => {
    const r = parseSocket('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E06: rejects bare reserved word in name slot', () => {
    const r = parseSocket('part');
    expect(r.ok).toBe(false);
    // 'part' is a reserved keyword — isIdentifier rejects it, so the slot
    // surfaces "invalid identifier", not a parse-arity error.
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E06: rejects quoted name (cvox names are bare)', () => {
    const r = parseSocket('"hat" 1 3 1');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-value');
      expect(r.message).toContain('quoted string');
    }
  });

  it('E06: rejects too few pos args (EOF)', () => {
    const r = parseSocket('hat 1 3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E06: rejects rot with no triple', () => {
    const r = parseSocket('hat 1 3 1 rot');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E06: rejects rot with too few triple args', () => {
    const r = parseSocket('hat 1 3 1 rot 0 90');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E06: rejects invalid socket name (content fails identifier rule)', () => {
    const r = parseSocket('1bad 1 3 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E06: rejects non-numeric pos coord', () => {
    const r = parseSocket('hat abc 3 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it("returns pos-only when next token is not 'rot' (leaves it for caller)", () => {
    const cursor = new TokenCursor(tokenize('hat 1 3 1 size 1 1 1'));
    const cvoxParser = new CvoxParser(new TokenCursor([]));
    const partParser = new PartParser(cursor, cvoxParser);
    const kw: Token = { text: 'socket', line: 1, col: 1 };
    const r = new SocketParser(cursor, partParser).parse(kw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rot).toBeUndefined();
    expect(cursor.peek()?.text).toBe('size');
  });
});

// SocketParser's early-dup detection registers via PartParser, which only
// adds names from within its own parse() loop. Exercising the dup path
// requires a full part body.
describe('SocketParser duplicate detection (via parseCvox)', () => {
  it('rejects a second socket with the same name in the same part', () => {
    const r = parseCvox(
      'palette #fff\npart head\nsize 1 1 1\nsocket hat 0 0 0\nsocket hat 1 0 0\nvoxels { . }',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('duplicate');
      expect(r.message).toContain('hat');
    }
  });

  it('allows the same socket name in different parts', () => {
    const r = parseCvox(
      'palette #fff\npart head\nsize 1 1 1\nsocket hat 0 0 0\nvoxels { . }\npart body\nsize 1 1 1\nsocket hat 0 0 0\nvoxels { . }',
    );
    expect(r.ok).toBe(true);
  });
});
