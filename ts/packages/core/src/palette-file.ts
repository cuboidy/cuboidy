import { z } from 'zod';
import { MAX_PALETTE, parseHexColor } from './geometry/palette.js';
import type { Palette } from './geometry/types.js';
import { err, ok, type Result } from './result.js';

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
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    const colorsAbsent =
      issue.path[0] === 'colors' &&
      json !== null &&
      typeof json === 'object' &&
      !Object.hasOwn(json, 'colors');
    const code =
      issue.code === 'unrecognized_keys'
        ? 'unknown'
        : issue.code === 'too_big' || issue.code === 'too_small'
          ? 'wrong-arity'
          : colorsAbsent
            ? 'missing'
            : 'invalid-value';
    return err(code, `${path}: ${issue.message}`);
  }
  const colors = [];
  for (const [i, s] of parsed.data.colors.entries()) {
    const color = parseHexColor(s);
    if (color === null) {
      return err('invalid-value', `colors.${i}: invalid color '${s}'`);
    }
    colors.push(color);
  }
  return ok(colors);
}
