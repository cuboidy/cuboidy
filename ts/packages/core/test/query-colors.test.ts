import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { runQuery } from '../src/cli/query-runner.js';

// The gap this closes is a real one, found the hard way. An author eroding a
// joint refilled the parent's socket with palette index 9 where the part is
// index a, and it rendered as a bright band across both elbows. Lint passed,
// cuboidy-clash passed, cuboidy-overlap passed: all three are colour-blind in
// the way that matters — lint is structural, clash only asks whether two
// colours DIFFER, and overlap counts cells. The fault was caught by a human
// looking at a render, which is exactly the kind of catch that stops working
// the moment nobody looks.
//
// A census does not decide whether a colour is right; nothing can. It makes
// the change VISIBLE, so a before/after diff shows a line the author did not
// mean to move.

async function write(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-colors-test-'));
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }
  return dir;
}

const PALETTE = JSON.stringify({ colors: ['#FF0000', '#00FF00', '#0000FF'] });

/** One 2x1x1 part, each cell painted by the caller. */
function model(cells: string): Record<string, string> {
  return {
    'cuboidy.json': JSON.stringify({
      name: 'swatch',
      version: '0.9',
      geometry: ['g.json'],
      parts: [{ name: 'limb', position: [0, 0, 0] }],
    }),
    'p.json': PALETTE,
    'g.json': JSON.stringify({
      version: '0.9',
      palette: 'p.json',
      parts: [
        {
          name: 'limb',
          size: [2, 1, 1],
          pivot: { pos: [0, 0, 0] },
          voxels: [[cells]],
        },
      ],
    }),
  };
}

const COLORS = { queries: [{ kind: 'colors' } as const] };

describe('cuboidy-query --colors', () => {
  it('counts cells and drawn faces per part and palette slot', async () => {
    const { text, exitCode } = await runQuery(await write(model('00')), COLORS);
    // Two cells, ten drawn faces: a 2x1x1 box is twelve minus the two the
    // cells hide from each other.
    expect(text).toMatch(/^ {2}limb\s+0\s+#FF0000\s+2\s+10$/m);
    expect(text).toContain('total: 2 cells in 1 parts');
    // A census, not a gate. Nothing here is a fault on its own.
    expect(exitCode).toBe(0);
  });

  it('shows a mis-typed fill as an index the part did not have', async () => {
    // The elbow-band bug in miniature: one cell meant to be 0 written as 1.
    // The two censuses differ by exactly the mistake, and index 1 appears in
    // a part that had none of it — the signature to look for.
    const before = await runQuery(await write(model('00')), COLORS);
    const after = await runQuery(await write(model('01')), COLORS);
    // The palette legend in the header lists every declared colour whether
    // the model uses it or not, so the census body is what to read.
    const body = (t: string): string => t.slice(t.indexOf('colors:'));
    expect(body(before.text)).not.toContain('#00FF00');
    expect(after.text).toMatch(/^ {2}limb\s+1\s+#00FF00\s+1\s+5$/m);
    expect(after.text).toMatch(/^ {2}limb\s+0\s+#FF0000\s+1\s+5$/m);
    // Cell total unchanged: the geometry is identical and only paint moved,
    // which is why a cell count alone would have missed it.
    expect(after.text).toContain('total: 2 cells in 1 parts');
  });

  it('reports a colour with no drawn face as zero, not as absent', async () => {
    // A buried cell still occupies the model and still has to be accounted
    // for; a census that dropped it would read as a deletion.
    const dir = await write({
      'cuboidy.json': JSON.stringify({
        name: 'buried',
        version: '0.9',
        geometry: ['g.json'],
        parts: [{ name: 'block', position: [0, 0, 0] }],
      }),
      'p.json': PALETTE,
      'g.json': JSON.stringify({
        version: '0.9',
        palette: 'p.json',
        parts: [
          {
            name: 'block',
            size: [3, 3, 3],
            pivot: { pos: [0, 0, 0] },
            // A 3x3x3 shell of 0 with a single 1 at the centre.
            voxels: [
              ['000', '000', '000'],
              ['000', '010', '000'],
              ['000', '000', '000'],
            ],
          },
        ],
      }),
    });
    const { text } = await runQuery(dir, COLORS);
    expect(text).toMatch(/^ {2}block\s+1\s+#00FF00\s+1\s+0$/m);
  });
});

// A flipbook (§11.6 W09-W11) holds every frame of itself at once when it is
// assembled, and a census of the assembly is therefore a census of an object
// nobody looks at: Tropalm measured its campfire as 69.2% loud orange
// assembled against 28.4% at one instant of `burn`. The frame is the unit, so
// the census has to be able to name a moment.
describe('cuboidy-query --colors --anim --time', () => {
  /** Two frames of one colour each, alternating on a 1 s loop. */
  async function flipbook(): Promise<string> {
    return write({
      'cuboidy.json': JSON.stringify({
        name: 'flame',
        version: '0.9',
        palette: ['#FF0000', '#00FF00'],
        parts: [
          { name: 'flame_f0', geometry: { size: [1, 1, 1], voxels: [['0']] } },
          { name: 'flame_f1', geometry: { size: [1, 1, 1], voxels: [['1']] } },
        ],
        animations: {
          burn: {
            duration: 1,
            loop: true,
            parts: {
              flame_f0: { '0.0': { visible: true }, '0.5': { visible: false }, '1.0': { visible: true } },
              flame_f1: { '0.0': { visible: false }, '0.5': { visible: true }, '1.0': { visible: false } },
            },
          },
        },
      }),
    });
  }

  it('counts every frame at rest, which is the assembled object', async () => {
    const { text } = await runQuery(await flipbook(), COLORS);
    expect(text).toContain('total: 2 cells in 2 parts');
  });

  it('counts one frame at an instant of the clip', async () => {
    const dir = await flipbook();
    const at = async (time: number) =>
      (await runQuery(dir, { ...COLORS, anim: 'burn', time })).text;
    const t0 = await at(0);
    expect(t0).toMatch(/^ {2}flame_f0\s+0\s+#FF0000\s+1\s+6$/m);
    expect(t0.slice(t0.indexOf('colors:'))).not.toContain('flame_f1');
    expect(t0).toContain('total: 1 cells in 1 parts (1 not visible at this time)');
    const t05 = await at(0.5);
    expect(t05).toMatch(/^ {2}flame_f1\s+1\s+#00FF00\s+1\s+6$/m);
    expect(t05.slice(t05.indexOf('colors:'))).not.toContain('flame_f0');
  });
});
