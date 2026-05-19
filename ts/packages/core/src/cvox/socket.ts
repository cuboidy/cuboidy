import { isIdentifier } from '../identifier.js';
import { err, ok, type Result } from '../result.js';
import { expectValue, type TokenCursor } from './cursor.js';
import type { PartParser } from './part.js';
import type { Token } from './tokenize.js';
import { pullVec3, type Vec3 } from './vec3.js';

export interface Socket {
  name: string;
  pos: Vec3;
  rot?: Vec3;
}

// SPEC §7.8: parses a `socket` declaration. Advances per-token:
// 1. Pull the name (identifier) — required.
// 2. Early duplicate check via parent PartParser.hasSocketName(). Done
//    here (not in PartParser) because the dup condition depends on the
//    socket name, which is mid-parse — the inline-check-before-invoke
//    pattern used for size/pivot/voxels can't apply.
// 3. Pull the pos triple.
// 4. If next token is `rot`, advance and pull the rot triple. Otherwise
//    leave the next token for the caller (socket has no "extra args"
//    failure mode of its own).
export class SocketParser {
  constructor(
    private readonly cursor: TokenCursor,
    private readonly partParser: PartParser,
  ) {}

  parse(kw: Token): Result<Socket> {
    const nameR = expectValue(this.cursor, kw, 'socket', 4, 0);
    if (!nameR.ok) return nameR;
    const nameTok = nameR.value;
    if (nameTok.kind !== 'string') {
      return err(
        'invalid-value',
        `line ${nameTok.line}: socket expects a quoted identifier name (e.g. "hat"), got bare token '${nameTok.text}'`,
      );
    }
    const name = nameTok.text;
    if (!isIdentifier(name)) {
      return err(
        'invalid-value',
        `line ${nameTok.line}: invalid socket name "${name}"`,
      );
    }

    if (this.partParser.hasSocketName(name)) {
      return err(
        'duplicate',
        `line ${nameTok.line}: duplicate socket "${name}" in part "${this.partParser.getName()}"`,
      );
    }

    const posR = pullVec3(this.cursor, kw, 'socket position');
    if (!posR.ok) return posR;

    if (this.cursor.peek()?.text !== 'rot') {
      return ok({ name, pos: posR.value });
    }
    this.cursor.advance();
    const rotR = pullVec3(this.cursor, kw, 'socket rotation');
    if (!rotR.ok) return rotR;
    return ok({ name, pos: posR.value, rot: rotR.value });
  }
}
