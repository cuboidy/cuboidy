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

// SPEC §7.8: parses a `socket` declaration. The socket name is the first
// arg, so this parser pulls the name first, then calls the parent
// PartParser's hasSocketName() accessor for early duplicate detection
// BEFORE pulling the pos triple + optional rot. This avoids wasted token
// pulls when the socket name is a duplicate. Other sub-parsers (size,
// pivot, voxels) can do duplicate check in PartParser before invoking the
// sub-parser because their "duplicate" condition is "field already set" —
// which the caller knows without parsing. Socket is unique in that the
// duplicate condition is "name already seen", and the name is mid-parse.
export class SocketParser {
  constructor(
    private readonly cursor: TokenCursor,
    private readonly partParser: PartParser,
  ) {}

  parse(kw: Token): Result<Socket> {
    // Pull the name first.
    const nameArgs = this.cursor.pullArgs(1);
    if (nameArgs.length !== 1) {
      return err(
        'wrong-arity',
        `line ${kw.line}: socket expects an identifier name`,
      );
    }
    const name = nameArgs[0]!;
    if (!isIdentifier(name)) {
      return err(
        'invalid-value',
        `line ${kw.line}: invalid socket name '${name}'`,
      );
    }

    // Early duplicate check via parent PartParser. If duplicate, return
    // before pulling pos/rot args.
    if (this.partParser.hasSocketName(name)) {
      return err(
        'duplicate',
        `line ${kw.line}: duplicate socket '${name}' in part '${this.partParser.getName()}'`,
      );
    }

    // Pull pos triple, then peek for `rot` sub-keyword.
    const restArgs = this.cursor.pullArgs(3);
    if (this.cursor.peek()?.text === 'rot') {
      restArgs.push(this.cursor.advance()!.text);
      restArgs.push(...this.cursor.pullArgs(3));
    }
    // Reuse parseSocket for full pos/rot validation. It will re-validate
    // the name (cheap idempotent check) — keeps a single source of truth
    // for the Socket value shape.
    const r = parseSocket([name, ...restArgs]);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    return r;
  }
}
