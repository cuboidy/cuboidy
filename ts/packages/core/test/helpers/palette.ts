import { MATTE } from '../../src/geometry/palette.js';
import type { Material, PaletteEntry } from '../../src/geometry/types.js';

// A palette entry for tests that care about colour and nothing else.
//
// §7.4's material fields are required on PaletteEntry on purpose — an
// optional field in a cross-implementation contract is a second chance to
// disagree about the default — but that would put `...MATTE` at forty call
// sites here, where the material is beside the point. This says it once.
export function rgba(
  r: number,
  g: number,
  b: number,
  a = 255,
  material: Partial<Material> = {},
): PaletteEntry {
  return { r, g, b, a, ...MATTE, ...material };
}
