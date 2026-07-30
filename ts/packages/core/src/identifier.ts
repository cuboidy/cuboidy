// SPEC §5: the canonical identifier rule, shared by every name in the format —
// model, part, socket and animation — across both `cuboidy.json` and the
// geometry file. Two conditions: (1) the regex shape, first char a letter or
// underscore, rest letters/digits/underscores/hyphens; (2) not one of the
// reserved keywords below.
//
// The reserved list is inherited from the text container that preceded JSON:
// there, a bare `part part` was lexically ambiguous, so rejecting the keyword
// as an identifier was load-bearing. JSON has no such ambiguity. SPEC §5 keeps
// the rule anyway — it costs nothing, no model uses these names, and lifting it
// would be a separate breaking change to a rule both files currently share.
export const RESERVED_KEYWORDS: readonly string[] = [
  'palette',
  'part',
  'size',
  'pivot',
  'socket',
  'voxels',
  'rot',
];

const RESERVED_KEYWORD_SET = new Set(RESERVED_KEYWORDS);

export const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function isIdentifier(s: string): boolean {
  if (RESERVED_KEYWORD_SET.has(s)) return false;
  return IDENTIFIER_RE.test(s);
}
