export const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function isIdentifier(s: string): boolean {
  return IDENTIFIER_RE.test(s);
}
