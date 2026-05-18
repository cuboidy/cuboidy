import { stripComment } from './comment.js';

export interface Token {
  text: string;
  line: number;
  col: number;
}

// SPEC §7.1: After per-line comment stripping (// to end-of-line), the rest
// of the file is tokenized into a single token stream. Tokens are separated
// by any whitespace (space, tab, newline). The Layer 1 universal punctuation
// `{` `}` `,` are always 1-character tokens — they require no surrounding
// whitespace and never appear inside any other token.
const PUNCT_RE = /[{},]/;
const TOKEN_RE = /[{},]|[^\s{},]+/g;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]!);
    const lineNo = i + 1;
    TOKEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOKEN_RE.exec(line)) !== null) {
      tokens.push({ text: m[0], line: lineNo, col: m.index + 1 });
    }
  }
  return tokens;
}

export function isPunctuation(text: string): boolean {
  return text.length === 1 && PUNCT_RE.test(text);
}
