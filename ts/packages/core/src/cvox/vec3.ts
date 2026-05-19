import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import { parseFloatStrict } from './numbers.js';
import type { Token } from './tokenize.js';

// Shared 3-component vector. Used for both positions (voxel units) and
// rotations (Euler degrees, ZXY order per SPEC §4). TypeScript is structural,
// so this is one type — distinction is carried by field names (`pos` / `rot`)
// on the enclosing interface, not by nominal type.
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Pulls 3 numeric value-tokens from the cursor and assembles a Vec3. Used
// by PivotParser and SocketParser for both pos and (optional) rot triples.
// `label` is used in error messages (e.g. 'pivot position', 'socket
// rotation'). Errors include the offending token's line: arity errors
// reference the keyword line, type-mismatch errors reference the bad
// token's line. A bare reserved word (e.g. `rot`, `part`) lands in the
// "got 'X'" branch — the slot wants a number, the user supplied something
// that isn't.
export function pullVec3(
  cursor: TokenCursor,
  kw: Token,
  label: string,
): Result<Vec3> {
  const axes = ['x', 'y', 'z'] as const;
  const xs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = cursor.peek();
    if (t === null) {
      return err(
        'wrong-arity',
        `line ${kw.line}: ${label} expects 3 args, got ${i}`,
      );
    }
    cursor.advance();
    if (t.kind !== 'bare') {
      return err(
        'invalid-value',
        `line ${t.line}: ${label} ${axes[i]} expects a number, got quoted string "${t.text}"`,
      );
    }
    const n = parseFloatStrict(t.text);
    if (n === null) {
      return err(
        'invalid-value',
        `line ${t.line}: ${label} ${axes[i]} expects a number, got '${t.text}'`,
      );
    }
    xs.push(n);
  }
  return ok({ x: xs[0]!, y: xs[1]!, z: xs[2]! });
}
