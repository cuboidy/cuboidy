#!/usr/bin/env node
import { formatDiagnostic, runLint } from './lint-runner.js';

// CLI shell for `cuboidy-lint <dir> [--strict]`. All real work lives in
// lint-runner.ts so the CLI surface (argv parsing, stdout writing,
// process.exit) can stay small and the runtime logic stays testable
// without spawning a subprocess.

interface Args {
  dir: string;
  strict: boolean;
}

// `{ error }`, not `null`, so a usage mistake is DIAGNOSED. Every other CLI
// here says what was wrong before printing the help; this one printed the
// help alone and left you to spot the difference, which is the least useful
// moment to be terse.
function parseArgs(
  argv: readonly string[],
): Args | { help: true } | { error: string } {
  const positional: string[] = [];
  let strict = false;
  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--strict') strict = true;
    else if (a.startsWith('-')) return { error: `unknown flag "${a}"` };
    else positional.push(a);
  }
  if (positional.length === 0) return { error: 'expected a model directory' };
  if (positional.length > 1) {
    return { error: `expected one directory, got ${positional.length}` };
  }
  return { dir: positional[0]!, strict };
}

const HELP_TEXT =
  'Usage: cuboidy-lint <dir> [--strict]\n' +
  '\n' +
  'Lint a cuboidy model directory. Reads <dir>/cuboidy.json (REQUIRED —\n' +
  'SPEC §3) plus the geometry it references, or writes inline (§6.13),\n' +
  'then runs the structural parsers, the voxel lint rules (W01-W05,\n' +
  'H01-H02) and cross-file validation. Diagnostics in SPEC §11.7 format.\n' +
  '\n' +
  'Options:\n' +
  '  --strict      treat warnings as errors for exit code\n' +
  '  --help, -h    show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  no errors (warnings/hints may be present)\n' +
  '  1  one or more errors (or warnings under --strict)\n' +
  '  2  CLI usage error (missing required file, bad arguments)\n';

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    process.stderr.write(`cuboidy-lint: ${parsed.error}

${HELP_TEXT}`);
    return 2;
  }
  if ('help' in parsed) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  const result = await runLint(parsed.dir, { strict: parsed.strict });
  for (const fd of result.diagnostics) {
    process.stdout.write(formatDiagnostic(fd) + '\n');
  }
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? e.stack ?? e.message : String(e);
    process.stderr.write(`cuboidy-lint: ${msg}\n`);
    process.exit(2);
  });
