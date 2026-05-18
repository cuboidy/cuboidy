import { err, ok, type Result } from '../result.js';
import { parseVec3, type Vec3 } from './vec3.js';

export interface Pivot {
  pos: Vec3;
  rot?: Vec3;
}

export function parsePivot(args: readonly string[]): Result<Pivot> {
  // 3 args (pos) or 7 args (pos + 'rot' marker + 3 rot values).
  if (args.length !== 3 && args.length !== 7) {
    return err(
      'wrong-arity',
      `pivot expects 3 args (x y z) or 7 args (x y z rot rx ry rz), got ${args.length}`,
    );
  }

  const pos = parseVec3(args.slice(0, 3), 'invalid-value', 'pivot position');
  if (!pos.ok) return pos;

  if (args.length === 3) {
    return ok({ pos: pos.value });
  }

  if (args[3] !== 'rot') {
    return err('invalid-value', `expected 'rot' as 4th token, got '${args[3]}'`);
  }

  const rot = parseVec3(args.slice(4, 7), 'invalid-value', 'pivot rotation');
  if (!rot.ok) return rot;

  return ok({ pos: pos.value, rot: rot.value });
}
