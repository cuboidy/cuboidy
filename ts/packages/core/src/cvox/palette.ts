import { err, ok, type Result } from '../result.js';

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
    return err('E17', 'palette declaration requires at least one color');
  }
  if (args.length > MAX_PALETTE) {
    return err(
      'E16',
      `palette has ${args.length} colors, max ${MAX_PALETTE}`,
    );
  }

  const colors: Color[] = [];
  for (const arg of args) {
    const color = parseHexColor(arg);
    if (color === null) {
      return err('E02', `invalid color '${arg}'`);
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
