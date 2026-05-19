import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import type { Token } from './tokenize.js';

// Raw voxel-row tokens collected during parsing, validated later by
// CvoxParser.assemble against the part's size and the file's palette.

export interface RawRow {
  text: string;
  line: number;
  col: number;
}

export interface RawSection {
  rows: RawRow[];
  startLine: number;
}

export interface RawVoxels {
  sections: RawSection[];
  voxelsLine: number;
}

// SPEC §7.9: parses a `voxels { ... }` block. Pure (no parent state ref).
// Owns its own inner loop — dispatches `}` (block close), `,` (layer-
// section separator), `{` (nested error), and any other token (voxel-row
// candidate). Reserved keywords from other scopes are treated as voxel-
// row strings here (lexical isolation per SPEC §7.3.4). The duplicate
// check (at most one voxels block per part) happens in the caller —
// PartParser — immediately before this is invoked, so a duplicate voxels
// keyword doesn't even start the body loop.
export class VoxelsParser {
  constructor(private readonly cursor: TokenCursor) {}

  parse(kw: Token): Result<RawVoxels> {
    // Expect opening `{`
    const open = this.cursor.peek();
    if (open === null) {
      return err(
        'wrong-arity',
        `line ${kw.line}: 'voxels' must be followed by '{' (got end of file)`,
      );
    }
    if (open.text !== '{') {
      return err(
        'wrong-arity',
        `line ${open.line}: 'voxels' must be followed by '{' (got '${open.text}')`,
      );
    }
    this.cursor.advance();

    // Inner loop: parse body until `}`. The block-structural punctuation
    // (`{` `}` `,`) is bare-only — a string-kind token, even with text
    // matching one of those characters, is treated as a voxel-row candidate
    // and rejected since string tokens have no role inside a voxels block.
    const sections: RawSection[] = [];
    let current: RawSection = { rows: [], startLine: kw.line };
    while (this.cursor.hasMore()) {
      const t = this.cursor.advance()!;
      if (t.kind === 'bare') {
        switch (t.text) {
          case '}':
            sections.push(current);
            return ok({ sections, voxelsLine: kw.line });
          case ',':
            sections.push(current);
            current = { rows: [], startLine: t.line };
            continue;
          case '{':
            return err(
              'invalid-value',
              `line ${t.line}: unexpected '{' inside voxels block (no nesting)`,
            );
          default:
            current.rows.push({ text: t.text, line: t.line, col: t.col });
            continue;
        }
      }
      return err(
        'invalid-value',
        `line ${t.line}: unexpected quoted string "${t.text}" inside voxels block (strings have no role here)`,
      );
    }
    return err(
      'missing',
      `line ${kw.line}: unclosed voxels block (no matching '}')`,
    );
  }
}
