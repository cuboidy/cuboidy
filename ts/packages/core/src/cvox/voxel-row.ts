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
