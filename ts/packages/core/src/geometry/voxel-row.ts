// SPEC §7.10: the voxel-row alphabet. A row is a string of cells; `.` is air
// and every other character is a palette index — 0-9 → 0-9, a-z → 10-35,
// A-Z → 36-61, which is why the palette caps at 62 (§7.4).
//
// Row width and index range are validated by the schema, which has `size` and
// the palette length in hand; this module is only the character mapping.

export const AIR = -1;

const DOT = 46;
const ZERO = 48;
const NINE = 57;
const UPPER_A = 65;
const UPPER_Z = 90;
const LOWER_A = 97;
const LOWER_Z = 122;

export function charToIndex(c: string): number | null {
  const code = c.charCodeAt(0);
  if (code === DOT) return AIR;
  if (code >= ZERO && code <= NINE) return code - ZERO;
  if (code >= LOWER_A && code <= LOWER_Z) return code - LOWER_A + 10;
  if (code >= UPPER_A && code <= UPPER_Z) return code - UPPER_A + 36;
  return null;
}

// Inverse of charToIndex, used by the serializer. Throws on out-of-range input
// — the palette holds at most 62 colours, so a well-formed AST never overflows
// this mapping.
export function indexToChar(idx: number): string {
  if (idx === AIR) return '.';
  if (idx >= 0 && idx <= 9) return String.fromCharCode(ZERO + idx);
  if (idx >= 10 && idx <= 35) return String.fromCharCode(LOWER_A + idx - 10);
  if (idx >= 36 && idx <= 61) return String.fromCharCode(UPPER_A + idx - 36);
  throw new RangeError(`indexToChar: index ${idx} out of range (expected AIR or 0..61)`);
}
