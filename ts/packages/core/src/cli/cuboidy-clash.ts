#!/usr/bin/env node
import {
  runClash,
  DEFAULT_MAX_DISTANCE,
  DEFAULT_TOP,
  type ClashOptions,
} from './clash-runner.js';
import { parsePositiveInt } from './args.js';

// CLI shell for `cuboidy-clash <dir> [options]`. All real work lives in
// clash-runner.ts.

const HELP_TEXT =
  'Usage: cuboidy-clash <dir> [options]\n' +
  '\n' +
  'Find surfaces that occupy the same place, face the same way, and carry\n' +
  'DIFFERENT colours. A renderer cannot choose between them, so it decides\n' +
  'per pixel: a dithered cross-hatch in a software rasterizer, a flicker\n' +
  'that follows the camera anywhere with a depth buffer.\n' +
  '\n' +
  'Names both sides — the part, the part-local voxel, and which face of it —\n' +
  'so the finding points at a row you can edit. The usual fix is to give the\n' +
  'buried cells the covering part\'s colour rather than to shrink the\n' +
  'overlap; joints are overlapped on purpose, and a joint trimmed until the\n' +
  'dither stops is a joint that tears open the moment a clip moves it.\n' +
  '\n' +
  'Rest pose only. Nothing here samples a clip yet.\n' +
  '\n' +
  'Options:\n' +
  '  --max-distance=<v>  report a pair whose face centres are within <v>\n' +
  '                      voxels (default: ' + DEFAULT_MAX_DISTANCE + '). Exactly\n' +
  '                      coincident surfaces sit at 0; a part with a rest\n' +
  '                      ROTATION lands near but not on its neighbour, which\n' +
  '                      is why this is a distance and not an equality\n' +
  '  --top=<n>           list at most n pairs (default: ' + DEFAULT_TOP + ').\n' +
  '                      The summary counts all of them either way\n' +
  '  --help, -h          show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  no clashes\n' +
  '  1  clashes found, or a parse / hierarchy error\n' +
  '  2  CLI usage error (missing file, bad arguments)\n';

interface Args extends ClashOptions {
  dir: string;
}

export function parseArgs(
  argv: readonly string[],
): Args | { help: true } | { error: string } {
  const positional: string[] = [];
  let maxDistance = DEFAULT_MAX_DISTANCE;
  let top = DEFAULT_TOP;

  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a.startsWith('--max-distance=')) {
      const v = Number(a.slice('--max-distance='.length));
      if (!Number.isFinite(v) || v <= 0 || v > 1) {
        return { error: '--max-distance must be a number in (0, 1]' };
      }
      maxDistance = v;
    } else if (a.startsWith('--top=')) {
      // Zero is allowed and means "summary only" — the form a batch gate
      // wants, where the count is the answer and the listing is noise.
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
  return { dir: positional[0]!, maxDistance, top };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if ('error' in parsed) {
    process.stderr.write(`cuboidy-clash: ${parsed.error}\n\n${HELP_TEXT}`);
    return 2;
  }
  const { dir, ...opts } = parsed;
  const result = await runClash(dir, opts);
  process.stdout.write(result.text);
  if (!result.text.endsWith('\n')) process.stdout.write('\n');
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`cuboidy-clash: ${msg}\n`);
    process.exit(2);
  });
