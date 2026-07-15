#!/usr/bin/env node
import { runPart, type PartOp } from './part-runner.js';
import type { Axis } from '../cvox/transform.js';

// CLI shell for `cuboidy-part <duplicate|mirror> <from.cvox> <fromPart>
// <to.cvox> <toPart> [x|y|z]`. All real work lives in part-runner.ts.
// Copies (or mirrors) a concrete part into a cvox file, writing it in place.

const HELP_TEXT =
  'Usage: cuboidy-part <op> <from.cvox> <fromPart> <to.cvox> <toPart> [axis]\n' +
  '\n' +
  'Copy or mirror an existing part into a cvox file as concrete geometry\n' +
  '(plain voxel data — no clone/mirror reference). <to.cvox> is written in\n' +
  'place with the new part appended; from and to may be the same file.\n' +
  '\n' +
  'Operations:\n' +
  '  duplicate   copy <fromPart> verbatim as <toPart>\n' +
  '  mirror      copy <fromPart> reflected across [axis] as <toPart>\n' +
  '\n' +
  'Arguments:\n' +
  '  <from.cvox> <fromPart>   source file + part to read\n' +
  '  <to.cvox> <toPart>       destination file + new part name\n' +
  '  [axis]                   mirror axis x|y|z (mirror only; default x)\n' +
  '\n' +
  'When to.cvox differs from from.cvox and their inline palettes differ,\n' +
  'the copied voxels are remapped into to.cvox\'s palette (missing colors\n' +
  'appended) so the part keeps its colors.\n' +
  '\n' +
  'Options:\n' +
  '  --help, -h       show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  part written\n' +
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
  const [op, fromFile, fromPart, toFile, toPart, axis, ...extra] = positional;
  if (op !== 'duplicate' && op !== 'mirror') {
    return { error: 'first argument must be "duplicate" or "mirror"' };
  }
  if (
    fromFile === undefined ||
    fromPart === undefined ||
    toFile === undefined ||
    toPart === undefined
  ) {
    return {
      error: 'expected <from.cvox> <fromPart> <to.cvox> <toPart>',
    };
  }
  if (op === 'duplicate' && axis !== undefined) {
    return { error: 'duplicate takes no axis argument' };
  }
  if (axis !== undefined && axis !== 'x' && axis !== 'y' && axis !== 'z') {
    return { error: `mirror axis must be x, y or z (got "${axis}")` };
  }
  if (extra.length > 0) {
    return { error: `unexpected argument "${extra[0]}"` };
  }
  return {
    op,
    fromFile,
    fromPart,
    toFile,
    toPart,
    ...(axis !== undefined && { axis: axis as Axis }),
  };
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
