import { err, ok, type Result } from '../result.js';
import { stripComment } from './comment.js';

// Every token has a kind:
//   - `bare`   : whitespace-delimited token, includes reserved keywords (per
//                §7.3), reserved punctuation (`{` `}` `,`), color literals,
//                numbers, voxel rows, and identifiers.
//   - `string` : a quoted string literal `"..."`. The `text` field carries
//                the content without the surrounding quotes. No v0.5
//                cvox production accepts string-kind in a slot — they
//                surface as `invalid-value`. The kind is preserved at
//                the lexer level for future use.
// An unmatched opening `"` is a *lexical* error (the lexer cannot produce
// a well-formed token stream) and the tokenizer returns `err` directly,
// not a fall-through bare token — the failure belongs to the lex layer,
// not parse.
export interface Token {
  text: string;
  line: number;
  col: number;
  kind: 'bare' | 'string';
}

// SPEC §7.1: per-line scanner. Whitespace separates tokens; `{` `}` `,` are
// always 1-char tokens; `"..."` is a string literal token. Comments (§7.11)
// are stripped before scanning. Returns `err('invalid-value', …)` on an
// unmatched opening `"`.
export function tokenize(input: string): Result<Token[]> {
  const tokens: Token[] = [];
  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineErr = tokenizeLine(stripComment(lines[i]!), i + 1, tokens);
    if (lineErr !== null) return lineErr;
  }
  return ok(tokens);
}

function tokenizeLine(
  line: string,
  lineNo: number,
  out: Token[],
): Result<Token[]> | null {
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
      if (close === -1) {
        return err(
          'invalid-value',
          `line ${lineNo}: col ${i + 1}: unterminated string literal (no closing '"' on this line)`,
        );
      }
      out.push({
        text: line.slice(i + 1, close),
        line: lineNo,
        col: i + 1,
        kind: 'string',
      });
      i = close + 1;
      continue;
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
  return null;
}
