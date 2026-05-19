import { ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import { expectNumber } from './expect.js';
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

// Expects 3 numeric value-tokens from the cursor and assembles a Vec3.
// Used by PivotParser and SocketParser for both pos and (optional) rot
// triples. `label` is used in error messages (e.g. 'pivot position',
// 'socket rotation') and gets the axis appended per coord.
//
// Sibling of the single-token expect* family in expect.ts — kept here
// because it composes from expectNumber and produces the Vec3 type
// declared in this file. Naming convention: expect* = "assert a typed
// value at the cursor head", whether single-token (expectNumber) or
// multi-token-composed (expectVec3).
export function expectVec3(
  cursor: TokenCursor,
  kw: Token,
  label: string,
): Result<Vec3> {
  const axes = ['x', 'y', 'z'] as const;
  const xs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = expectNumber(cursor, kw, `${label} ${axes[i]}`);
    if (!r.ok) return r;
    xs.push(r.value.value);
  }
  return ok({ x: xs[0]!, y: xs[1]!, z: xs[2]! });
}
