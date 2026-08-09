import { err, type CuboidyErrorCode, type Result } from './result.js';

// SPEC §11.2: one Zod-failure → structural-code mapping, for every reader.
//
// There used to be three — one in `parseManifest`, one in `parseGeometry`,
// one in `parsePaletteFile` — and they disagreed about four classes of
// mistake, so the same error reported a different code depending on which
// file it was written in. Worse, the manifest's copy contradicted itself: it
// substituted the message "required field is missing" off one predicate and
// computed the code off another, so a part with no `name` came back as
// `invalid-value` carrying a message that said `missing`.
//
// §11.2 is not silent about any of it, so this mapping follows the spec
// table rather than any of the three previous behaviours, and the readers
// become three-liners over it.
//
// Implementations MUST agree on codes (§11.2) — the fixtures corpus compares
// by code alone. That is also why this file, not the individual readers, is
// what a second implementation should be read against.

export interface ZodIssueLike {
  code: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

interface ZodErrorLike {
  issues: ReadonlyArray<ZodIssueLike>;
}

// Build the failed Result for a schema that rejected `input`. `input` is the
// value that was parsed, needed because Zod 4 dropped the `received` field
// and an absent key can only be told from a mistyped one by looking.
export function resultFromZodError<T>(
  error: ZodErrorLike,
  input: unknown,
): Result<T> {
  const issue = unwrapUnion(error.issues[0]!);
  const label = issue.path.length > 0 ? issue.path.join('.') : '<root>';
  // Zod describes an absent field by the type it wanted ("expected tuple,
  // received undefined"), which reads as a type error to someone who simply
  // forgot a line. Say what actually happened.
  const missing = isMissingAtPath(input, issue.path);
  const detail = missing
    ? 'required field is missing'
    : (keyReason(issue) ?? issue.message);
  return err(
    mapIssueToCode(issue, missing, input),
    `${label}: ${detail}`,
    issue.path as ReadonlyArray<string | number>,
  );
}

// ----- the mapping ------------------------------------------------------

function mapIssueToCode(
  issue: ZodIssueLike,
  missing: boolean,
  input: unknown,
): CuboidyErrorCode {
  // A rule expressed in a superRefine names its own code. This is the only
  // explicit channel; everything below is inference over Zod's issue shape,
  // which is why a hand-written validator in another language should read
  // the table in §11.2 rather than port these branches literally.
  const custom = (issue as { params?: { cuboidyCode?: CuboidyErrorCode } })
    .params?.cuboidyCode;
  if (custom !== undefined) return custom;

  // §11.2 `unknown`: "an unrecognized name appears where the spec defines a
  // closed set" — a key no schema field claims (`.strict()`), and a STRING
  // outside an enum, which is how an ease preset name (§6.7) is spelled.
  //
  // Zod emits `invalid_value` for anything an enum rejects, including `123`
  // and `null`, and those are not unrecognized names — §11.2 files "a value
  // of the wrong JSON type for its field" under `invalid-value`. So the
  // value has to be looked at, not just the issue.
  if (issue.code === 'unrecognized_keys') return 'unknown';
  if (issue.code === 'invalid_value') {
    return typeof valueAtPath(input, issue.path) === 'string'
      ? 'unknown'
      : 'invalid-value';
  }

  // §11.2 `missing`, at any depth. The manifest used to gate this on a
  // top-level `name` or `parts`, which is what made a part with no `name`
  // report `invalid-value`.
  if (missing) return 'missing';

  // §11.2 `missing`: "no `parts`, or `parts` present but empty". An empty
  // parts array reads as "nothing declared", not as a bad count — the one
  // place the spec puts an arity violation under `missing`. Checked on the
  // last segment rather than a top-level path so it holds wherever a `parts`
  // array appears.
  if (
    issue.code === 'too_small' &&
    originOf(issue) === 'array' &&
    issue.path[issue.path.length - 1] === 'parts'
  ) {
    return 'missing';
  }

  // §11.2 `wrong-arity` vs `invalid-value` for a bound violation, decided by
  // what the bound was reported against. Against a CONTAINER — `size`,
  // `pos`, `rot`, `palette`, `colors` — it is the wrong number of items
  // ("`size` or a coordinate that is not a triple"; "an inline palette with
  // 0 colors or more than 62"). Against an ELEMENT, meaning the last path
  // segment is an index, it is that element's value that is out of range
  // ("a `size` dimension outside [1..1024]").
  if (issue.code === 'too_small' || issue.code === 'too_big') {
    const last = issue.path[issue.path.length - 1];
    // A bound on a NUMBER is never an arity — nothing was counted. §7.4's
    // `metallic` / `roughness` / `emissive` are the first named fields to
    // carry a numeric range, and `metallic: 2` reporting `wrong-arity` said
    // the palette had the wrong number of entries, which it did not.
    if (originOf(issue) === 'number') return 'invalid-value';
    // §11.5 groups "duplicate or empty `geometry` list" under
    // `invalid-value`, where §11.2 puts a palette's 0-or-over-62 under
    // `wrong-arity`. Two arrays spelled the same way, coded differently, so
    // the list is named here rather than derived — and its duplicate half
    // already answers `invalid-value` through a superRefine, which is how
    // the pair came to be split when this rule was first written.
    if (last === 'geometry') return 'invalid-value';
    return typeof last === 'number' ? 'invalid-value' : 'wrong-arity';
  }

  // §11.2 `invalid-value`: present but malformed — a bad hex color, a voxel
  // character outside the alphabet, an identifier failing §5, a value of the
  // wrong JSON type for its field.
  return 'invalid-value';
}

function originOf(issue: ZodIssueLike): string | undefined {
  return (issue as { origin?: string }).origin;
}

// Why a record KEY was rejected. Zod reports the key failure as "Invalid key
// in record" and files the actual reason — the §5 regex, the reserved-word
// list — in a nested issue list, so the three maps keyed by an identifier
// (`animations`, `sockets`, and an animation's `parts`) all said the same
// uninformative thing where the same rule stated on a FIELD says which rule
// it was. The path already names the offending key.
function keyReason(issue: ZodIssueLike): string | undefined {
  if (issue.code !== 'invalid_key') return undefined;
  const inner = (issue as { issues?: ZodIssueLike[] }).issues ?? [];
  return inner[0]?.message;
}

// ----- unions -----------------------------------------------------------

// A union failure surfaces as ONE `invalid_union` issue whose own message is
// a generic "invalid input", with the real diagnoses tucked into one issue
// list per branch. Report the branch the author was evidently aiming at, so
// both the message and the §11.2 code stay as specific as they were before
// the field grew a second form.
//
// "Aiming at" is decided by whether the branch rejected the value's TYPE.
// A root-level `invalid_type` means the branch wanted a different kind of
// value entirely and has nothing useful to say. Anything else means the
// branch accepted the shape and objected to the contents — a failure deeper
// in, or an unrecognized key on an object it otherwise took. If EVERY branch
// rejected the type the value matches no form at all, and the last branch is
// reported: for §7.4's palette that is the reference form, whose "expected
// string" is the more legible half of the pair.
//
// The type test is what distinguishes a branch that got as far as reading
// keys from one that never started. Testing only for a non-empty path
// missed an extra key on an otherwise-complete inline clip — every required
// field present, so Zod's one complaint was `unrecognized_keys` at the
// branch root — and reported "expected string, received object" at an
// author who had correctly written an object.
//
// Only `parseGeometry` did this before, which is why every §6.7 keyframe
// mistake — an unrecognized field, a misspelled ease preset, an absent
// `loop` — collapsed into `invalid-value: animations.<name>: Invalid input`
// when the same clip was written in the manifest.
function unwrapUnion(issue: ZodIssueLike, depth = 0): ZodIssueLike {
  if (issue.code !== 'invalid_union' || depth > 4) return issue;
  const branches = (issue as { errors?: ZodIssueLike[][] }).errors ?? [];
  if (branches.length === 0) return issue;
  const aimed = branches.find((b) => {
    const first = b[0];
    if (first === undefined) return false;
    return first.path.length > 0 || first.code !== 'invalid_type';
  });
  const picked = aimed ?? branches[branches.length - 1]!;
  const first = picked[0];
  if (first === undefined) return issue;
  return unwrapUnion(
    { ...first, path: [...issue.path, ...first.path] },
    depth + 1,
  );
}

// The value Zod was complaining about, or undefined when the path does not
// lead anywhere. Needed because some Zod issue codes cover more than one
// §11.2 category and only the value tells them apart.
function valueAtPath(input: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let cur: unknown = input;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

// ----- absence ----------------------------------------------------------

// True when the value at `path` is genuinely absent from `input`. Uses
// Object.hasOwn so an inherited property on a caller-supplied object does
// not masquerade as a present field.
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
