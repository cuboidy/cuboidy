import { AIR, type Palette, type Part } from '@cuboidy/core';

// How many voxels reference each palette index, across every part that
// resolves against this palette. Drives the swatch usage badges and the
// "can't delete an in-use color" gate.
export function computePaletteUsage(
  palette: Palette,
  parts: readonly Part[],
): number[] {
  const usage = palette.map(() => 0);
  for (const part of parts) {
    for (const layer of part.voxels) {
      for (const row of layer) {
        for (const idx of row) {
          if (idx !== AIR && idx >= 0 && idx < usage.length) usage[idx]! += 1;
        }
      }
    }
  }
  return usage;
}
