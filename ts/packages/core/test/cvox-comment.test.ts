import { describe, expect, it } from 'vitest';
import { stripComment } from '../src/cvox/comment.js';
import { classifyLine } from '../src/cvox/classify.js';

describe('stripComment', () => {
  it('strips full-line comment', () => {
    expect(stripComment('// top of file')).toBe('');
  });

  it('strips full-line comment with leading whitespace', () => {
    expect(stripComment('    // indented comment')).toBe('    ');
  });

  it('strips trailing comment', () => {
    expect(stripComment('size 3 3 3  // cube')).toBe('size 3 3 3  ');
  });

  it('strips trailing comment with no leading space', () => {
    expect(stripComment('size 3 3 3// no space')).toBe('size 3 3 3');
  });

  it('returns unchanged when no // marker', () => {
    expect(stripComment('size 3 3 3')).toBe('size 3 3 3');
  });

  it('does NOT treat # as comment (# is a color literal prefix)', () => {
    expect(stripComment('palette #FFFFFF #000000')).toBe(
      'palette #FFFFFF #000000',
    );
  });

  it('does NOT treat single / as comment', () => {
    expect(stripComment('palette /FFFFFF')).toBe('palette /FFFFFF');
  });

  it('strips empty line', () => {
    expect(stripComment('')).toBe('');
  });

  it('strips lone // at line-start', () => {
    expect(stripComment('//')).toBe('');
  });

  it('preserves // inside what looks like a URL (CSS-like ambiguity does NOT arise — Cuboidy has no string literals)', () => {
    // Cuboidy has no quoted strings; // always means comment.
    // This test documents that behavior intentionally.
    expect(stripComment('part name //rest')).toBe('part name ');
  });

  it('handles multiple // — only first matters', () => {
    expect(stripComment('size 3 3 3  // first // second')).toBe(
      'size 3 3 3  ',
    );
  });
});

describe('classifyLine with // comments', () => {
  it('treats full-line comment as blank', () => {
    expect(classifyLine('// top of file')).toEqual({ kind: 'blank' });
  });

  it('classifies keyword line with trailing comment', () => {
    expect(classifyLine('size 3 3 3  // cube')).toEqual({
      kind: 'keyword',
      keyword: 'size',
      args: ['3', '3', '3'],
    });
  });

  it('preserves color args when trailing // comment present', () => {
    expect(classifyLine('palette #FFFFFF #000000  // whites')).toEqual({
      kind: 'keyword',
      keyword: 'palette',
      args: ['#FFFFFF', '#000000'],
    });
  });

  it('classifies voxel row with trailing comment', () => {
    expect(classifyLine('000  // row 0')).toEqual({
      kind: 'voxel-row',
      text: '000',
    });
  });
});
