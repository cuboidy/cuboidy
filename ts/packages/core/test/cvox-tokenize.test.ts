import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/cvox/tokenize.js';

describe('tokenize', () => {
  it('splits whitespace-separated bare tokens', () => {
    const r = tokenize('palette #FFF part head');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.map((t) => t.text)).toEqual([
        'palette',
        '#FFF',
        'part',
        'head',
      ]);
      expect(r.value.every((t) => t.kind === 'bare')).toBe(true);
    }
  });

  it('emits punct tokens (`{`, `}`, `,`) as 1-char bare tokens without surrounding whitespace', () => {
    const r = tokenize('voxels{0,0}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.map((t) => t.text)).toEqual([
        'voxels',
        '{',
        '0',
        ',',
        '0',
        '}',
      ]);
    }
  });

  it('emits a string-kind token for "..." with content excluding the quotes', () => {
    const r = tokenize('"head"');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(1);
      expect(r.value[0]).toMatchObject({ text: 'head', kind: 'string' });
    }
  });

  it('preserves whitespace inside a quoted string', () => {
    const r = tokenize('"long bone"');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(1);
      expect(r.value[0]?.text).toBe('long bone');
    }
  });

  it('records 1-based line and column for each token', () => {
    const r = tokenize('palette\n  #FFF');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]).toMatchObject({ line: 1, col: 1, text: 'palette' });
      expect(r.value[1]).toMatchObject({ line: 2, col: 3, text: '#FFF' });
    }
  });

  it('strips `// …` comments before tokenizing', () => {
    const r = tokenize('palette #FFF // a gold model\npart head');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.map((t) => t.text)).toEqual([
        'palette',
        '#FFF',
        'part',
        'head',
      ]);
    }
  });

  describe('errors', () => {
    it('rejects an unmatched opening quote (lexical error)', () => {
      // Prevents the historical infinite-loop bug: a fall-through bare
      // token starting with `"` would be re-broken on the same `"` by the
      // bare-loop's stop set, producing an empty token forever. The
      // tokenizer now returns invalid-value at the offending position.
      const r = tokenize('"hat');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('invalid-value');
        expect(r.message).toContain('unterminated string');
        expect(r.message).toContain('line 1');
        expect(r.message).toContain('col 1');
      }
    });

    it('rejects an unmatched quote on a later line with the right line number', () => {
      const r = tokenize('palette #FFF\npart "head\nsize 1 1 1');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('invalid-value');
        expect(r.message).toContain('line 2');
      }
    });
  });
});
