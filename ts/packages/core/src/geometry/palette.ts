import type { Color } from './types.js';

// SPEC §7.4: the colour codec, shared by a geometry file's own palette and the
// external palette file (§6.10) — both use the same grammar and the same
// 62-slot index space.
export const MAX_PALETTE = 62;

const HEX_RE = /^#([0-9a-fA-F]+)$/;

export function parseHexColor(s: string): Color | null {
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

// Canonical colour form: `#RRGGBB` when alpha = 0xFF, `#RRGGBBAA` otherwise.
// Short forms (`#RGB`, `#RGBA`) are reader-accepted but not writer-emitted —
// canonical output has exactly one representation per colour value.
export function serializeColor(c: Color): string {
  const rgb = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a === 0xff ? rgb : `${rgb}${hex2(c.a)}`;
}

function dup(hex: string, i: number): number {
  const c = hex[i]!;
  return parseInt(c + c, 16);
}

function pair(hex: string, i: number): number {
  return parseInt(hex.slice(i, i + 2), 16);
}

function hex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0');
}
