import { RESERVED_KEYWORDS } from './cvox/reserved.js';

// SPEC §5: canonical identifier rule, shared by both file formats
// (cuboidy.json names via manifest.ts Zod schema, cvox part/socket names
// via cvox/expect.ts expectIdentifier). Two conditions: (1) regex shape
// — first char letter or underscore, rest letters/digits/underscores/
// hyphens; (2) not a reserved cvox keyword — keeps cross-file
// referential integrity (a manifest name a cvox file couldn't write
// without lexical ambiguity would be unusable).
//
// The reserved-keyword guard lets cvox accept bare `part head` instead of
// `part "head"` for identifier slots: the keyword `part` is rejected by
// isIdentifier, so `part part` correctly errors as "invalid identifier"
// rather than parsing as a part named `part`.
//
// Punctuation tokens (`{`, `}`, `,`) are not consulted: they fail the
// regex anyway (non-identifier chars), so the reserved set we need is
// just the keyword subset, not the full RESERVED_TOKENS.

const RESERVED_KEYWORD_SET = new Set(RESERVED_KEYWORDS);

export const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function isIdentifier(s: string): boolean {
  if (RESERVED_KEYWORD_SET.has(s)) return false;
  return IDENTIFIER_RE.test(s);
}
