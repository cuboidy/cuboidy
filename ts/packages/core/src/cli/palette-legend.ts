import type { Palette } from '../geometry/types.js';
import { serializeColor } from '../geometry/palette.js';
import { indexToChar } from '../geometry/voxel-row.js';

// The palette legend the CLIs print, one entry per slot, through the
// same serializeColor the writer uses — this replaced three hand-rolled
// hex formatters that could drift from the canonical §7.4 form.

function entries(palette: Palette): Array<{ char: string; hex: string }> {
  return palette.map((c, i) => ({ char: indexToChar(i), hex: serializeColor(c) }));
}

// Multi-line block (cuboidy-view / cuboidy-snap):
//   palette:
//     0 = #FF0000
export function formatPaletteBlock(palette: Palette): string {
  return ['palette:', ...entries(palette).map((e) => `  ${e.char} = ${e.hex}`)].join('\n');
}

// Single line (cuboidy-query): `palette: 0=#FF0000 1=#00FF00`.
export function formatPaletteLine(palette: Palette): string {
  return `palette: ${entries(palette)
    .map((e) => `${e.char}=${e.hex}`)
    .join(' ')}`;
}
