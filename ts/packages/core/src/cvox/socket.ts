import { isIdentifier } from '../identifier.js';
import { err, ok, type Result } from '../result.js';
import { parseFloatStrict } from './numbers.js';
import type { Vec3 } from './vec3.js';

export interface Socket {
  name: string;
  pos: Vec3;
  rot?: Vec3;
}

export function parseSocket(args: readonly string[]): Result<Socket> {
  if (args.length !== 4 && args.length !== 8) {
    return err(
      'E06',
      `socket expects 4 args (name x y z) or 8 args (... rot rx ry rz), got ${args.length}`,
    );
  }

  const name = args[0]!;
  if (!isIdentifier(name)) {
    return err('E06', `invalid socket name '${name}'`);
  }

  const pos = parseVec3(args.slice(1, 4), 'socket position');
  if (!pos.ok) return pos;

  if (args.length === 4) {
    return ok({ name, pos: pos.value });
  }

  if (args[4] !== 'rot') {
    return err('E06', `expected 'rot' as 5th token, got '${args[4]}'`);
  }

  const rot = parseVec3(args.slice(5, 8), 'socket rotation');
  if (!rot.ok) return rot;

  return ok({ name, pos: pos.value, rot: rot.value });
}

function parseVec3(args: readonly string[], label: string): Result<Vec3> {
  const xs: number[] = [];
  for (const arg of args) {
    const n = parseFloatStrict(arg);
    if (n === null) {
      return err('E06', `${label} coord '${arg}' is not a number`);
    }
    xs.push(n);
  }
  return ok({ x: xs[0]!, y: xs[1]!, z: xs[2]! });
}
