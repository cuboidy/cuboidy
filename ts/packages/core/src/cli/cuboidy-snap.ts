#!/usr/bin/env node
import { resolveAngles, type Angle } from '../render/camera.js';
import type { Rgb } from '../render/framebuffer.js';
import { parseBackground, parsePositiveInt } from './args.js';
import { DEFAULT_ANGLES, DEFAULTS, runSnap, type SnapOptions } from './snap-runner.js';

// CLI shell for `cuboidy-snap <dir> [options]`. All real work lives in
// snap-runner.ts. Renders a model to PNG images from several angles (the
// raster counterpart to cuboidy-view) and writes them under <out>.

const HELP_TEXT =
  'Usage: cuboidy-snap <dir> [options]\n' +
  '\n' +
  'Assemble a cuboidy model from <dir>/cuboidy.json (plus any geometry it\n' +
  'references) in rest pose, then render orthographic PNGs from several angles.\n' +
  'Emits a contact sheet (all angles in one labeled image) plus one PNG\n' +
  'per angle. Each image has its angle name and an XYZ axis gnomon baked\n' +
  'in so a multimodal reader can orient every view.\n' +
  '\n' +
  'Options:\n' +
  '  --angles=<list>  comma-separated angle ids or groups (default: standard)\n' +
  '                   ids:    front back side left top bottom\n' +
  '                           fr-up fl-up br-up bl-up\n' +
  '                           fr-dn fl-dn br-dn bl-dn  (the corners, from below)\n' +
  '                   groups: standard cardinal corners unders all\n' +
  '                   custom: az<deg>el<deg>, e.g. az20el-25 (elevation -90..90)\n' +
  '  --out=<dir>      output directory (default: <dir>/snapshots)\n' +
  '  --size=<px>      per-angle tile size, square (default: 256)\n' +
  '  --ss=<n>         supersample factor for anti-aliasing (default: 2)\n' +
  '  --bg=<hex>       background color, any §7.4 hex form (default: #888e94)\n' +
  '                   alpha is accepted and ignored; the `#` is optional\n' +
  '  --cols=<n>       contact-sheet columns (default: 4)\n' +
  '  --no-sheet       skip the combined contact sheet\n' +
  '  --no-individual  skip the per-angle PNGs\n' +
  '  --help, -h       show this message\n' +
  '\n' +
  'Exit codes:\n' +
  '  0  rendered successfully\n' +
  '  1  parse / hierarchy error (or empty model)\n' +
  '  2  CLI usage error (missing file, bad arguments)\n';

interface Args extends SnapOptions {
  dir: string;
}

function parseArgs(argv: readonly string[]): Args | { help: true } | { error: string } {
  const positional: string[] = [];
  let angles: readonly Angle[] = DEFAULT_ANGLES;
  let tileSize: number = DEFAULTS.tileSize;
  let ss: number = DEFAULTS.ss;
  let bg: Rgb = DEFAULTS.bg;
  let cols: number = DEFAULTS.cols;
  let sheet = true;
  let individual = true;
  let outDir: string | undefined;

  for (const a of argv) {
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--no-sheet') {
      sheet = false;
    } else if (a === '--no-individual') {
      individual = false;
    } else if (a.startsWith('--angles=')) {
      const r = resolveAngles(a.slice('--angles='.length));
      if ('error' in r) return { error: r.error };
      angles = r;
    } else if (a.startsWith('--out=')) {
      outDir = a.slice('--out='.length);
    } else if (a.startsWith('--size=')) {
      const n = parsePositiveInt(a.slice('--size='.length));
      if (n === null) return { error: '--size must be a positive integer' };
      tileSize = n;
    } else if (a.startsWith('--ss=')) {
      const n = parsePositiveInt(a.slice('--ss='.length));
      if (n === null || n > 8) return { error: '--ss must be an integer in 1..8' };
      ss = n;
    } else if (a.startsWith('--cols=')) {
      const n = parsePositiveInt(a.slice('--cols='.length));
      if (n === null) return { error: '--cols must be a positive integer' };
      cols = n;
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
  if (!sheet && !individual) {
    return { error: '--no-sheet and --no-individual together would write nothing' };
  }
  const dir = positional[0]!;
  return {
    dir,
    angles,
    tileSize,
    ss,
    bg,
    cols,
    sheet,
    individual,
    outDir: outDir ?? `${dir}/snapshots`,
  };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('help' in parsed) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if ('error' in parsed) {
    process.stderr.write(`cuboidy-snap: ${parsed.error}\n\n${HELP_TEXT}`);
    return 2;
  }
  const { dir, ...opts } = parsed;
  const result = await runSnap(dir, opts);
  process.stdout.write(result.text);
  if (!result.text.endsWith('\n')) process.stdout.write('\n');
  return result.exitCode;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`cuboidy-snap: ${msg}\n`);
    process.exit(2);
  });
