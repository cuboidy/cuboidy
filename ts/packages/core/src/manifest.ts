import { z } from 'zod';
import { IDENTIFIER_RE } from './identifier.js';
import { RESERVED_KEYWORDS } from './cvox/reserved.js';
import { err, ok, type CuboidyErrorCode, type Result } from './result.js';

// Split into `.regex()` + `.refine()` so the IDENTIFIER_RE pattern
// serializes to JSON Schema (consumed by editors, third-party
// validators) and the reserved-keyword check still fires at runtime.
// The generated JSON Schema's post-process step injects an equivalent
// `not.enum` so the two checks stay in parity for external tooling too.
const RESERVED_KEYWORD_SET = new Set(RESERVED_KEYWORDS);
const Identifier = z
  .string()
  .regex(IDENTIFIER_RE, 'must match the identifier regex (letters/digits/_/-, no leading digit or hyphen)')
  .refine((s) => !RESERVED_KEYWORD_SET.has(s), {
    message: 'must not be a reserved cvox keyword',
  });

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const ManifestPartSchema = z
  .object({
    name: Identifier,
    parent: Identifier.optional(),
    position: Vec3.optional(),
  })
  .strict();

export const ManifestSchema = z
  .object({
    name: Identifier,
    version: z.string().optional(),
    parts: z.array(ManifestPartSchema).min(1),
    animations: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestPart = z.infer<typeof ManifestPartSchema>;

export function parseManifest(json: unknown): Result<Manifest> {
  const result = ManifestSchema.safeParse(json);
  if (result.success) return ok(result.data);

  const issue = result.error.issues[0]!;
  const isMissing = isMissingAtPath(json, issue.path);
  const code = mapIssueToCode(issue, isMissing);
  const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
  return err(code, `${path}: ${issue.message}`);
}

interface ZodIssueLike {
  code: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

// Returns true if the value at `path` is undefined in `input` (genuinely
// missing). Zod 4 drops the `received` field, so the only reliable way to
// distinguish "missing" from "wrong type" is to walk the input ourselves.
// Uses Object.hasOwn so that an inherited property on a caller-supplied
// object does not masquerade as a present field.
function isMissingAtPath(
  input: unknown,
  path: ReadonlyArray<PropertyKey>,
): boolean {
  let cur: unknown = input;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return true;
    if (typeof key === 'number') {
      if (!Array.isArray(cur) || key >= cur.length) return true;
      cur = cur[key];
    } else {
      if (!Object.hasOwn(cur as object, key)) return true;
      cur = (cur as Record<PropertyKey, unknown>)[key];
    }
  }
  return cur === undefined;
}

function mapIssueToCode(
  issue: ZodIssueLike,
  isMissing: boolean,
): CuboidyErrorCode {
  // Genuinely missing required top-level field (name or parts).
  if (
    isMissing &&
    issue.path.length === 1 &&
    (issue.path[0] === 'name' || issue.path[0] === 'parts')
  ) {
    return 'missing';
  }

  // Empty top-level parts array.
  if (
    issue.path.length === 1 &&
    issue.path[0] === 'parts' &&
    issue.code === 'too_small'
  ) {
    return 'missing';
  }

  // Unknown JSON field (Zod strict mode catches it).
  if (issue.code === 'unrecognized_keys') return 'unknown';

  // Fallback: anything else (wrong type, bad identifier, etc.) is treated
  // as a value error. SPEC v0.3 may split this further as manifest
  // validation grows (parent cycle, animation refs, etc.).
  return 'invalid-value';
}
