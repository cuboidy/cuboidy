import { stripComment } from './comment.js';

export interface Token {
  text: string;
  line: number;
  col: number;
}

// SPEC §7.1: After per-line comment stripping (// to end-of-line), the rest
// of the file is treated as a single token stream separated by any whitespace
// (spaces, tabs, newlines). Newlines do NOT terminate keyword args.
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]!);
    const lineNo = i + 1;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      tokens.push({ text: m[0], line: lineNo, col: m.index + 1 });
    }
  }
  return tokens;
}
