#!/usr/bin/env node
import { runPart, type PartOp } from './part-runner.js';
import type { Axis } from '../cvox/transform.js';

// CLI shell for `cuboidy-part`. All real work lives in part-runner.ts.
//   duplicate <from.cvox> <fromPart> <to.cvox> <toPart>  — copy a part
//   mirror    <file.cvox> <part> [x|y|z]                 — flip it in place

const HELP_TEXT =
  'Usage:\n' +
  '  cuboidy-part duplicate <from.cvox> <fromPart> <to.cvox> <toPart>\n' +
  '  cuboidy-part mirror    <file.cvox> <part> [axis]\n' +
  '\n' +
  'Author concrete geometry (plain voxel data — no clone/mirror reference).\n' +
  '\n' +
  'duplicate — copy <fromPart> into <to.cvox> as <toPart> (written in place;\n' +
  '            from and to may be the same file). When to.cvox differs and\n' +
  "            their inline palettes differ, the copy's voxels are remapped\n" +
  "            into to.cvox's palette (missing colors appended) so it keeps\n" +
  '            its colors.\n' +
  '\n' +
  'mirror    — reflect <part> across [axis] IN PLACE (same name), rewriting\n' +
  '            <file.cvox>. axis is x|y|z; default x. To make a mirrored\n' +
  '            copy for the other side, duplicate first, then mirror the copy.\n' +
  '\n' +
  'Options:\n' +
  '  --help, -h       show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  written\n' +
  '  1  parse / lookup error (bad cvox, unknown part, name clash)\n' +
  '  2  CLI usage error (missing file, bad arguments)\n';

function parseArgs(
  argv: readonly string[],
): PartOp | { help: true } | { error: string } {
  const positional: string[] = [];
  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a.startsWith('-')) return { error: `unknown flag "${a}"` };
    positional.push(a);
  }
  const [op, ...rest] = positional;

  if (op === 'duplicate') {
    const [fromFile, fromPart, toFile, toPart, ...extra] = rest;
    if (
      fromFile === undefined ||
      fromPart === undefined ||
      toFile === undefined ||
      toPart === undefined
    ) {
      return {
        error: 'duplicate expects <from.cvox> <fromPart> <to.cvox> <toPart>',
      };
    }
    if (extra.length > 0) return { error: `unexpected argument "${extra[0]}"` };
    return { op, fromFile, fromPart, toFile, toPart };
  }

  if (op === 'mirror') {
    const [file, part, axis, ...extra] = rest;
    if (file === undefined || part === undefined) {
      return { error: 'mirror expects <file.cvox> <part> [axis]' };
    }
    if (axis !== undefined && axis !== 'x' && axis !== 'y' && axis !== 'z') {
      return { error: `mirror axis must be x, y or z (got "${axis}")` };
    }
    if (extra.length > 0) return { error: `unexpected argument "${extra[0]}"` };
    return { op, file, part, axis: (axis ?? 'x') as Axis };
  }

  return { error: 'first argument must be "duplicate" or "mirror"' };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if ('error' in parsed) {
    process.stderr.write(`cuboidy-part: ${parsed.error}\n\n${HELP_TEXT}`);
    return 2;
  }
  const result = await runPart(parsed);
  const stream = result.exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${result.text}\n`);
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`cuboidy-part: ${msg}\n`);
    process.exit(2);
  });
