import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import { expectIdentifier } from './expect.js';
import type { PartParser } from './part.js';
import type { Token } from './tokenize.js';
import type { Socket } from './types.js';
import { expectVec3 } from './vec3.js';

// SPEC §7.8: parses a `socket` declaration. Advances per-token:
// 1. Pull the name (quoted identifier) via expectIdentifier.
// 2. Early duplicate check via parent PartParser.hasSocketName(). Done
//    here (not in PartParser) because the dup condition depends on the
//    socket name, which is mid-parse — the inline-check-before-invoke
//    pattern used for size/pivot/voxels can't apply.
// 3. Pull the pos triple.
// 4. If next token is bare `rot`, advance and pull the rot triple.
//    Otherwise leave the next token for the caller (socket has no "extra
//    args" failure mode of its own).
export class SocketParser {
  constructor(
    private readonly cursor: TokenCursor,
    private readonly partParser: PartParser,
  ) {}

  parse(kw: Token): Result<Socket> {
    const nameR = expectIdentifier(this.cursor, kw, 'socket name');
    if (!nameR.ok) return nameR;
    const { value: name, token: nameTok } = nameR.value;

    if (this.partParser.hasSocketName(name)) {
      return err(
        'duplicate',
        `line ${nameTok.line}: duplicate socket "${name}"`,
      );
    }

    const posR = expectVec3(this.cursor, kw, 'socket position');
    if (!posR.ok) return posR;

    const next = this.cursor.peek();
    if (next === null || next.kind !== 'bare' || next.text !== 'rot') {
      return ok({ name, pos: posR.value });
    }
    this.cursor.advance();
    const rotR = expectVec3(this.cursor, kw, 'socket rotation');
    if (!rotR.ok) return rotR;
    return ok({ name, pos: posR.value, rot: rotR.value });
  }
}
