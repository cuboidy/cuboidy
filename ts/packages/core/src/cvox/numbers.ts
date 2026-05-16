const NON_NEG_INT_RE = /^\d+$/;
const FLOAT_RE = /^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

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
