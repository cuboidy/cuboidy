import { describe, expect, it } from 'vitest';
import { parsePartHeader, parseSize } from '../src/cvox/part.js';

describe('parsePartHeader', () => {
  it('parses single identifier', () => {
    const r = parsePartHeader(['head']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('head');
  });

  it('accepts kebab-case identifier', () => {
    const r = parsePartHeader(['leg-fl']);
    expect(r.ok).toBe(true);
  });

  it('accepts snake_case identifier', () => {
    const r = parsePartHeader(['my_part']);
    expect(r.ok).toBe(true);
  });

  it('accepts underscore prefix', () => {
    const r = parsePartHeader(['_hidden']);
    expect(r.ok).toBe(true);
  });

  it('E03: rejects empty args (no identifier)', () => {
    const r = parsePartHeader([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E03: rejects multiple args', () => {
    const r = parsePartHeader(['head', 'extra']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E03: rejects identifier with leading digit', () => {
    const r = parsePartHeader(['1bad']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E03: rejects identifier with leading hyphen', () => {
    const r = parsePartHeader(['-bad']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E03: rejects identifier with special chars', () => {
    const r = parsePartHeader(['bad.name']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E03: rejects non-ASCII identifier', () => {
    const r = parsePartHeader(['頭']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});

describe('parseSize', () => {
  it('parses W H D', () => {
    const r = parseSize(['3', '4', '5']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ w: 3, h: 4, d: 5 });
  });

  it('rejects zero dimensions (v0.2: min 1)', () => {
    const r = parseSize(['0', '1', '1']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects dimensions exceeding 1024 (v0.2 max)', () => {
    const r = parseSize(['1025', '1', '1']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('accepts max dimension 1024', () => {
    const r = parseSize(['1024', '1', '1']);
    expect(r.ok).toBe(true);
  });

  it('rejects too few args', () => {
    const r = parseSize(['3', '3']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('rejects too many args', () => {
    const r = parseSize(['3', '3', '3', '3']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('E17: rejects negative dimensions', () => {
    const r = parseSize(['-1', '3', '3']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E17: rejects fractional dimensions', () => {
    const r = parseSize(['3.5', '3', '3']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('E17: rejects non-numeric dimensions', () => {
    const r = parseSize(['abc', '3', '3']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});
