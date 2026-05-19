import { isIdentifier } from '../identifier.js';
import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import type { PartParser } from './part.js';
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

// SPEC §7.8: parses a `socket` declaration. Pulls 4 args (name + pos
// triple), then peeks for the `rot` sub-keyword to optionally pull 3 more.
// Calls parent PartParser's hasSocketName() accessor to detect duplicate
// socket names. Returns the parsed Socket; the caller appends it.
export class SocketParser {
  constructor(
    private readonly cursor: TokenCursor,
    private readonly partParser: PartParser,
  ) {}

  parse(kw: Token): Result<Socket> {
    const args = this.cursor.pullArgs(4);
    if (this.cursor.peek()?.text === 'rot') {
      args.push(this.cursor.advance()!.text);
      args.push(...this.cursor.pullArgs(3));
    }
    const r = parseSocket(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    if (this.partParser.hasSocketName(r.value.name)) {
      return err(
        'duplicate',
        `line ${kw.line}: duplicate socket '${r.value.name}' in part '${this.partParser.getName()}'`,
      );
    }
    return r;
  }
}
