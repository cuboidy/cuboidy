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

// SPEC §7.6: parses a `size` declaration. Advances per-token. Per-arg errors
// (kind mismatch, non-integer, range) reference the offending dimension's
// own line; EOF references the `size` keyword line. A bare reserved token
// like `part` lands in the `parseNonNegInt` branch — "got 'part'" — which
// is the correct framing: size expected a number, the user supplied
// something that isn't one. The duplicate check (at most one size per
// part) happens in the caller — PartParser — immediately before this is
// invoked.
export class SizeParser {
  constructor(private readonly cursor: TokenCursor) {}

  parse(kw: Token): Result<Size> {
    const labels = ['W', 'H', 'D'] as const;
    const xs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = this.cursor.peek();
      if (t === null) {
        return err(
          'wrong-arity',
          `line ${kw.line}: size expects 3 args (W H D), got ${i}`,
        );
      }
      this.cursor.advance();
      if (t.kind !== 'bare') {
        return err(
          'invalid-value',
          `line ${t.line}: size dimension ${labels[i]} expects a number, got quoted string "${t.text}"`,
        );
      }
      const n = parseNonNegInt(t.text);
      if (n === null) {
        return err(
          'invalid-value',
          `line ${t.line}: size dimension ${labels[i]} expects a non-negative integer, got '${t.text}'`,
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
