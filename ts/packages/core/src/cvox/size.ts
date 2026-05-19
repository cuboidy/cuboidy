import { err, ok, type Result } from '../result.js';
import { expectValue, type TokenCursor } from './cursor.js';
import { parseNonNegInt } from './numbers.js';
import type { Token } from './tokenize.js';

export interface Size {
  w: number;
  h: number;
  d: number;
}

const SIZE_MIN = 1;
const SIZE_MAX = 1024;

// SPEC §7.6: parses a `size` declaration. Advances per-token so type and
// range errors reference the offending dimension's own line. Arity errors
// fall back to the `size` keyword's line (since the missing arg has no
// line). The duplicate check (at most one size per part) happens in the
// caller — PartParser — immediately before this is invoked.
export class SizeParser {
  constructor(private readonly cursor: TokenCursor) {}

  parse(kw: Token): Result<Size> {
    const labels = ['W', 'H', 'D'] as const;
    const xs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const tR = expectValue(this.cursor, kw, 'size', 3, i);
      if (!tR.ok) return tR;
      const t = tR.value;
      const n = parseNonNegInt(t.text);
      if (n === null) {
        return err(
          'invalid-value',
          `line ${t.line}: size dimension ${labels[i]} '${t.text}' is not a non-negative integer`,
        );
      }
      if (n < SIZE_MIN || n > SIZE_MAX) {
        return err(
          'invalid-value',
          `line ${t.line}: size dimension ${labels[i]}=${n} is out of range [${SIZE_MIN}..${SIZE_MAX}]`,
        );
      }
      xs.push(n);
    }
    return ok({ w: xs[0]!, h: xs[1]!, d: xs[2]! });
  }
}
