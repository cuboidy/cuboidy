import { err, ok, type Result } from '../result.js';

export const AIR = -1;

// Inside a voxels { ... } block, every non-punctuation token is a voxel-row
// candidate. parseVoxelRow validates it against the declared row width (W)
// and the palette length. Characters outside [.0-9a-zA-Z] are invalid-value.
export function parseVoxelRow(
  text: string,
  w: number,
  paletteSize: number,
): Result<number[]> {
  if (text.length !== w) {
    return err(
      'wrong-arity',
      `voxel row length ${text.length}, expected ${w}`,
    );
  }
  const cells: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const idx = charToIndex(c);
    if (idx === null) {
      return err(
        'invalid-value',
        `voxel cell '${c}' is not in [.0-9a-zA-Z]`,
      );
    }
    if (idx !== AIR && idx >= paletteSize) {
      return err(
        'invalid-value',
        `voxel cell '${c}' references palette index ${idx}, palette has ${paletteSize}`,
      );
    }
    cells.push(idx);
  }
  return ok(cells);
}

const DOT = 46;
const ZERO = 48;
const NINE = 57;
const UPPER_A = 65;
const UPPER_Z = 90;
const LOWER_A = 97;
const LOWER_Z = 122;

function charToIndex(c: string): number | null {
  const code = c.charCodeAt(0);
  if (code === DOT) return AIR;
  if (code >= ZERO && code <= NINE) return code - ZERO;
  if (code >= LOWER_A && code <= LOWER_Z) return code - LOWER_A + 10;
  if (code >= UPPER_A && code <= UPPER_Z) return code - UPPER_A + 36;
  return null;
}

// Inverse of charToIndex: palette index → voxel-row character. Used by
// the serializer. AIR (-1) is rendered as `.`; indices 0..9 become
// '0'-'9'; 10..35 become 'a'-'z'; 36..61 become 'A'-'Z'. Throws on
// out-of-range input — palette can hold at most 62 colors (SPEC §7.4),
// so a well-formed Cvox AST never overflows this mapping.
export function indexToChar(idx: number): string {
  if (idx === AIR) return '.';
  if (idx >= 0 && idx <= 9) return String.fromCharCode(ZERO + idx);
  if (idx >= 10 && idx <= 35) return String.fromCharCode(LOWER_A + idx - 10);
  if (idx >= 36 && idx <= 61) return String.fromCharCode(UPPER_A + idx - 36);
  throw new RangeError(`indexToChar: index ${idx} out of range (expected AIR or 0..61)`);
}
