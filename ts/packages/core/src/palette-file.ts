import { z } from 'zod';
import { MAX_PALETTE, parseHexColor } from './geometry/palette.js';
import type { Palette } from './geometry/types.js';
import { err, ok, type Result } from './result.js';
import { resultFromZodError } from './zod-diagnostic.js';

// SPEC §6.10 (v0.7): external palette file — a shareable palette bound to
// a model via the manifest's top-level `palette` reference. The color
// grammar, 62-color maximum and index assignment (`0-9a-zA-Z`) are the
// same as the inline geometry palette (§7.4); only the container differs.
// Object form (not a bare array) so the format has room for metadata
// (named colors etc.) without a breaking change.
//
// { "colors": ["#1a1a1a", "#f4c9a0", "#RRGGBBAA", ...] }

export const PaletteFileSchema = z
  .object({
    colors: z.array(z.string()).min(1).max(MAX_PALETTE),
  })
  .strict();

export function parsePaletteFile(json: unknown): Result<Palette> {
  const parsed = PaletteFileSchema.safeParse(json);
  if (!parsed.success) return resultFromZodError(parsed.error, json);
  const colors = [];
  for (const [i, s] of parsed.data.colors.entries()) {
    const color = parseHexColor(s);
    if (color === null) {
      // Carries a path like every other reader's failures, so a caller
      // holding the text can locate it with `locateJsonPath`.
      return err('invalid-value', `colors.${i}: invalid color '${s}'`, [
        'colors',
        i,
      ]);
    }
    colors.push(color);
  }
  return ok(colors);
}
