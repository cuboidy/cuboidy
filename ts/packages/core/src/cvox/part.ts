import { isIdentifier } from '../identifier.js';
import { err, ok, type Result } from '../result.js';
import { parseNonNegInt } from './numbers.js';

export interface Size {
  w: number;
  h: number;
  d: number;
}

const SIZE_MIN = 1;
const SIZE_MAX = 1024;

export function parsePartHeader(args: readonly string[]): Result<string> {
  if (args.length !== 1) {
    return err(
      'wrong-arity',
      `part header expects exactly 1 identifier, got ${args.length}`,
    );
  }
  const name = args[0]!;
  if (!isIdentifier(name)) {
    return err('invalid-value', `invalid part identifier '${name}'`);
  }
  return ok(name);
}

export function parseSize(args: readonly string[]): Result<Size> {
  if (args.length !== 3) {
    return err(
      'wrong-arity',
      `size expects 3 args (W H D), got ${args.length}`,
    );
  }
  const parsed: number[] = [];
  for (const arg of args) {
    const n = parseNonNegInt(arg);
    if (n === null) {
      return err(
        'invalid-value',
        `size dimension '${arg}' is not a non-negative integer`,
      );
    }
    if (n < SIZE_MIN || n > SIZE_MAX) {
      return err(
        'invalid-value',
        `size dimension ${n} is out of range [${SIZE_MIN}..${SIZE_MAX}]`,
      );
    }
    parsed.push(n);
  }
  return ok({ w: parsed[0]!, h: parsed[1]!, d: parsed[2]! });
}
