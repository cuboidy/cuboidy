import { stripComment } from './comment.js';

// Every token has a kind:
//   - `bare`   : whitespace-delimited token, includes reserved keywords (per
//                §7.3), reserved punctuation (`{` `}` `,`), color literals,
//                numbers, voxel rows, and free-form bare identifiers.
//   - `string` : a quoted string literal `"..."`. The `text` field carries
//                the content without the surrounding quotes. The lexer
//                requires the closing `"` on the same line; unmatched
//                opening `"` falls through to bare tokenization.
// kind drives §7.5 / §7.8 (identifier slots require `string`) and is used
// by `isReserved` to ensure a quoted `"part"` is never confused with the
// reserved keyword `part`.
export interface Token {
  text: string;
  line: number;
  col: number;
  kind: 'bare' | 'string';
}

// SPEC §7.1: per-line scanner. Whitespace separates tokens; `{` `}` `,` are
// always 1-char tokens; `"..."` is a string literal token. Comments (§7.11)
// are stripped before scanning.
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]!);
    tokenizeLine(line, i + 1, tokens);
  }
  return tokens;
}

function tokenizeLine(line: string, lineNo: number, out: Token[]): void {
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '{' || c === '}' || c === ',') {
      out.push({ text: c, line: lineNo, col: i + 1, kind: 'bare' });
      i++;
      continue;
    }
    if (c === '"') {
      const close = line.indexOf('"', i + 1);
      if (close !== -1) {
        out.push({
          text: line.slice(i + 1, close),
          line: lineNo,
          col: i + 1,
          kind: 'string',
        });
        i = close + 1;
        continue;
      }
      // Unmatched opening `"` — fall through to bare tokenization. The
      // resulting bare token will start with `"` and a downstream parser
      // (PartParser, SocketParser) will see kind='bare' where kind='string'
      // is required and surface a helpful error.
    }
    const start = i;
    while (i < line.length) {
      const cc = line[i]!;
      if (cc === ' ' || cc === '\t' || cc === '{' || cc === '}' || cc === ',' || cc === '"') {
        break;
      }
      i++;
    }
    out.push({
      text: line.slice(start, i),
      line: lineNo,
      col: start + 1,
      kind: 'bare',
    });
  }
}

export function isPunctuation(text: string): boolean {
  return text.length === 1 && (text === '{' || text === '}' || text === ',');
}
