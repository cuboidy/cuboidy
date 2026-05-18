// SPEC §7.3: the flat reserved-token set, split into two sub-categories
// by syntactic shape but unified by parsing semantic. See the Token Cursor
// (cursor.ts) for how pullArgs uses isReserved as its stop predicate.

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

export function isReserved(text: string): boolean {
  return RESERVED_TOKENS.has(text);
}
