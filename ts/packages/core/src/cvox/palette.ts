import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import type { CvoxParser } from './parse.js';
import { isReserved } from './reserved.js';
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

// SPEC §7.4: parses a `palette` declaration. Variable arity (1..62 colors)
// so it uses an open loop that consumes value-tokens until a reserved
// token or EOF. Per-color errors (invalid hex, over-max) reference that
// color's token line. Calls parent CvoxParser's hasPalette() accessor to
// detect duplicate palette declarations.
export class PaletteParser {
  constructor(
    private readonly cursor: TokenCursor,
    private readonly cvoxParser: CvoxParser,
  ) {}

  parse(kw: Token): Result<Palette> {
    if (this.cvoxParser.hasPalette()) {
      return err(
        'duplicate',
        `line ${kw.line}: duplicate palette declaration (first at line ${this.cvoxParser.getPaletteLineNo()})`,
      );
    }
    const colors: Color[] = [];
    while (true) {
      const t = this.cursor.peek();
      if (t === null || isReserved(t)) break;
      this.cursor.advance();
      if (t.kind !== 'bare') {
        return err(
          'invalid-value',
          `line ${t.line}: palette expects bare color literal, got quoted string "${t.text}"`,
        );
      }
      const color = parseHexColor(t.text);
      if (color === null) {
        return err('invalid-value', `line ${t.line}: invalid color '${t.text}'`);
      }
      if (colors.length >= MAX_PALETTE) {
        return err(
          'wrong-arity',
          `line ${t.line}: palette exceeds max ${MAX_PALETTE} colors`,
        );
      }
      colors.push(color);
    }
    if (colors.length === 0) {
      return err(
        'wrong-arity',
        `line ${kw.line}: palette declaration requires at least one color`,
      );
    }
    return ok(colors);
  }
}
