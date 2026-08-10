// Regenerates the C# port's runtime acceptance data.
//
// `docs/csharp-implementation.md` states the criterion as
//
//   cuboidy-query <model> --transforms --sockets [--anim=<clip> --time=<s>]
//   t = k·duration/24   for k = -1 … 25
//
// and that is what this runs — `runQuery` itself, in-process, so the lines are
// produced by the code the criterion names rather than by a second formatter
// written to look like it. The C# side re-derives the same lines and compares
// them as parsed doubles with a tolerance (RuntimeParityTests).
//
// The mesh half of the criterion is NOT here. `--mesh` needs the assembled
// world and a much larger output, and it gets its own file.
//
//   npm run -w @cuboidy/core dump:parity

import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQuery } from '../src/cli/query-runner.js';
import { loadAndAssemble } from '../src/cli/assemble.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..');
const defaultOut = join(root, 'csharp', 'Cuboidy.Tests', 'parity', 'runtime.txt');

const out: string[] = [];

// The header lines (`model:`, `bbox:`, the palette legend) come from the CLI's
// assembly layer, which is not ported — it merges every part's palette so one
// ASCII legend can spell every colour. Only the rig lines are the contract.
function keep(text: string): string[] {
  return text
    .split('\n')
    .filter(
      (l) =>
        l.startsWith('transform ') ||
        l.startsWith('socket ') ||
        l === 'sockets: (model publishes none)',
    );
}

async function section(label: string, dir: string, anim?: string, time?: number) {
  const r = await runQuery(dir, {
    queries: [{ kind: 'transforms' }, { kind: 'sockets' }],
    ...(anim === undefined ? {} : { anim, time }),
  });
  if (r.exitCode !== 0) throw new Error(`${label}: ${r.text}`);
  out.push(`## ${label}`);
  out.push(...keep(r.text));
}

async function main() {
  const target = process.argv[2] ?? defaultOut;
  for (const name of readdirSync(join(root, 'models')).sort()) {
    const dir = join(root, 'models', name);
    await section(`${name} rest`, dir);

    const loaded = await loadAndAssemble(dir);
    if (!loaded.ok) throw new Error(`${name}: ${loaded.message}`);
    const clips = [...loaded.assembly.animations.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const [clip, anim] of clips) {
      // k = -1 and k = 25 cover one step outside the clip in each direction,
      // where a looping clip must wrap and a non-looping one must hold.
      for (let k = -1; k <= 25; k++) {
        await section(`${name} ${clip} k=${k}`, dir, clip, (k * anim.duration) / 24);
      }
    }
  }

  writeFileSync(target, out.join('\n') + '\n');
  console.log(`wrote ${out.length} lines to ${target}`);
}

void main();
