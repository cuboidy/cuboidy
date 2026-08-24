// SPEC §7.10: the voxel-row alphabet. A row is a string of cells; `.` is air
// and every other character is a palette index — 0-9 → 0-9, a-z → 10-35,
// A-Z → 36-61, then `$` → 62 and `%` → 63, which is where the palette caps
// (§7.4).
//
// The last two are not alphanumeric because there is no alphanumeric left. They
// were added because 62 was not a decision — it is what three runs of digits and
// letters happen to total — and it left a 64-colour palette two short of fitting
// in one file, which is a common size to be two short of. Both are dense enough
// in an ASCII grid not to be mistaken for `.`, which rules out `,` `'` and `:`,
// and neither carries a meaning elsewhere in the format, which rules out `#`.
//
// Row width and index range are validated by the schema, which has `size` and
// the palette length in hand; this module is the character mapping and the
// index-space helpers, nothing more.

export const AIR = -1;

const DOT = 46;
const ZERO = 48;
const NINE = 57;
const UPPER_A = 65;
const UPPER_Z = 90;
const LOWER_A = 97;
const LOWER_Z = 122;
const DOLLAR = 36;
const PERCENT = 37;

export function charToIndex(c: string): number | null {
  const code = c.charCodeAt(0);
  if (code === DOT) return AIR;
  if (code >= ZERO && code <= NINE) return code - ZERO;
  if (code >= LOWER_A && code <= LOWER_Z) return code - LOWER_A + 10;
  if (code >= UPPER_A && code <= UPPER_Z) return code - UPPER_A + 36;
  if (code === DOLLAR) return 62;
  if (code === PERCENT) return 63;
  return null;
}

// Highest palette index a part's voxels reference (AIR when the part is
// all air). Both the assembler's palette-overflow check and lint's E04
// ask this; keeping it beside AIR keeps the index space in one file.
export function maxPaletteIndex(part: {
  voxels: readonly (readonly (readonly number[])[])[];
}): number {
  let max = AIR;
  for (const layer of part.voxels) {
    for (const row of layer) {
      for (const idx of row) {
        if (idx > max) max = idx;
      }
    }
  }
  return max;
}

// Inverse of charToIndex, used by the serializer. Throws on out-of-range input
// — the palette holds at most 64 colours, so a well-formed AST never overflows
// this mapping.
export function indexToChar(idx: number): string {
  if (idx === AIR) return '.';
  if (idx >= 0 && idx <= 9) return String.fromCharCode(ZERO + idx);
  if (idx >= 10 && idx <= 35) return String.fromCharCode(LOWER_A + idx - 10);
  if (idx >= 36 && idx <= 61) return String.fromCharCode(UPPER_A + idx - 36);
  if (idx === 62) return '$';
  if (idx === 63) return '%';
  throw new RangeError(`indexToChar: index ${idx} out of range (expected AIR or 0..63)`);
}
