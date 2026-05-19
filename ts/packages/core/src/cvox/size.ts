import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import { parseNonNegInt } from './numbers.js';
import type { Token } from './tokenize.js';

export interface Size {
  w: number;
  h: number;
  d: number;
}

const SIZE_MIN = 1;
const SIZE_MAX = 1024;

export function parseSize(args: readonly string[]): Result<Size> {
  if (args.length !== 3) {
    return err(
      'wrong-arity',
      `size expects 3 args (W H D), got ${args.length}`,
    );
  }
  const parsed: number[] = [];
  for (const arg of args) {
    const n = parseNonNegInt(arg);
    if (n === null) {
      return err(
        'invalid-value',
        `size dimension '${arg}' is not a non-negative integer`,
      );
    }
    if (n < SIZE_MIN || n > SIZE_MAX) {
      return err(
        'invalid-value',
        `size dimension ${n} is out of range [${SIZE_MIN}..${SIZE_MAX}]`,
      );
    }
    parsed.push(n);
  }
  return ok({ w: parsed[0]!, h: parsed[1]!, d: parsed[2]! });
}

// SPEC §7.6: parses a `size` declaration. Pure (no parent state ref). The
// duplicate check (at most one size per part) happens in the caller —
// PartParser — immediately before this is invoked.
export class SizeParser {
  constructor(private readonly cursor: TokenCursor) {}

  parse(kw: Token): Result<Size> {
    const args = this.cursor.pullArgs(3);
    const r = parseSize(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    return r;
  }
}
