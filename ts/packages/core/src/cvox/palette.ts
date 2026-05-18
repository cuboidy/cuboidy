import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import type { FileState } from './file-state.js';
import type { Token } from './tokenize.js';

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type Palette = readonly Color[];

const MAX_PALETTE = 62;

const HEX_RE = /^#([0-9a-fA-F]+)$/;

export function parsePalette(args: readonly string[]): Result<Palette> {
  if (args.length === 0) {
    return err(
      'wrong-arity',
      'palette declaration requires at least one color',
    );
  }
  if (args.length > MAX_PALETTE) {
    return err(
      'wrong-arity',
      `palette has ${args.length} colors, max ${MAX_PALETTE}`,
    );
  }

  const colors: Color[] = [];
  for (const arg of args) {
    const color = parseHexColor(arg);
    if (color === null) {
      return err('invalid-value', `invalid color '${arg}'`);
    }
    colors.push(color);
  }
  return ok(colors);
}

function parseHexColor(s: string): Color | null {
  const m = HEX_RE.exec(s);
  if (!m) return null;
  const hex = m[1]!;
  switch (hex.length) {
    case 3:
      return {
        r: dup(hex, 0),
        g: dup(hex, 1),
        b: dup(hex, 2),
        a: 0xff,
      };
    case 4:
      return {
        r: dup(hex, 0),
        g: dup(hex, 1),
        b: dup(hex, 2),
        a: dup(hex, 3),
      };
    case 6:
      return {
        r: pair(hex, 0),
        g: pair(hex, 2),
        b: pair(hex, 4),
        a: 0xff,
      };
    case 8:
      return {
        r: pair(hex, 0),
        g: pair(hex, 2),
        b: pair(hex, 4),
        a: pair(hex, 6),
      };
    default:
      return null;
  }
}

function dup(hex: string, i: number): number {
  const c = hex[i]!;
  return parseInt(c + c, 16);
}

function pair(hex: string, i: number): number {
  return parseInt(hex.slice(i, i + 2), 16);
}

// SPEC §7.4: parses a `palette` declaration from the token stream and
// writes to FileState. Detects duplicate palette declarations (only one
// allowed per file). Pulls args until the next reserved token (so a stray
// non-color token after palette would surface as `invalid-value` from
// parsePalette, not by stealing into another production).
export class PaletteParser {
  constructor(
    private readonly cursor: TokenCursor,
    private readonly fileState: FileState,
  ) {}

  parse(kw: Token): Result<void> {
    if (this.fileState.palette !== null) {
      return err(
        'duplicate',
        `line ${kw.line}: duplicate palette declaration (first at line ${this.fileState.paletteLineNo})`,
      );
    }
    const args = this.cursor.pullArgs(Number.POSITIVE_INFINITY);
    const r = parsePalette(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    this.fileState.palette = r.value;
    this.fileState.paletteLineNo = kw.line;
    return ok(undefined);
  }
}
