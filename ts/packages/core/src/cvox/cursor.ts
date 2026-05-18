import { isReserved } from './reserved.js';
import type { Token } from './tokenize.js';

// Stream-walking primitive over the token sequence. Each production parser
// holds a reference to the same TokenCursor — they share the position state.
// SPEC §7.2: pullArgs stops at the next reserved token (keyword or
// punctuation), enforcing the "reserved tokens never participate in
// identifier slots" rule mechanically.
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

  pullArgs(max: number): string[] {
    const args: string[] = [];
    while (args.length < max && this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!;
      if (isReserved(t.text)) break;
      args.push(t.text);
      this.pos++;
    }
    return args;
  }
}
