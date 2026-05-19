import { isIdentifier } from '../identifier.js';
import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import { parseFloatStrict, parseNonNegInt } from './numbers.js';
import type { Token } from './tokenize.js';

// Token-pulling primitives shared by all production parsers. Each
// `expect*` function performs the same 3-step shape:
//   (1) pull the next token from the cursor (wrong-arity at kw.line on EOF)
//   (2) check kind (bare vs string) matches the slot's expectation
//   (3) extract the typed value via the slot's per-type parse function
// and returns the typed value alongside the source Token so the caller
// can reference the offending line for any post-extraction domain
// validation (e.g. size range checks, duplicate-name checks).

export interface Expected<T> {
  value: T;
  token: Token;
}

function next(cursor: TokenCursor, kw: Token, label: string): Result<Token> {
  const t = cursor.peek();
  if (t === null) {
    return err(
      'wrong-arity',
      `line ${kw.line}: ${label}: missing value (end of stream)`,
    );
  }
  cursor.advance();
  return ok(t);
}

export function expectNumber(
  cursor: TokenCursor,
  kw: Token,
  label: string,
): Result<Expected<number>> {
  const tR = next(cursor, kw, label);
  if (!tR.ok) return tR;
  const t = tR.value;
  if (t.kind !== 'bare') {
    return err(
      'invalid-value',
      `line ${t.line}: ${label}: expected a number, got quoted string "${t.text}"`,
    );
  }
  const n = parseFloatStrict(t.text);
  if (n === null) {
    return err(
      'invalid-value',
      `line ${t.line}: ${label}: expected a number, got '${t.text}'`,
    );
  }
  return ok({ value: n, token: t });
}

export function expectNonNegInt(
  cursor: TokenCursor,
  kw: Token,
  label: string,
): Result<Expected<number>> {
  const tR = next(cursor, kw, label);
  if (!tR.ok) return tR;
  const t = tR.value;
  if (t.kind !== 'bare') {
    return err(
      'invalid-value',
      `line ${t.line}: ${label}: expected a non-negative integer, got quoted string "${t.text}"`,
    );
  }
  const n = parseNonNegInt(t.text);
  if (n === null) {
    return err(
      'invalid-value',
      `line ${t.line}: ${label}: expected a non-negative integer, got '${t.text}'`,
    );
  }
  return ok({ value: n, token: t });
}

// Expects a bare identifier (kind='bare') whose text satisfies the §5
// isIdentifier rule. The rule rejects reserved keywords, so `part part`
// surfaces as "invalid identifier 'part'" rather than parsing as a part
// named 'part'. String-kind tokens (`"head"`) are rejected — cvox names
// are always bare; quotes have no role here.
export function expectIdentifier(
  cursor: TokenCursor,
  kw: Token,
  label: string,
): Result<Expected<string>> {
  const tR = next(cursor, kw, label);
  if (!tR.ok) return tR;
  const t = tR.value;
  if (t.kind !== 'bare') {
    return err(
      'invalid-value',
      `line ${t.line}: ${label}: expected bare identifier, got quoted string "${t.text}"`,
    );
  }
  if (!isIdentifier(t.text)) {
    return err(
      'invalid-value',
      `line ${t.line}: ${label}: invalid identifier '${t.text}' (may be a reserved keyword)`,
    );
  }
  return ok({ value: t.text, token: t });
}

// Expects an exact bare-punctuation token (`{`, `}`, or `,`). Used by
// VoxelsParser to assert the opening `{` after the `voxels` keyword. A
// quoted `"{"` does NOT satisfy this — kind must be bare.
export function expectPunct(
  cursor: TokenCursor,
  kw: Token,
  char: '{' | '}' | ',',
  label: string,
): Result<Token> {
  const tR = next(cursor, kw, label);
  if (!tR.ok) return tR;
  const t = tR.value;
  if (t.kind !== 'bare' || t.text !== char) {
    const got = t.kind === 'string' ? `"${t.text}"` : `'${t.text}'`;
    return err(
      'wrong-arity',
      `line ${t.line}: ${label}: expected '${char}', got ${got}`,
    );
  }
  return ok(t);
}
