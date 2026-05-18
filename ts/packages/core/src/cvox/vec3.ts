import { err, ok, type CuboidyErrorCode, type Result } from '../result.js';
import { parseFloatStrict } from './numbers.js';

// Shared 3-component vector. Used for both positions (voxel units) and
// rotations (Euler degrees, ZXY order per SPEC §4). TypeScript is structural,
// so this is one type — distinction is carried by field names (`pos` / `rot`)
// on the enclosing interface, not by nominal type.
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Parse exactly three numeric tokens into a Vec3. Caller supplies the
// structural error code and a contextual label that goes into the error
// message (e.g. 'pivot position', 'socket rotation').
export function parseVec3(
  args: readonly string[],
  code: CuboidyErrorCode,
  label: string,
): Result<Vec3> {
  const xs: number[] = [];
  for (const arg of args) {
    const n = parseFloatStrict(arg);
    if (n === null) {
      return err(code, `${label} coord '${arg}' is not a number`);
    }
    xs.push(n);
  }
  return ok({ x: xs[0]!, y: xs[1]!, z: xs[2]! });
}
