import type { Palette, PaletteEntry } from '../geometry/types.js';
import { MATTE, isMatte, serializeColor } from '../geometry/palette.js';
import { indexToChar } from '../geometry/voxel-row.js';

// The palette legend the CLIs print, one entry per slot, through the
// same serializeColor the writer uses — this replaced three hand-rolled
// hex formatters that could drift from the canonical §7.4 form.
//
// The material is printed too, and only when it is not the default. Two
// entries that differ only in finish are two entries — they take two
// palette slots and paint differently — so a legend showing just the hex
// would render them indistinguishable, which is exactly the sort of "the
// tool says they are the same" that sends you looking in the wrong place.

// `metallic=1 roughness=0.08`, or '' for a plain matte entry.
function materialOf(e: PaletteEntry): string {
  const m = e.material;
  const parts: string[] = [];
  if (m.metallic !== MATTE.metallic) parts.push(`metallic=${m.metallic}`);
  if (m.roughness !== MATTE.roughness) parts.push(`roughness=${m.roughness}`);
  if (m.emissive !== MATTE.emissive) parts.push(`emissive=${m.emissive}`);
  return parts.join(' ');
}

function entries(
  palette: Palette,
): Array<{ char: string; hex: string; material: string }> {
  return palette.map((c, i) => ({
    char: indexToChar(i),
    hex: serializeColor(c.color),
    material: isMatte(c.material) ? '' : materialOf(c),
  }));
}

// Multi-line block (cuboidy-view / cuboidy-snap):
//   palette:
//     0 = #FF0000
//     1 = #C0C4CC  metallic=1 roughness=0.08
export function formatPaletteBlock(palette: Palette): string {
  return [
    'palette:',
    ...entries(palette).map(
      (e) => `  ${e.char} = ${e.hex}${e.material === '' ? '' : `  ${e.material}`}`,
    ),
  ].join('\n');
}

// Single line (cuboidy-query): `palette: 0=#FF0000 1=#00FF00`. A material
// goes in brackets so the space inside it cannot be read as a slot break.
export function formatPaletteLine(palette: Palette): string {
  return `palette: ${entries(palette)
    .map((e) => `${e.char}=${e.hex}${e.material === '' ? '' : `[${e.material}]`}`)
    .join(' ')}`;
}
