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
// Two files come out of it:
//
//   parity/runtime.txt  the transforms and sockets
//   parity/mesh.txt     the §7.4 surface, as `--mesh` prints it: a face count,
//                       a digest over the sorted face lines, and one
//                       `mesh-part` line per part carrying that part's
//                       material list in the normative order, its opaque face
//                       count, and whether the opaque/translucent index split
//                       holds
//
// `--mesh-faces` is NOT committed. Every one of its 1,108,465 lines across the
// nine models, their clips and the 27 sample times was compared once and
// matched byte for byte — which is 274 MB, and which is what makes the digest
// a usable stand-in for it here. Pass `faces` as the second argument to
// regenerate that form into a file of your choosing when a digest moves and
// you need to see WHICH rectangle did.
//
//   npm run -w @cuboidy/core dump:parity
//   npx tsx scripts/dump-parity.ts /tmp/faces.txt faces

import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQuery } from '../src/cli/query-runner.js';
import { loadAndAssemble } from '../src/cli/assemble.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..');
const parityDir = join(root, 'csharp', 'Cuboidy.Tests', 'parity');

const runtime: string[] = [];
const mesh: string[] = [];

// The header lines (`model:`, `bbox:`, the palette legend) come from the CLI's
// assembly layer, which is not ported — it merges every part's palette so one
// ASCII legend can spell every colour. Only the rig and mesh lines are the
// contract.
function keep(text: string, prefixes: readonly string[]): string[] {
  return text
    .split('\n')
    .filter((l) => prefixes.some((p) => l.startsWith(p)) || l === 'sockets: (model publishes none)');
}

async function section(
  label: string,
  dir: string,
  faces: boolean,
  anim?: string,
  time?: number,
) {
  const at = anim === undefined ? {} : { anim, time };

  const rig = await runQuery(dir, {
    queries: [{ kind: 'transforms' }, { kind: 'sockets' }],
    ...at,
  });
  if (rig.exitCode !== 0) throw new Error(`${label}: ${rig.text}`);
  runtime.push(`## ${label}`);
  runtime.push(...keep(rig.text, ['transform ', 'socket ']));

  const surface = await runQuery(dir, { queries: [{ kind: 'mesh', faces }], ...at });
  if (surface.exitCode !== 0) throw new Error(`${label}: ${surface.text}`);
  mesh.push(`## ${label}`);
  mesh.push(...keep(surface.text, faces ? ['mesh ', 'mesh-part ', 'face '] : ['mesh ', 'mesh-part ']));
}

async function main() {
  const faces = process.argv[3] === 'faces';
  for (const name of readdirSync(join(root, 'models')).sort()) {
    const dir = join(root, 'models', name);
    await section(`${name} rest`, dir, faces);

    const loaded = await loadAndAssemble(dir);
    if (!loaded.ok) throw new Error(`${name}: ${loaded.message}`);
    const clips = [...loaded.assembly.animations.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const [clip, anim] of clips) {
      // k = -1 and k = 25 cover one step outside the clip in each direction,
      // where a looping clip must wrap and a non-looping one must hold.
      for (let k = -1; k <= 25; k++) {
        await section(`${name} ${clip} k=${k}`, dir, faces, clip, (k * anim.duration) / 24);
      }
    }
  }

  if (faces) {
    const target = process.argv[2];
    if (target === undefined) throw new Error('faces mode needs an output path');
    writeFileSync(target, mesh.join('\n') + '\n');
    console.log(`wrote ${mesh.length} face lines to ${target}`);
    return;
  }

  writeFileSync(join(parityDir, 'runtime.txt'), runtime.join('\n') + '\n');
  writeFileSync(join(parityDir, 'mesh.txt'), mesh.join('\n') + '\n');
  console.log(`wrote ${runtime.length} runtime and ${mesh.length} mesh lines to ${parityDir}`);
}

void main();
