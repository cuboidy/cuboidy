#!/usr/bin/env node
import { ANGLES, resolveAngles } from '../render/camera.js';
import type { Angle } from '../render/camera.js';
import type { Rgb } from '../render/framebuffer.js';
import { parseBackground, parsePositiveInt } from './args.js';
import { DEFAULT_BG, runGif, type GifOptions } from './gif-runner.js';

// CLI shell for `cuboidy-gif <dir> [options]`. All real work lives in
// gif-runner.ts. Renders one animation clip to an animated GIF — the
// moving counterpart to cuboidy-snap, and the only way to look at the
// half of the format that moves.

const HELP_TEXT =
  'Usage: cuboidy-gif <dir> [options]\n' +
  '\n' +
  'Render one of a model\'s animation clips to an animated GIF. The camera\n' +
  'is fixed across every frame (fitted to the union of the whole clip), so\n' +
  'the model does not rescale as it moves and you can compare a foot\'s\n' +
  'height between frames. Dependency-free: software rasterizer, hand-rolled\n' +
  'GIF encoder, no browser and no native bindings.\n' +
  '\n' +
  'Options:\n' +
  '  --anim=<name>    clip to render (default: the model\'s first clip)\n' +
  '  --angle=<id>     camera angle (default: fr-up)\n' +
  '                   front back side left top bottom fr-up fl-up br-up bl-up\n' +
  '                   fr-dn fl-dn br-dn bl-dn, or a custom az<deg>el<deg>\n' +
  '  --size=<px>      square output size (default: 240)\n' +
  '  --fps=<n>        frames per second (default: 20)\n' +
  '  --frames=<n>     exact frame count (default: duration x fps)\n' +
  '  --ss=<n>         supersample factor (default: 1)\n' +
  '                   1 keeps the render inside GIF\'s 256-colour table\n' +
  '                   losslessly and suits voxel art; >1 antialiases and\n' +
  '                   is then quantised\n' +
  '  --bg=<hex>       background color, any §7.4 hex form (default: #6b7078)\n' +
  '                   alpha is accepted and ignored; the `#` is optional\n' +
  '  --bg=none        transparent background instead of a colour\n' +
  '  --orbit          turn the model on the spot instead of playing a clip\n' +
  '                   (the only way to render a model that has no animation)\n' +
  '  --loops=<n>      repeat the clip n times in one GIF (default: 1)\n' +
  '  --out=<file>     output path (default: <dir>/<model>-<clip>.gif)\n' +
  '  --help, -h       show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  rendered successfully\n' +
  '  1  parse / hierarchy error, or no such clip\n' +
  '  2  CLI usage error (missing file, bad arguments)\n';

interface Args extends GifOptions {
  dir: string;
}

export function parseArgs(
  argv: readonly string[],
): Args | { help: true } | { error: string } {
  const positional: string[] = [];
  let angle: Angle = ANGLES['fr-up']!;
  let size = 240;
  let ss = 1;
  let fps = 20;
  let frames: number | undefined;
  let bg: Rgb = DEFAULT_BG;
  let transparent = false;
  let clip: string | undefined;
  let outFile: string | undefined;
  let orbit = false;
  let loops: number | undefined;

  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--orbit') {
      orbit = true;
    } else if (a.startsWith('--anim=')) {
      clip = a.slice('--anim='.length);
      if (clip === '') return { error: '--anim needs a clip name' };
    } else if (a.startsWith('--angle=')) {
      // Through resolveAngles, not a bare ANGLES lookup: the help above
      // advertises `az<deg>el<deg>` and only resolveAngles understands it,
      // so the flag was documented and rejected. One angle, so take the
      // first — the spec of `--angle` is singular by design.
      const r = resolveAngles(a.slice('--angle='.length));
      if ('error' in r) return { error: r.error };
      const first = r[0];
      if (first === undefined) return { error: '--angle needs an angle' };
      angle = first;
    } else if (a.startsWith('--size=')) {
      const n = parsePositiveInt(a.slice('--size='.length));
      if (n === null) return { error: '--size must be a positive integer' };
      size = n;
    } else if (a.startsWith('--fps=')) {
      const n = parsePositiveInt(a.slice('--fps='.length));
      if (n === null || n > 50) return { error: '--fps must be an integer in 1..50' };
      fps = n;
    } else if (a.startsWith('--frames=')) {
      const n = parsePositiveInt(a.slice('--frames='.length));
      if (n === null || n > 300) {
        return { error: '--frames must be an integer in 1..300' };
      }
      frames = n;
    } else if (a.startsWith('--loops=')) {
      const n = parsePositiveInt(a.slice('--loops='.length));
      if (n === null || n > 20) return { error: '--loops must be an integer in 1..20' };
      loops = n;
    } else if (a.startsWith('--ss=')) {
      const n = parsePositiveInt(a.slice('--ss='.length));
      if (n === null || n > 4) return { error: '--ss must be an integer in 1..4' };
      ss = n;
    } else if (a.startsWith('--out=')) {
      outFile = a.slice('--out='.length);
    } else if (a === '--bg=none') {
      transparent = true;
    } else if (a.startsWith('--bg=')) {
      const c = parseBackground(a.slice('--bg='.length));
      if (c === null) return {
          error:
            '--bg must be a hex color: #RGB, #RGBA, #RRGGBB or #RRGGBBAA (alpha ignored)',
        };
      bg = c;
    } else if (a.startsWith('-')) {
      return { error: `unknown flag "${a}"` };
    } else {
      positional.push(a);
    }
  }

  if (positional.length !== 1) {
    return { error: 'expected exactly one <dir> argument' };
  }
  return {
    dir: positional[0]!, angle, size, ss, fps, frames, bg, clip, outFile, orbit,
    loops, transparent,
  };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if ('error' in parsed) {
    process.stderr.write(`cuboidy-gif: ${parsed.error}\n\n${HELP_TEXT}`);
    return 2;
  }
  const { dir, ...opts } = parsed;
  const result = await runGif(dir, opts);
  process.stdout.write(result.text);
  if (!result.text.endsWith('\n')) process.stdout.write('\n');
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`cuboidy-gif: ${msg}\n`);
    process.exit(2);
  });
