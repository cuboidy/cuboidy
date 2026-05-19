const NON_NEG_INT_RE = /^\d+$/;
// SPEC §7.1.1 (table row "Number"): integer or decimal, optional leading `-`.
// No leading `.` (`.5` is rejected — must be `0.5`). No exponent notation
// (`1e2` is rejected) — cvox numeric slots are voxel coordinates, pivot
// offsets, and rotation degrees, none of which benefit from scientific
// notation. If exponent support is ever needed, update SPEC and this regex
// together.
const FLOAT_RE = /^-?\d+(\.\d+)?$/;

export function parseNonNegInt(s: string): number | null {
  if (!NON_NEG_INT_RE.test(s)) return null;
  return Number(s);
}

export function parseFloatStrict(s: string): number | null {
  if (!FLOAT_RE.test(s)) return null;
  const n = Number(s);
  if (!isFinite(n)) return null;
  return n;
}
