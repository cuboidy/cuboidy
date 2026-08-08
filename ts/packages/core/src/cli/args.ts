import { parseHexColor } from '../geometry/palette.js';
import type { Rgb } from '../render/framebuffer.js';

// Argument parsers shared by the CLIs, which had each grown their own.
//
// Duplication in a flag parser is not cosmetic: it shows up as the same
// option behaving differently depending on which command you typed. Both
// hand-rolled hex readers made the `#` optional and rejected `#RRGGBBAA`
// while core's own `parseHexColor` — the one the FORMAT is defined by —
// requires the `#` and accepts eight digits, so `--bg=#8a909980` was
// rejected by the tools and accepted everywhere else in the project.

/** A positive integer, for `--size`, `--fps`, `--frames`, `--cols`. */
export function parsePositiveInt(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

// A background colour, in the 0..1 sRGB the framebuffer holds.
//
// Delegates to core's `parseHexColor`, so a CLI accepts exactly the colours
// SPEC §7.4 does — including the alpha forms, whose alpha is then dropped:
// a tile background is opaque by construction, and ignoring the channel is
// better than rejecting a string the rest of the project reads.
//
// The leading `#` stays OPTIONAL, which §7.4 does not allow. Both
// hand-rolled parsers this replaces permitted it, and a shell where `#`
// starts a comment is reason enough to keep tolerating it on a command
// line. Only here — the format itself is unchanged.
export function parseBackground(s: string): Rgb | null {
  const c = parseHexColor(s.startsWith('#') ? s : `#${s}`);
  if (c === null) return null;
  return [c.r / 255, c.g / 255, c.b / 255];
}
