import { GeometrySchema, type GeometryDoc } from './schema.js';
import { locateJsonPath } from './locate.js';
import { parseHexColor } from './palette.js';
import { charToIndex } from './voxel-row.js';
import type { Color, Cvox, Part, Pivot, Socket, Vec3 } from './types.js';
import { err, ok, type CuboidyErrorCode, type Result } from '../result.js';

// SPEC §7: reads a geometry file into the same AST every downstream consumer
// already expects — lintCvox, validateProject, buildMesh and the renderers are
// untouched by the container change.
//
// Validation is delegated wholly to GeometrySchema so there is exactly one
// definition of what a valid file is, shared with the published JSON Schema.
// This module's own job is the mapping that Zod cannot express: hex strings to
// Color, row strings to palette indices, and the §7.7 default pivot.

export function parseGeometry(json: unknown): Result<Cvox> {
  const result = GeometrySchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const label = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    // Zod describes an absent field by the type it wanted ("expected tuple,
    // received undefined"), which reads as a type error to someone who simply
    // forgot a line. Say what actually happened.
    const missing = isMissingAtPath(json, issue.path);
    const detail = missing ? 'required field is missing' : issue.message;
    return err(
      mapIssueToCode(issue, json),
      `${label}: ${detail}`,
      issue.path as ReadonlyArray<string | number>,
    );
  }
  return ok(toAst(result.data));
}

// Convenience for callers holding bytes rather than a parsed value. Because
// this one HAS the text, it can resolve the schema's document path back to a
// line and say so — the `line N:` prefix the retired text format reported and
// the only navigation aid an author gets in a plain textarea.
export function parseGeometryText(text: string): Result<Cvox> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return err('invalid-value', `invalid JSON: ${(e as Error).message}`);
  }
  const result = parseGeometry(json);
  if (result.ok || result.path === undefined || result.path.length === 0) {
    return result;
  }
  const at = locateJsonPath(text, result.path);
  if (at === null) return result;
  return { ...result, message: `line ${at.line}: ${result.message}` };
}

// ----- AST construction -------------------------------------------------

function toAst(doc: GeometryDoc): Cvox {
  return {
    // An absent palette is an EMPTY array in the AST, not a missing field:
    // length 0 is the unambiguous "declared none" signal the rest of the
    // codebase already keys on (§7.4), and it round-trips back to absent.
    palette: (doc.palette ?? []).map(toColor),
    parts: doc.parts.map(toPart),
  };
}

function toColor(hex: string): Color {
  // The schema's regex has already accepted only well-formed hex, so the
  // parser cannot fail here; the throw documents the invariant rather than
  // guarding a reachable path.
  const color = parseHexColor(hex);
  if (color === null) throw new Error(`unreachable: schema accepted bad color ${hex}`);
  return color;
}

function toPart(part: GeometryDoc['parts'][number]): Part {
  const [w, h, d] = part.size;
  const size = { w, h, d };
  return {
    name: part.name,
    size,
    pivot: toPivot(part.pivot, size),
    sockets: (part.sockets ?? []).map(toSocket),
    voxels: part.voxels.map((layer) => layer.map(toRow)),
  };
}

// SPEC §7.7: absent pivot means bottom-center of the bounding box. Filling the
// default here rather than leaving it optional keeps every consumer free of
// "if the pivot is missing" branches, and the serializer drops it again when it
// still equals the default, so absence round-trips.
function toPivot(
  pivot: GeometryDoc['parts'][number]['pivot'],
  size: { w: number; h: number; d: number },
): Pivot {
  if (pivot === undefined) {
    return { pos: { x: size.w / 2, y: 0, z: size.d / 2 } };
  }
  const out: Pivot = { pos: toVec3(pivot.pos) };
  if (pivot.rot !== undefined) out.rot = toVec3(pivot.rot);
  return out;
}

function toSocket(
  socket: NonNullable<GeometryDoc['parts'][number]['sockets']>[number],
): Socket {
  const out: Socket = { name: socket.name, pos: toVec3(socket.pos) };
  if (socket.rot !== undefined) out.rot = toVec3(socket.rot);
  return out;
}

function toVec3(v: readonly [number, number, number]): Vec3 {
  return { x: v[0], y: v[1], z: v[2] };
}

function toRow(row: string): number[] {
  const cells: number[] = [];
  for (const ch of row) {
    const idx = charToIndex(ch);
    if (idx === null) throw new Error(`unreachable: schema accepted bad cell '${ch}'`);
    cells.push(idx);
  }
  return cells;
}

// ----- diagnostics ------------------------------------------------------

interface ZodIssueLike {
  code: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

// Mirrors parseManifest's mapping so both files report the same §11.2
// structural categories for the same class of mistake.
function mapIssueToCode(issue: ZodIssueLike, input: unknown): CuboidyErrorCode {
  const custom = (issue as { params?: { cuboidyCode?: CuboidyErrorCode } }).params
    ?.cuboidyCode;
  if (custom !== undefined) return custom;

  if (issue.code === 'unrecognized_keys') return 'unknown';

  // An empty `parts` array reads as "no parts declared", not a bad value.
  if (
    issue.path.length === 1 &&
    issue.path[0] === 'parts' &&
    issue.code === 'too_small'
  ) {
    return 'missing';
  }

  // A genuinely absent required field. Zod 4 drops `received`, so the only
  // reliable test is to walk the input — same approach as manifest.ts.
  if (isMissingAtPath(input, issue.path)) return 'missing';

  // Too many / too few colours is an arity problem (§7.4's 62-colour cap).
  if (issue.path[0] === 'palette' && (issue.code === 'too_big' || issue.code === 'too_small')) {
    return 'wrong-arity';
  }

  // A bound violation reported against a container — `size`, `pos`, `rot` —
  // means the wrong number of elements. Reported against an element (the last
  // path segment is an index) it means a bad value: SPEC §7.6 calls a zero or
  // out-of-range dimension `invalid-value`, not `wrong-arity`.
  if (issue.code === 'too_small' || issue.code === 'too_big') {
    const last = issue.path[issue.path.length - 1];
    return typeof last === 'number' ? 'invalid-value' : 'wrong-arity';
  }
  return 'invalid-value';
}

function isMissingAtPath(input: unknown, path: ReadonlyArray<PropertyKey>): boolean {
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
