import { z } from 'zod';
import { err, ok, type ManifestErrorCode, type Result } from './result.js';

const Identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/);

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const PartSchema = z
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
    parts: z.array(PartSchema).min(1),
    animations: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;
export type Part = z.infer<typeof PartSchema>;

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
): ManifestErrorCode {
  // C01: top-level `name` is *missing*. SPEC §11.5 narrows C01 to missing,
  // not "wrong type" — wrong-type cases currently fall through to C13.
  if (issue.path.length === 1 && issue.path[0] === 'name' && isMissing) {
    return 'C01';
  }

  // C02: top-level `parts` is missing OR empty. Inner-part validation
  // (parts[i].xxx) falls through to C13 until SPEC v0.3 adds C03-C12.
  if (issue.path.length === 1 && issue.path[0] === 'parts') {
    if (isMissing || issue.code === 'too_small') return 'C02';
  }

  // C13: unknown field (Zod strict mode), or any other structural failure
  // not narrowed above. SPEC v0.3 should add codes for wrong-type / bad
  // identifier / etc.; for now C13 is the fallback bucket.
  return 'C13';
}
