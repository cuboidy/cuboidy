import type { Color, Cvox, Part, Pivot, Size, Socket, Vec3 } from './types.js';
import { indexToChar } from './voxel-row.js';

// SPEC §7.1.1 (writer rule): canonical cvox emission. The serializer is
// the "writer-strict" half of "be liberal in what you accept, conservative
// in what you produce" — every well-formed Cvox AST has exactly one
// canonical text form. parseCvox(serializeCvox(c)) is structurally equal
// to c (round-trip property), and serializeCvox(parseCvox(text)) is a
// canonical fixed point (idempotent across re-formatting passes).
//
// Comment preservation is intentionally OUT OF SCOPE (Phase 1). Tools
// that need to round-trip user-written comments (web editor, format-on-
// save) belong to Phase 2; their parser/serializer pair lives behind a
// separate API (`parseCvoxWithComments` / `serializeCvoxWithComments`)
// that has yet to be designed. Today's consumers (parser tests,
// programmatic Cvox construction) don't need comments and benefit from
// the simpler API.

const INDENT = '    '; // 4 spaces, per SPEC §7.1.1 writer rule

export function serializeCvox(cvox: Cvox): string {
  const lines: string[] = [];
  // SPEC §7.X: file header is emitted verbatim at the top, separated from
  // the palette by exactly one blank line. The canonical form requires
  // the single-blank-line separator even if the source had multiple —
  // `extractHeader` already trims trailing blanks from the captured header.
  if (cvox.header !== undefined && cvox.header.length > 0) {
    for (const line of cvox.header) lines.push(line);
    lines.push('');
  }
  lines.push(serializePalette(cvox.palette));
  for (const part of cvox.parts) {
    lines.push('');
    appendPart(lines, part);
  }
  return lines.join('\n') + '\n';
}

function serializePalette(palette: readonly Color[]): string {
  return 'palette ' + palette.map(serializeColor).join(' ');
}

// Canonical color form: `#RRGGBB` when alpha = 0xFF, `#RRGGBBAA` otherwise.
// Short forms (`#RGB`, `#RGBA`) are reader-accepted but not writer-emitted —
// canonical output has exactly one representation per color value.
function serializeColor(c: Color): string {
  const rgb = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a === 0xff ? rgb : `${rgb}${hex2(c.a)}`;
}

function hex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0');
}

function appendPart(lines: string[], part: Part): void {
  lines.push(`part ${part.name}`);
  lines.push(`${INDENT}${serializeSize(part.size)}`);

  // SPEC §7.7: pivot is omitted when both position is the bounding-box
  // bottom-center default ([W/2, 0, D/2]) AND no rotation is present.
  // assemblePart fills the default when the source omitted pivot, so the
  // serializer mirrors that: if the AST happens to carry the default and
  // no rotation, we drop it again. Round-trip is preserved because
  // parseCvox + assemblePart reconstruct the same default.
  if (!isDefaultPivot(part.pivot, part.size)) {
    lines.push(`${INDENT}${serializePivot(part.pivot)}`);
  }

  for (const socket of part.sockets) {
    lines.push(`${INDENT}${serializeSocket(socket)}`);
  }

  appendVoxels(lines, part.voxels, part.size);
}

function serializeSize(s: Size): string {
  return `size ${s.w} ${s.h} ${s.d}`;
}

function isDefaultPivot(p: Pivot, size: Size): boolean {
  if (p.rot !== undefined) return false;
  return p.pos.x === size.w / 2 && p.pos.y === 0 && p.pos.z === size.d / 2;
}

function serializePivot(p: Pivot): string {
  const base = `pivot ${serializeVec3(p.pos)}`;
  return p.rot ? `${base} rot ${serializeVec3(p.rot)}` : base;
}

function serializeSocket(s: Socket): string {
  const base = `socket ${s.name} ${serializeVec3(s.pos)}`;
  return s.rot ? `${base} rot ${serializeVec3(s.rot)}` : base;
}

function serializeVec3(v: Vec3): string {
  return `${formatNum(v.x)} ${formatNum(v.y)} ${formatNum(v.z)}`;
}

// Integers stay as integers; fractionals get JS Number's natural toString
// (e.g. 1.5 → "1.5"). Avoids `1.0` style — that would be re-tokenized as
// `1.0` which `parseFloatStrict` accepts, but canonical is the shorter
// form. Negative integers and decimals work transparently.
function formatNum(n: number): string {
  return n.toString();
}

function appendVoxels(
  lines: string[],
  voxels: Part['voxels'],
  size: Size,
): void {
  lines.push(`${INDENT}voxels {`);
  const rowIndent = INDENT + INDENT;
  for (let y = 0; y < size.h; y++) {
    if (y > 0) lines.push(`${rowIndent},`);
    const layer = voxels[y]!;
    for (let z = 0; z < size.d; z++) {
      const row = layer[z]!;
      lines.push(`${rowIndent}${rowToText(row)}`);
    }
  }
  lines.push(`${INDENT}}`);
}

function rowToText(cells: readonly number[]): string {
  let s = '';
  for (const idx of cells) s += indexToChar(idx);
  return s;
}
