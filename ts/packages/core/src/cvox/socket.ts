import { isIdentifier } from '../identifier.js';
import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import type { Token } from './tokenize.js';
import { parseVec3, type Vec3 } from './vec3.js';

export interface Socket {
  name: string;
  pos: Vec3;
  rot?: Vec3;
}

export function parseSocket(args: readonly string[]): Result<Socket> {
  if (args.length !== 4 && args.length !== 8) {
    return err(
      'wrong-arity',
      `socket expects 4 args (name x y z) or 8 args (... rot rx ry rz), got ${args.length}`,
    );
  }

  const name = args[0]!;
  if (!isIdentifier(name)) {
    return err('invalid-value', `invalid socket name '${name}'`);
  }

  const pos = parseVec3(args.slice(1, 4), 'invalid-value', 'socket position');
  if (!pos.ok) return pos;

  if (args.length === 4) {
    return ok({ name, pos: pos.value });
  }

  if (args[4] !== 'rot') {
    return err('invalid-value', `expected 'rot' as 5th token, got '${args[4]}'`);
  }

  const rot = parseVec3(args.slice(5, 8), 'invalid-value', 'socket rotation');
  if (!rot.ok) return rot;

  return ok({ name, pos: pos.value, rot: rot.value });
}

// SPEC §7.8: parses a `socket` declaration. Pure (no parent state ref).
// Pulls 4 args (name + pos triple), then peeks for the `rot` sub-keyword
// to optionally pull 3 more. The duplicate check (socket name unique
// within a part) happens in the caller — PartParser — after this returns.
export class SocketParser {
  constructor(private readonly cursor: TokenCursor) {}

  parse(kw: Token): Result<Socket> {
    const args = this.cursor.pullArgs(4);
    if (this.cursor.peek()?.text === 'rot') {
      args.push(this.cursor.advance()!.text);
      args.push(...this.cursor.pullArgs(3));
    }
    const r = parseSocket(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    return r;
  }
}
