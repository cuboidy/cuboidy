import type { Token } from './tokenize.js';

// Stream-walking primitive over the token sequence. Each production parser
// holds a reference to the same TokenCursor — they share the position state.
// No type-validation here; the cursor only walks. Each parser owns its own
// peek + EOF + advance + per-type validation, so the "what does this slot
// expect" check is kept next to the slot semantics.
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
