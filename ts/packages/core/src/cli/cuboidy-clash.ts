#!/usr/bin/env node
import {
  runClash,
  DEFAULT_MAX_DISTANCE,
  DEFAULT_SAMPLES,
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
'Checks the rest pose AND every clip the model declares. A seam that\n' +
  'fights in every pose is built wrong, while one that appears only past a\n' +
  'certain angle is a clearance problem, and the two are fixed differently;\n' +
  'the rest pose is always reported first so the rest can be read against\n' +
  'it. Sweeping is the default because the alternative was measured and it\n' +
  'lies: a yeti reads 2 visible at rest and 218 partway through its attack,\n' +
  'and the rest number is not a weak signal of the other, it is unrelated.\n' +
  '--rest-only is twenty times quicker and is there when that is what you\n' +
  'want, but it has to be asked for.\n' +
  '\n' +
  'A note on what a swing can and cannot fix. A rotation never separates\n' +
  'faces whose normal is the axis it turns about, so the side faces of a\n' +
  'constant cross-section chain -- arm/forearm/hand, thigh/shin/foot, all\n' +
  'hinging about X -- stay coplanar in every pose of every clip. Those\n' +
  'seams have to be built apart; no animation will part them.\n' +
  '\n' +
  'Colour-blind to everything but this. A cell painted the wrong index is\n' +
  'invisible to this command, to lint and to cuboidy-overlap alike; the\n' +
  'check for that is `cuboidy-query --colors` before and after an edit.\n' +
  '\n' +
  'Options:\n' +
  '  --max-distance=<v>  report a pair whose PLANES are within <v> voxels of\n' +
  '                      each other, measured along the shared normal\n' +
  '                      (default: ' + DEFAULT_MAX_DISTANCE + '). Exactly coincident surfaces\n' +
  '                      sit at 0; a part with a rest ROTATION lands near but\n' +
  '                      not on its neighbour, which is why this is a\n' +
  '                      distance and not an equality. Along the normal and\n' +
  '                      only along it -- centre-to-centre mixes in how far\n' +
  '                      the faces slide past each other IN the plane, and\n' +
  '                      missed about two pairs in three\n' +
  '  --anim=<clip>       narrow to one §6.3 clip instead of all of them\n' +
  '  --rest-only         skip every clip; check the rest pose alone\n' +
  '  --time=<s>          pin one time in seconds instead of sweeping\n' +
  '  --samples=<n>       equal steps to cut each clip into (default: ' + DEFAULT_SAMPLES + ').\n' +
  '                      An EVEN n always lands on the midpoint, where a swing\n' +
  '                      that goes out and back reaches furthest; a one-shot\n' +
  '                      clip also gets its final pose, a looping one does not\n' +
  '                      (its end is its start)\n' +
  '  --top=<n>           list at most n pairs (default: ' + DEFAULT_TOP + ').\n' +
  '                      The summary counts all of them either way. Under a\n' +
  '                      sweep the listing is the worst pose\'s\n' +
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
  let anim: string | undefined;
  let restOnly = false;
  let time: number | undefined;
  let samples = DEFAULT_SAMPLES;

  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--rest-only') {
      restOnly = true;
    } else if (a.startsWith('--anim=')) {
      const v = a.slice('--anim='.length);
      if (v === '') return { error: '--anim needs a clip name' };
      anim = v;
    } else if (a.startsWith('--time=')) {
      const v = Number(a.slice('--time='.length));
      if (!Number.isFinite(v) || v < 0) {
        return { error: '--time must be a non-negative number of seconds' };
      }
      time = v;
    } else if (a.startsWith('--samples=')) {
      const n = parsePositiveInt(a.slice('--samples='.length));
      if (n === null || n > 64) {
        return { error: '--samples must be an integer in 1..64' };
      }
      samples = n;
    } else if (a.startsWith('--max-distance=')) {
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
  // The --rest-only / --anim contradiction is checked in runClash, not here:
  // it is a property of the options, so a programmatic caller should hit the
  // same refusal as someone typing flags.
  return { dir: positional[0]!, maxDistance, top, anim, restOnly, time, samples };
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
