#!/usr/bin/env node
import { runMigrate } from './migrate-runner.js';

// CLI shell for `cuboidy-migrate <dir>`. All real work lives in
// migrate-runner.ts. Expands the package's clone/mirror parts into concrete
// geometry, rewriting the affected geometry files in place.

const HELP_TEXT =
  'Usage: cuboidy-migrate <dir>\n' +
  '\n' +
  'Expand a package\'s clone/mirror parts into concrete voxel geometry,\n' +
  'rewriting the affected .cvox files in place. A one-shot upgrade step:\n' +
  'afterwards the model no longer uses the reuse grammar. The rendered\n' +
  'model is unchanged — only the on-disk representation.\n' +
  '\n' +
  'Reads <dir>/cuboidy.json (optional) and the geometry files it lists;\n' +
  'cross-file reuse under inline palettes is remapped into the declaring\n' +
  "file's palette so colors are preserved.\n" +
  '\n' +
  'Options:\n' +
  '  --help, -h       show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  migrated (or nothing to do)\n' +
  '  1  model did not resolve (bad cvox/manifest, unresolved reuse)\n' +
  '  2  CLI usage error (bad arguments, write failure)\n';

function parseArgs(argv: readonly string[]): { dir: string } | { help: true } | { error: string } {
  const positional: string[] = [];
  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a.startsWith('-')) return { error: `unknown flag "${a}"` };
    positional.push(a);
  }
  if (positional.length !== 1) return { error: 'expected exactly one <dir> argument' };
  return { dir: positional[0]! };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if ('error' in parsed) {
    process.stderr.write(`cuboidy-migrate: ${parsed.error}\n\n${HELP_TEXT}`);
    return 2;
  }
  const result = await runMigrate(parsed.dir);
  const stream = result.exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${result.text}\n`);
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`cuboidy-migrate: ${msg}\n`);
    process.exit(2);
  });
