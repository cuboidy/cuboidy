import { err, ok, type Result } from '../result.js';
import { isReserved } from './reserved.js';
import type { Token } from './tokenize.js';

// Stream-walking primitive over the token sequence. Each production parser
// holds a reference to the same TokenCursor — they share the position state.
export class TokenCursor {
  private pos = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  peek(): Token | null {
    return this.tokens[this.pos] ?? null;
  }

  advance(): Token | null {
    const t = this.tokens[this.pos];
    if (t === undefined) return null;
    this.pos++;
    return t;
  }

  hasMore(): boolean {
    return this.pos < this.tokens.length;
  }
}

// Pulls one value-token (non-reserved, non-EOF) and advances. Returns
// wrong-arity with the offending token's line if the next token is reserved
// or the stream is exhausted. Used by production parsers that need a fixed
// number of value-tokens (size, vec3 triples, identifier names). The
// returned Token preserves per-token line/col so downstream type-check
// errors (e.g. "'abc' is not a number") can point at the exact token.
export function expectValue(
  cursor: TokenCursor,
  kw: Token,
  label: string,
  expected: number,
  have: number,
): Result<Token> {
  const t = cursor.peek();
  if (t === null) {
    return err(
      'wrong-arity',
      `line ${kw.line}: ${label} expects ${expected} arg(s), got ${have}`,
    );
  }
  if (isReserved(t)) {
    return err(
      'wrong-arity',
      `line ${kw.line}: ${label} expects ${expected} arg(s), got ${have} before reserved '${t.text}' at line ${t.line}`,
    );
  }
  cursor.advance();
  return ok(t);
}
