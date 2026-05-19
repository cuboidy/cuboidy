import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import { expectNonNegInt } from './expect.js';
import type { Token } from './tokenize.js';

export interface Size {
  w: number;
  h: number;
  d: number;
}

const SIZE_MIN = 1;
const SIZE_MAX = 1024;

// SPEC §7.6: parses a `size` declaration. Pulls 3 non-negative integers
// via expectNonNegInt (which handles EOF, kind mismatch, and non-integer
// text), then range-checks each. Range errors reference the offending
// token's own line (preserved through the Expected<T> wrapper).
export class SizeParser {
  constructor(private readonly cursor: TokenCursor) {}

  parse(kw: Token): Result<Size> {
    const labels = ['W', 'H', 'D'] as const;
    const xs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = expectNonNegInt(this.cursor, kw, `size dimension ${labels[i]}`);
      if (!r.ok) return r;
      const { value: n, token } = r.value;
      if (n < SIZE_MIN || n > SIZE_MAX) {
        return err(
          'invalid-value',
          `line ${token.line}: size dimension ${labels[i]}=${n} is out of range [${SIZE_MIN}..${SIZE_MAX}]`,
        );
      }
      xs.push(n);
    }
    return ok({ w: xs[0]!, h: xs[1]!, d: xs[2]! });
  }
}
