import { z } from 'zod';
import { AnimationsSchema } from './animation.js';
import { Identifier } from './identifier-schema.js';
import { err, ok, type CuboidyErrorCode, type Result } from './result.js';

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

// SPEC §8 reference path, parameterized by the required extension
// (`.cvox` for geometry entries, `.json` for the palette binding and
// animation references). Syntax-only: whether the target exists — and
// whether a `../` path is loadable at all — is the consuming tool's
// concern.
function refPath(ext: string) {
  return z
    .string()
    .refine((s) => s.endsWith(ext) && s.length > ext.length, {
      message: `must be a relative path ending in ${ext}`,
    })
    .refine((s) => !s.includes('\\'), {
      message: 'must use forward slashes',
    })
    .refine((s) => !s.startsWith('/'), {
      message: 'absolute paths are forbidden',
    })
    .refine((s) => !s.includes(':'), {
      message: 'URLs and namespace:key URIs are forbidden',
    })
    .refine((s) => !s.split('/').includes(''), {
      message: 'empty path segment',
    });
}

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
    // SPEC §6.9 (v0.7): the model's geometry files. Absent → the default
    // ["voxels.cvox"] (use manifestGeometry() to read with the default
    // applied). Part names are unique across ALL listed files.
    geometry: z
      .array(refPath('.cvox'))
      .min(1)
      .refine((a) => new Set(a).size === a.length, {
        message: 'duplicate geometry entry',
      })
      .optional(),
    // SPEC §6.10 (v0.7): external palette binding. When present it applies
    // to every geometry file and takes precedence over inline palettes.
    palette: refPath('.json').optional(),
    parts: z.array(ManifestPartSchema).min(1),
    animations: AnimationsSchema.optional(),
  })
  .strict();

// SPEC §6.9: `geometry` with its default applied.
export function manifestGeometry(m: Manifest): readonly string[] {
  return m.geometry ?? ['voxels.cvox'];
}

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
  // as a value error. The SPEC may split this further as manifest
  // validation grows (parent cycle, animation refs, etc.).
  return 'invalid-value';
}
