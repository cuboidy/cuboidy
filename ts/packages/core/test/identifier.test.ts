import { describe, expect, it } from 'vitest';
import { isIdentifier, IDENTIFIER_RE } from '../src/identifier.js';
import { RESERVED_KEYWORDS } from '../src/cvox/reserved.js';
import { ManifestPartSchema } from '../src/manifest.js';

// SPEC §5: identifier rule shared by cvox identifier slots (part/socket
// names) and the manifest Zod schema (cuboidy.json names). Two conjuncts:
// regex shape + not a reserved cvox keyword. Tested here so a single rule
// change can be checked in one place.

describe('isIdentifier', () => {
  describe('regex shape', () => {
    it.each([
      ['head', true],
      ['leg-fl', true],
      ['ear-l', true],
      ['_hidden', true],
      ['a', true],
      ['a1', true],
      ['Mixed_Case-1', true],
      ['', false],
      ['1bad', false],     // leading digit
      ['-bad', false],     // leading hyphen
      ['has space', false],
      ['has.dot', false],
      ['has/slash', false],
      ['日本語', false],    // unicode rejected per §5 (ASCII only)
    ])('isIdentifier(%j) === %s', (input, expected) => {
      expect(isIdentifier(input)).toBe(expected);
    });
  });

  describe('reserved-keyword rejection', () => {
    it.each(RESERVED_KEYWORDS)(
      'rejects reserved keyword %s even though it satisfies the regex',
      (keyword) => {
        // Sanity-check: each reserved keyword would pass the regex alone —
        // proving the reserved-set check is what actually excludes it.
        expect(IDENTIFIER_RE.test(keyword)).toBe(true);
        expect(isIdentifier(keyword)).toBe(false);
      },
    );

    it('does not reject names that merely contain a reserved word as a substring', () => {
      expect(isIdentifier('parts')).toBe(true);
      expect(isIdentifier('subpart')).toBe(true);
      expect(isIdentifier('rotation')).toBe(true);
    });
  });

  describe('cross-file parity with manifest schema', () => {
    // Both cvox/expect.ts (via isIdentifier) and manifest.ts (via
    // .refine(isIdentifier)) source the §5 rule from this module. If they
    // ever diverge, a name accepted by one file format would be unusable
    // in the other — cross-file lint would emit confusing diagnostics.
    it.each([...RESERVED_KEYWORDS, '1bad', 'has space'])(
      'manifest schema rejects %s (matches isIdentifier)',
      (name) => {
        const r = ManifestPartSchema.safeParse({ name });
        expect(r.success).toBe(false);
      },
    );

    it('manifest schema accepts a name that isIdentifier accepts', () => {
      const r = ManifestPartSchema.safeParse({ name: 'head' });
      expect(r.success).toBe(true);
    });
  });
});
