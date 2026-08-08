import {
  GeometrySchema,
  type GeometryDoc,
  type GeometryDocPart,
} from './schema.js';
import { locateJsonPath } from './locate.js';
import { paletteEntryFrom, type PaletteEntryDoc } from './palette.js';
import { charToIndex } from './voxel-row.js';
import type {
  Geometry,
  PaletteEntry,
  Part,
  Pivot,
  Socket,
  Vec3,
} from './types.js';
import { err, ok, type Result } from '../result.js';
import { resultFromZodError } from '../zod-diagnostic.js';

// SPEC §7: reads a geometry file into the same AST every downstream consumer
// already expects — lintGeometry, validateProject, buildMesh and the renderers are
// untouched by the container change.
//
// Validation is delegated wholly to GeometrySchema so there is exactly one
// definition of what a valid file is, shared with the published JSON Schema.
// This module's own job is the mapping that Zod cannot express: hex strings to
// Color, row strings to palette indices, and the §7.7 default pivot.

export function parseGeometry(json: unknown): Result<Geometry> {
  const result = GeometrySchema.safeParse(json);
  if (!result.success) return resultFromZodError(result.error, json);
  return ok(toAst(result.data));
}

// Convenience for callers holding bytes rather than a parsed value. Because
// this one HAS the text, it can resolve the schema's document path back to a
// line and say so — the `line N:` prefix the retired text format reported and
// the only navigation aid an author gets in a plain textarea.
export function parseGeometryText(text: string): Result<Geometry> {
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

// SPEC §6.13: build the runtime Part for geometry written INLINE in the
// manifest, taking its `name` from the enclosing manifest part (the inline
// object deliberately has none). The manifest schema has already validated
// it against the same rules a file's part goes through — literally the same
// `checkPartFields` — and this is the same mapping, so downstream nothing
// can tell an inline part from a file one. That is the whole point: no
// consumer should branch on where a shape was written.
export function inlinePartToAst(
  doc: Omit<GeometryDocPart, 'name'>,
  name: string,
): Part {
  return toPart({ ...doc, name });
}

// §7.4 palette entries → the runtime palette. Exported for the same reason:
// inline geometry and the manifest's default palette (§6.13) offer the
// identical field and must become entries by exactly the route a geometry
// file's own palette takes.
export function colorsToPalette(
  entries: readonly (string | PaletteEntryDoc)[],
): PaletteEntry[] {
  return entries.map(toEntry);
}

// ----- AST construction -------------------------------------------------

function toAst(doc: GeometryDoc): Geometry {
  const geometry: Geometry = {
    // An absent palette is an EMPTY array in the AST, not a missing field:
    // length 0 is the unambiguous "declared none" signal the rest of the
    // codebase already keys on (§7.4), and it round-trips back to absent.
    palette: Array.isArray(doc.palette) ? doc.palette.map(toEntry) : [],
    parts: doc.parts.map(toPart),
  };
  // A reference stays UNRESOLVED here — parsing one file cannot see the
  // package around it. resolveProject reads `paletteRef` and fills
  // `palette` in, so nothing downstream of it has to care which form the
  // author used.
  if (typeof doc.palette === 'string') geometry.paletteRef = doc.palette;
  return geometry;
}

function toEntry(doc: string | PaletteEntryDoc): PaletteEntry {
  // The schema's regex has already accepted only well-formed hex, so the
  // parser cannot fail here; the throw documents the invariant rather than
  // guarding a reachable path.
  const entry = paletteEntryFrom(doc);
  if (entry === null) {
    const hex = typeof doc === 'string' ? doc : doc.color;
    throw new Error(`unreachable: schema accepted bad color ${hex}`);
  }
  return entry;
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

