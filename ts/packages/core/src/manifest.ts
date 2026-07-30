import { z } from 'zod';
import { AnimationsSchema } from './animation.js';
import { Identifier } from './identifier-schema.js';
import { refPath } from './ref-path.js';
import { err, ok, type CuboidyErrorCode, type Result } from './result.js';

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const ManifestPartSchema = z
  .object({
    name: Identifier,
    parent: Identifier.optional(),
    position: Vec3.optional(),
    // SPEC §6.2 (v0.9): rest rotation in parent space, Euler degrees ZXY
    // (§4), applied around the part's pivot on top of the geometry-side
    // pivot.rot (q_rest = q_rotation · q_pivot, §7.7). Absent → identity.
    rotation: Vec3.optional(),
  })
  .strict();

export const ManifestSchema = z
  .object({
    name: Identifier,
    version: z.string().optional(),
    // SPEC §6.9: the model's geometry files. Absent → the default
    // ["voxels.json"] (use manifestGeometry() to read with the default
    // applied). Part names are unique across ALL listed files.
    geometry: z
      .array(refPath('.json'))
      .min(1)
      .refine((a) => new Set(a).size === a.length, {
        message: 'duplicate geometry entry',
      })
      // The refine is runtime-only; `.meta()` carries the equivalent
      // constraint into the generated JSON Schema.
      .meta({ uniqueItems: true })
      .optional(),
    // SPEC §6.10 (v0.7): external palette binding. When present it applies
    // to every geometry file and takes precedence over inline palettes.
    palette: refPath('.json').optional(),
    parts: z.array(ManifestPartSchema).min(1),
    animations: AnimationsSchema.optional(),
  })
  .strict()
  // SPEC §11.5 hierarchy rules: duplicate part names, parents that name
  // no part, and parent cycles are manifest errors. `params.cuboidyCode`
  // carries the structural code (§11.2) so parseManifest can map custom
  // issues to `duplicate` where the SPEC calls for it.
  .superRefine((m, ctx) => {
    const names = new Set<string>();
    for (const [i, p] of m.parts.entries()) {
      if (names.has(p.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parts', i, 'name'],
          message: `duplicate part name "${p.name}"`,
          params: { cuboidyCode: 'duplicate' },
        });
      }
      names.add(p.name);
    }
    for (const [i, p] of m.parts.entries()) {
      if (p.parent !== undefined && !names.has(p.parent)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parts', i, 'parent'],
          message: `parent "${p.parent}" is not a part in this manifest`,
        });
      }
    }
    // Cycle check: walk each part's parent chain. With duplicate names
    // the chain is ambiguous, so only run on a clean name set.
    if (names.size !== m.parts.length) return;
    const parentOf = new Map(m.parts.map((p) => [p.name, p.parent]));
    const cleared = new Set<string>();
    for (const [i, p] of m.parts.entries()) {
      const seen = new Set<string>();
      let cur: string | undefined = p.name;
      while (cur !== undefined && !cleared.has(cur)) {
        if (seen.has(cur)) {
          ctx.addIssue({
            code: 'custom',
            path: ['parts', i, 'parent'],
            message: `parent chain of "${p.name}" contains a cycle`,
          });
          return; // one report per manifest is enough
        }
        seen.add(cur);
        cur = parentOf.get(cur);
      }
      for (const s of seen) cleared.add(s);
    }
  });

// SPEC §6.9: `geometry` with its default applied.
export function manifestGeometry(m: Manifest): readonly string[] {
  return m.geometry ?? ['voxels.json'];
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
  // Same substitution the geometry reader makes: Zod reports an absent field
  // as a type mismatch against `undefined`, which misdescribes a forgotten
  // line. Both files are JSON now, so both should read the same way.
  const detail = isMissing ? 'required field is missing' : issue.message;
  return err(code, `${path}: ${detail}`, issue.path as ReadonlyArray<
    string | number
  >);
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
  // Custom (superRefine) issues carry their structural code explicitly.
  const custom = (issue as { params?: { cuboidyCode?: CuboidyErrorCode } })
    .params?.cuboidyCode;
  if (custom !== undefined) return custom;

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
