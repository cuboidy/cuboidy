import type { Token } from './tokenize.js';

// SPEC §7.3: the flat reserved-token set, split into two sub-categories
// by syntactic shape but unified by parsing semantic. A token only counts
// as reserved when its `kind` is 'bare' — a quoted `"part"` (kind='string')
// is a user-supplied identifier and never collides with the reserved
// keyword `part`. Production parsers use `isReserved` as the stop predicate
// when pulling value-tokens, so reserved tokens never get silently consumed
// into an identifier or numeric slot.

export const RESERVED_KEYWORDS: readonly string[] = [
  'palette',
  'part',
  'size',
  'pivot',
  'socket',
  'voxels',
  'rot',
];

export const RESERVED_PUNCTUATION: readonly string[] = ['{', '}', ','];

export const RESERVED_TOKENS: ReadonlySet<string> = new Set([
  ...RESERVED_KEYWORDS,
  ...RESERVED_PUNCTUATION,
]);

export function isReserved(t: Token): boolean {
  return t.kind === 'bare' && RESERVED_TOKENS.has(t.text);
}
