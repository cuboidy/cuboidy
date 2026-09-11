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
  anim?: string | undefined;
  time?: number | undefined;
}

const HELP_TEXT =
  'Usage: cuboidy-query <dir> [--anim=<clip> --time=<s>]\n' +
  '                          (--at=... | --core=... | --transforms | --sockets\n' +
  '                           | --mesh | --mesh-faces | --colors)+\n' +
  '\n' +
  'Assemble a cuboidy model from <dir>/cuboidy.json (plus any geometry it\n' +
  'references), then answer queries about it. Output is one line per\n' +
  'query (or one per part / socket / face) plus a short header.\n' +
  '\n' +
  'Queries:\n' +
  '  --transforms                          every part\'s world transform and\n' +
  '                                        §6.5 pose\n' +
  '                                        → transform <part> pos=x,y,z\n' +
  '                                          quat=x,y,z,w scale=x,y,z visible=0|1\n' +
  '                                        The voxel grid below is an\n' +
  '                                        axis-aligned projection, so a\n' +
  '                                        rest rotation barely shows in it;\n' +
  '                                        this prints the §7.7 rig math\n' +
  '                                        itself. Six decimals, -0 folded.\n' +
  '  --sockets                             every published frame (§6.12)\n' +
  '  --colors                              per part and palette slot: how many\n' +
  '                                        cells use it, and how many drawn\n' +
  '                                        faces show it. The check the other\n' +
  '                                        commands cannot make — they are\n' +
  '                                        colour-blind, so a part refilled\n' +
  '                                        with the wrong index passes lint,\n' +
  '                                        clash and overlap alike. Census\n' +
  '                                        before an edit and after; every line\n' +
  '                                        that moved should be one you meant\n' +
  '                                        to move, and an index appearing in a\n' +
  '                                        part that had none of it is a\n' +
  '                                        mis-typed fill. With --anim/--time,\n' +
  '                                        counts ONE FRAME: parts not visible\n' +
  '                                        at that instant are left out, which\n' +
  '                                        is the only honest census of a model\n' +
  '                                        whose flipbook holds every frame at\n' +
  '                                        once (§11.6 W09-W11)\n' +
  '                                        → socket <name> pos=x,y,z quat=x,y,z,w\n' +
  '  --mesh                                the §7.4 surface: a face count and\n' +
  '                                        digest, plus one line per part\n' +
  '                                        carrying its material list in the\n' +
  '                                        normative order and its opaque /\n' +
  '                                        translucent split\n' +
  '  --mesh-faces                          the same, plus every face — sorted,\n' +
  '                                        since §7.4 makes only the SET of\n' +
  '                                        faces normative, never their order\n' +
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
  '  --anim=<clip>    sample a §6.3 animation instead of the rest pose.\n' +
  '                   Applies to --transforms, --sockets, --mesh and\n' +
  '                   --colors; --at / --core read the rest-pose grid and\n' +
  '                   warn if combined with it\n' +
  '  --time=<s>       seconds into the clip (default 0). Times outside\n' +
  '                   [0, duration] wrap or clamp per §6.7\n' +
  '  --help, -h       show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  query answered\n' +
  '  1  parse / hierarchy error\n' +
  '  2  CLI usage error (missing file, bad arguments)\n';

function parseArgs(argv: readonly string[]): Args | { help: true } | { error: string } {
  const positional: string[] = [];
  const queries: Query[] = [];
  let anim: string | undefined;
  let time: number | undefined;
  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--transforms') {
      queries.push({ kind: 'transforms' });
    } else if (a === '--mesh') {
      queries.push({ kind: 'mesh', faces: false });
    } else if (a === '--mesh-faces') {
      queries.push({ kind: 'mesh', faces: true });
    } else if (a === '--colors') {
      queries.push({ kind: 'colors' });
    } else if (a === '--sockets') {
      queries.push({ kind: 'sockets' });
    } else if (a.startsWith('--anim=')) {
      anim = a.slice('--anim='.length);
      if (anim === '') return { error: '--anim needs a clip name' };
    } else if (a.startsWith('--time=')) {
      const raw = a.slice('--time='.length);
      const t = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(t)) {
        return { error: `--time must be a number of seconds (got "${raw}")` };
      }
      time = t;
    } else if (a.startsWith('--at=')) {
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
    return {
      error:
        'expected at least one --at / --core / --transforms / --sockets / ' +
        '--mesh / --mesh-faces / --colors query',
    };
  }
  if (time !== undefined && anim === undefined) {
    return { error: '--time needs --anim' };
  }
  return { dir: positional[0]!, queries, anim, time };
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
  const result = await runQuery(args.dir, {
    queries: args.queries,
    anim: args.anim,
    time: args.time,
  });
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
