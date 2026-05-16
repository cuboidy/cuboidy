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
  const code = mapIssueToCode(issue);
  const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
  return err(code, `${path}: ${issue.message}`);
}

interface ZodIssueLike {
  code: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

function mapIssueToCode(issue: ZodIssueLike): ManifestErrorCode {
  // C01: missing top-level `name`
  if (
    issue.path.length === 1 &&
    issue.path[0] === 'name' &&
    (issue.code === 'invalid_type' || issue.code === 'invalid_value')
  ) {
    return 'C01';
  }
  // C02: parts array empty or absent
  if (
    issue.path.length >= 1 &&
    issue.path[0] === 'parts' &&
    (issue.code === 'too_small' ||
      issue.code === 'invalid_type' ||
      issue.code === 'invalid_value')
  ) {
    return 'C02';
  }
  // C13: unknown field (Zod strict mode)
  if (issue.code === 'unrecognized_keys') return 'C13';
  // Fallback: treat as C13 generic structural failure
  return 'C13';
}
