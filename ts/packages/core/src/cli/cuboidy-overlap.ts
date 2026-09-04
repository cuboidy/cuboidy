#!/usr/bin/env node
import {
  runOverlap,
  DEFAULT_SAMPLES,
  DEFAULT_TOP,
  type OverlapOptions,
} from './overlap-runner.js';
import { parsePositiveInt } from './args.js';

// CLI shell for `cuboidy-overlap <dir> [options]`. All real work lives in
// overlap-runner.ts.

const HELP_TEXT =
  'Usage: cuboidy-overlap <dir> [options]\n' +
  '\n' +
  'Census of cells two parts hold at the same time. This is the OTHER\n' +
  'overlap: cuboidy-clash finds surfaces in one place, which is a rendering\n' +
  'fault, and this finds volume in one place, which renders perfectly well\n' +
  'and is instead a question of what the model is carrying.\n' +
  '\n' +
  'The two are separate commands because their fixes pull opposite ways. A\n' +
  'clash is fixed by moving a surface off its neighbour\'s plane; an overlap\n' +
  'is fixed by deleting cells. Run them as one and it is easy to delete the\n' +
  'cells that were holding a joint shut.\n' +
  '\n' +
  'Which is what the split in the report is for:\n' +
  '\n' +
  '  dead      buried at rest AND at every sampled pose of every clip.\n' +
  '            Nothing will see it and nothing depends on it.\n' +
  '  covering  buried at rest, uncovered by some pose. This is the overlap\n' +
  '            doing its job -- what stops a joint tearing open mid-swing.\n' +
  '            Delete these and you get a hole.\n' +
  '\n' +
  'Exit code is always 0. Overlap is not a fault -- some of it is\n' +
  'load-bearing -- so there is no count that should fail a build.\n' +
  '\n' +
  'Options:\n' +
  '  --samples=<n>  poses to sample per clip (default: ' + DEFAULT_SAMPLES + ').\n' +
  '                 0 leaves the census at the rest pose, where every buried\n' +
  '                 cell is reported dead and the number over-counts\n' +
  '  --top=<n>      list at most n parts (default: ' + DEFAULT_TOP + ')\n' +
  '  --help, -h     show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  census produced\n' +
  '  1  parse / hierarchy error\n' +
  '  2  CLI usage error (missing file, bad arguments)\n';

interface Args extends OverlapOptions {
  dir: string;
}

export function parseArgs(
  argv: readonly string[],
): Args | { help: true } | { error: string } {
  const positional: string[] = [];
  let samples = DEFAULT_SAMPLES;
  let top = DEFAULT_TOP;

  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a.startsWith('--samples=')) {
      const raw = a.slice('--samples='.length);
      const n = raw === '0' ? 0 : parsePositiveInt(raw);
      if (n === null || n > 64) {
        return { error: '--samples must be an integer in 0..64' };
      }
      samples = n;
    } else if (a.startsWith('--top=')) {
      // Zero means "summary only", matching cuboidy-clash: two commands in one
      // family should not disagree about what a flag they share accepts.
      const raw = a.slice('--top='.length);
      const n = raw === '0' ? 0 : parsePositiveInt(raw);
      if (n === null) return { error: '--top must be a non-negative integer' };
      top = n;
    } else if (a.startsWith('-')) {
      return { error: `unknown flag "${a}"` };
    } else {
      positional.push(a);
    }
  }

  if (positional.length !== 1) {
    return { error: 'expected exactly one <dir> argument' };
  }
  return { dir: positional[0]!, samples, top };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if ('error' in parsed) {
    process.stderr.write(`cuboidy-overlap: ${parsed.error}\n\n${HELP_TEXT}`);
    return 2;
  }
  const { dir, ...opts } = parsed;
  const result = await runOverlap(dir, opts);
  process.stdout.write(result.text);
  if (!result.text.endsWith('\n')) process.stdout.write('\n');
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`cuboidy-overlap: ${msg}\n`);
    process.exit(2);
  });
