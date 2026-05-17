import { err, ok, type Result } from '../result.js';
import { parseFloatStrict } from './numbers.js';
import type { Vec3 } from './vec3.js';

export interface Pivot {
  pos: Vec3;
  rot?: Vec3;
}

export function parsePivot(args: readonly string[]): Result<Pivot> {
  // Two valid arities:
  //   3 args  →  pos only
  //   7 args  →  pos + 'rot' marker + 3 rot values
  if (args.length !== 3 && args.length !== 7) {
    return err(
      'E05',
      `pivot expects 3 args (x y z) or 7 args (x y z rot rx ry rz), got ${args.length}`,
    );
  }

  const pos = parseVec3(args.slice(0, 3), 'pivot position');
  if (!pos.ok) return pos;

  if (args.length === 3) {
    return ok({ pos: pos.value });
  }

  if (args[3] !== 'rot') {
    return err('E05', `expected 'rot' as 4th token, got '${args[3]}'`);
  }

  const rot = parseVec3(args.slice(4, 7), 'pivot rotation');
  if (!rot.ok) return rot;

  return ok({ pos: pos.value, rot: rot.value });
}

function parseVec3(args: readonly string[], label: string): Result<Vec3> {
  const xs: number[] = [];
  for (const arg of args) {
    const n = parseFloatStrict(arg);
    if (n === null) {
      return err('E05', `${label} coord '${arg}' is not a number`);
    }
    xs.push(n);
  }
  return ok({ x: xs[0]!, y: xs[1]!, z: xs[2]! });
}
