import { err, ok, type Result } from '../result.js';
import { parseFloatStrict } from './numbers.js';

export interface Pivot {
  x: number;
  y: number;
  z: number;
}

export function parsePivot(args: readonly string[]): Result<Pivot> {
  if (args.length !== 3) {
    return err('E05', `pivot expects 3 args (x y z), got ${args.length}`);
  }
  const xs: number[] = [];
  for (const arg of args) {
    const n = parseFloatStrict(arg);
    if (n === null) {
      return err('E05', `pivot coord '${arg}' is not a number`);
    }
    xs.push(n);
  }
  return ok({ x: xs[0]!, y: xs[1]!, z: xs[2]! });
}
