#!/usr/bin/env node
import {
  parseAtArg,
  parseCoreArg,
  runQuery,
  type Query,
} from './query-runner.js';

// CLI shell for `cuboidy-query <dir> --at=... --core=...`. All real
// work lives in query-runner.ts. Output is plain text, one line per
// query, using palette-index characters identical to the geometry row
// alphabet so a reader can compare directly against `voxels.json`.

interface Args {
  dir: string;
  queries: Query[];
}

const HELP_TEXT =
  'Usage: cuboidy-query <dir> (--at=x,y,z | --core=<axis>,<pin1>=<v1>,<pin2>=<v2>)+\n' +
  '\n' +
  'Assemble a cuboidy model from <dir>/cuboidy.json + <dir>/voxels.json\n' +
  'in rest pose, then answer one or more coordinate queries. Output is\n' +
  'one line per query plus a short header (model name, bbox, palette).\n' +
  '\n' +
  'Queries:\n' +
  '  --at=<x>,<y>,<z>                      single voxel; fractional OK\n' +
  '                                        → at(x,y,z)=<palette-char or .>\n' +
  '  --core=<axis>,<pin1>=<v1>,<pin2>=<v2> walk axis at pinned coords\n' +
  '                                        axis ∈ {x,y,z}; pins are the\n' +
  '                                        other two axes; fractional OK\n' +
  '                                        → core(...) y=N..M: <chars>\n' +
  '                                        (annotated `step=0.5` when\n' +
  '                                         half-voxel offsets present)\n' +
  '\n' +
  'Multiple queries may be combined in one invocation; each prints on\n' +
  'its own line in the order given.\n' +
  '\n' +
  'Options:\n' +
  '  --help, -h       show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  query answered\n' +
  '  1  parse / hierarchy error\n' +
  '  2  CLI usage error (missing file, bad arguments)\n';

function parseArgs(argv: readonly string[]): Args | { help: true } | { error: string } {
  const positional: string[] = [];
  const queries: Query[] = [];
  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a.startsWith('--at=')) {
      const q = parseAtArg(a.slice('--at='.length));
      if ('error' in q) return { error: q.error };
      queries.push(q);
    } else if (a.startsWith('--core=')) {
      const q = parseCoreArg(a.slice('--core='.length));
      if ('error' in q) return { error: q.error };
      queries.push(q);
    } else if (a.startsWith('-')) {
      return { error: `unknown flag "${a}"` };
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    return { error: 'expected exactly one <dir> argument' };
  }
  if (queries.length === 0) {
    return { error: 'expected at least one --at or --core query' };
  }
  return { dir: positional[0]!, queries };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed && parsed.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if ('error' in parsed) {
    process.stderr.write(`cuboidy-query: ${parsed.error}\n\n${HELP_TEXT}`);
    return 2;
  }
  const args = parsed as Args;
  const result = await runQuery(args.dir, { queries: args.queries });
  process.stdout.write(result.text);
  if (!result.text.endsWith('\n')) process.stdout.write('\n');
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`cuboidy-query: ${msg}\n`);
    process.exit(2);
  });
