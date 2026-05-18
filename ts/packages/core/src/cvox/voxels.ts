import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import type { PartBuilder } from './cvox-state.js';
import type { Token } from './tokenize.js';

// Raw voxel-row tokens collected during parsing, validated later by
// FileState.assemble against the part's size and the file's palette.

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

// SPEC §7.9: parses a `voxels { ... }` block. Owns its own inner loop —
// dispatches `}` (block close), `,` (layer-section separator), `{` (nested
// error), and any other token (voxel-row candidate). Reserved keywords from
// other scopes are treated as voxel-row strings here (lexical isolation
// per SPEC §7.3.4).
export class VoxelsParser {
  constructor(
    private readonly cursor: TokenCursor,
    private readonly builder: PartBuilder,
  ) {}

  parse(kw: Token): Result<void> {
    if (this.builder.voxels !== null) {
      return err(
        'duplicate',
        `line ${kw.line}: duplicate voxels block for part '${this.builder.name}' (first at line ${this.builder.voxels.voxelsLine})`,
      );
    }

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

    // Inner loop: parse body until `}`
    const sections: RawSection[] = [];
    let current: RawSection = { rows: [], startLine: kw.line };
    while (this.cursor.hasMore()) {
      const t = this.cursor.advance()!;
      switch (t.text) {
        case '}':
          sections.push(current);
          this.builder.voxels = { sections, voxelsLine: kw.line };
          return ok(undefined);
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
      }
    }
    return err(
      'missing',
      `line ${kw.line}: unclosed voxels block (no matching '}')`,
    );
  }
}
