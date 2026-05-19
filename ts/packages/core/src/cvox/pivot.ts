import { ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import type { Token } from './tokenize.js';
import { pullVec3, type Vec3 } from './vec3.js';

export interface Pivot {
  pos: Vec3;
  rot?: Vec3;
}

// SPEC §7.7: parses a `pivot` declaration. Pulls the pos triple, then peeks
// for the `rot` sub-keyword to optionally pull the rot triple. Any token
// after the pos triple that isn't `rot` is left for the caller to dispatch
// — pivot has no "extra args" failure mode of its own. The duplicate check
// (at most one pivot per part) happens in the caller — PartParser —
// immediately before this is invoked.
export class PivotParser {
  constructor(private readonly cursor: TokenCursor) {}

  parse(kw: Token): Result<Pivot> {
    const posR = pullVec3(this.cursor, kw, 'pivot position');
    if (!posR.ok) return posR;
    if (this.cursor.peek()?.text !== 'rot') {
      return ok({ pos: posR.value });
    }
    this.cursor.advance();
    const rotR = pullVec3(this.cursor, kw, 'pivot rotation');
    if (!rotR.ok) return rotR;
    return ok({ pos: posR.value, rot: rotR.value });
  }
}
