import { describe, expect, it } from 'vitest';
import { stripComment } from '../src/cvox/comment.js';

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

  it('Cuboidy has no string literals, so // always means comment', () => {
    expect(stripComment('part name //rest')).toBe('part name ');
  });

  it('handles multiple // — only first matters', () => {
    expect(stripComment('size 3 3 3  // first // second')).toBe(
      'size 3 3 3  ',
    );
  });
});
