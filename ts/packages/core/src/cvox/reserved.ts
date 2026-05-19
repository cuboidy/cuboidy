// SPEC §7.3: the flat reserved-token set, split into two sub-categories
// by syntactic shape. Each value-pulling parser detects unsuitable tokens
// by trying its type-specific parse (parseFloat, parseHexColor, etc.) —
// reserved keywords naturally fail those checks since they don't match
// the expected shape. No generic isReserved predicate is needed by the
// parser layer; this module just exports the canonical sets.

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
