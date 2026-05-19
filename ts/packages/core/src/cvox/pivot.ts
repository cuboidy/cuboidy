import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import type { Token } from './tokenize.js';
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

// SPEC §7.7: parses a `pivot` declaration. Pure (no parent state ref).
// Pulls 3 pos args, then peeks for the `rot` sub-keyword to optionally
// pull 3 more rot args. Extras beyond the 3 (or 7) fall through to the
// caller's loop (per §7.2). The duplicate check (at most one pivot per
// part) happens in the caller — PartParser — immediately before this is
// invoked.
export class PivotParser {
  constructor(private readonly cursor: TokenCursor) {}

  parse(kw: Token): Result<Pivot> {
    const args = this.cursor.pullArgs(3);
    if (this.cursor.peek()?.text === 'rot') {
      args.push(this.cursor.advance()!.text);
      args.push(...this.cursor.pullArgs(3));
    }
    const r = parsePivot(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    return r;
  }
}
