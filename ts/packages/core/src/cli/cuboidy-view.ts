#!/usr/bin/env node
import { runView, VIEW_NAMES, type ViewName } from './view-runner.js';

// CLI shell for `cuboidy-view <dir> [--views=a,b,...]`. All real work
// lives in view-runner.ts. The output is plain text (no ANSI escapes)
// using palette-index characters identical to the cvox row alphabet so
// a reader can compare projections directly against `voxels.cvox`.

interface Args {
  dir: string;
  views: ViewName[];
}

const HELP_TEXT =
  'Usage: cuboidy-view <dir> [--views=front,back,left,right,top,bottom]\n' +
  '\n' +
  'Assemble a cuboidy model from <dir>/cuboidy.json + <dir>/voxels.cvox\n' +
  'in rest pose, then render orthographic projections from one or more\n' +
  'cardinal view directions. Each view is a grid of palette-index\n' +
  'characters (same alphabet as cvox voxel rows; `.` = empty).\n' +
  '\n' +
  'Options:\n' +
  '  --views=<list>   comma-separated views; default = all six\n' +
  `                   choices: ${VIEW_NAMES.join(', ')}\n` +
  '  --help, -h       show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  rendered successfully\n' +
  '  1  parse / hierarchy error\n' +
  '  2  CLI usage error (missing file, bad arguments)\n';

function parseArgs(argv: readonly string[]): Args | { help: true } | { error: string } {
  const positional: string[] = [];
  let views: ViewName[] = [...VIEW_NAMES];
  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a.startsWith('--views=')) {
      const list = a.slice('--views='.length);
      const parsed: ViewName[] = [];
      for (const v of list.split(',')) {
        const t = v.trim();
        if (t === '') continue;
        if (!isViewName(t)) {
          return { error: `unknown view "${t}" (choices: ${VIEW_NAMES.join(', ')})` };
        }
        parsed.push(t);
      }
      if (parsed.length === 0) return { error: '--views requires at least one view name' };
      views = parsed;
    } else if (a.startsWith('-')) {
      return { error: `unknown flag "${a}"` };
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    return { error: 'expected exactly one <dir> argument' };
  }
  return { dir: positional[0]!, views };
}

function isViewName(s: string): s is ViewName {
  return (VIEW_NAMES as readonly string[]).includes(s);
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed && parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if ('error' in parsed) {
    process.stderr.write(`cuboidy-view: ${parsed.error}\n\n${HELP_TEXT}`);
    return 2;
  }
  const args = parsed as Args;
  const result = await runView(args.dir, { views: args.views });
  process.stdout.write(result.text);
  if (!result.text.endsWith('\n')) process.stdout.write('\n');
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`cuboidy-view: ${msg}\n`);
    process.exit(2);
  });
