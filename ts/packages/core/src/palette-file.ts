import { z } from 'zod';
import { MAX_PALETTE, paletteEntryFrom } from './geometry/palette.js';
import { PaletteEntrySchema } from './geometry/schema.js';
import type { Palette } from './geometry/types.js';
import { err, ok, type Result } from './result.js';
import { resultFromZodError } from './zod-diagnostic.js';

// SPEC §6.10 (v0.7): external palette file — a shareable palette bound to
// a model via the manifest's top-level `palette` reference. The entry
// grammar, 62-color maximum and index assignment (`0-9a-zA-Z`) are the
// same as the inline geometry palette (§7.4); only the container differs.
// Object form (not a bare array) so the format has room for metadata
// (named colors etc.) without a breaking change.
//
// { "colors": ["#1a1a1a", { "color": "#f4c9a0", "metallic": 1 }, ...] }
//
// `colors` used to be `z.array(z.string())` with the hex check done by hand
// below. Sharing PaletteEntrySchema is what stops a palette FILE and an
// inline palette from disagreeing about what an entry may say — a shared
// palette that the geometry files could not express would be a poor kind
// of shared.

export const PaletteFileSchema = z
  .object({
    colors: z.array(PaletteEntrySchema).min(1).max(MAX_PALETTE),
  })
  .strict();

export function parsePaletteFile(json: unknown): Result<Palette> {
  const parsed = PaletteFileSchema.safeParse(json);
  if (!parsed.success) return resultFromZodError(parsed.error, json);
  const entries = [];
  for (const [i, doc] of parsed.data.colors.entries()) {
    const entry = paletteEntryFrom(doc);
    if (entry === null) {
      // Carries a path like every other reader's failures, so a caller
      // holding the text can locate it with `locateJsonPath`.
      const hex = typeof doc === 'string' ? doc : doc.color;
      return err('invalid-value', `colors.${i}: invalid color '${hex}'`, [
        'colors',
        i,
      ]);
    }
    entries.push(entry);
  }
  return ok(entries);
}
