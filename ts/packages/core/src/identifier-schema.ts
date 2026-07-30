import { z } from 'zod';
import { IDENTIFIER_RE } from './identifier.js';
import { RESERVED_KEYWORDS } from './identifier.js';

// SPEC §5: the shared Zod schema for an identifier slot — model / part /
// socket / animation names. Split into `.regex()` + `.refine()` so the
// IDENTIFIER_RE pattern serializes to JSON Schema (consumed by editors and
// third-party validators) while the reserved-keyword check still fires at
// runtime. json-schema.ts's post-process injects an equivalent `not.enum`
// onto every node carrying this pattern, so the JSON Schema and the Zod
// runtime stay in parity for external tooling.
//
// Lives in its own leaf module (no manifest/animation imports) so both
// manifest.ts and animation.ts can use it without an import cycle.
const RESERVED_KEYWORD_SET = new Set(RESERVED_KEYWORDS);

export const Identifier = z
  .string()
  .regex(
    IDENTIFIER_RE,
    'must match the identifier regex (letters/digits/_/-, no leading digit or hyphen)',
  )
  .refine((s) => !RESERVED_KEYWORD_SET.has(s), {
    message: 'must not be a reserved cvox keyword',
  });
