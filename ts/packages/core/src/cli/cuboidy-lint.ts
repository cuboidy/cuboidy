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

function parseArgs(argv: readonly string[]): Args | { help: true } | null {
  const positional: string[] = [];
  let strict = false;
  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--strict') strict = true;
    else if (a.startsWith('-')) return null; // unknown flag
    else positional.push(a);
  }
  if (positional.length !== 1) return null;
  return { dir: positional[0]!, strict };
}

const HELP_TEXT =
  'Usage: cuboidy-lint <dir> [--strict]\n' +
  '\n' +
  'Lint a cuboidy model directory. Reads <dir>/voxels.cvox (required)\n' +
  'and <dir>/cuboidy.json (optional), runs structural parsers, the voxel\n' +
  'lint rules (W01-W05, H01-H02), and cross-file validation if both\n' +
  'files are present. Prints diagnostics in SPEC §11.7 format.\n' +
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
  if (parsed === null) {
    process.stderr.write(HELP_TEXT);
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
