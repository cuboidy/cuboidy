import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { runClash, DEFAULT_MAX_DISTANCE } from '../src/cli/clash-runner.js';

// The fault this covers is the one nothing else in the toolchain sees: two
// surfaces in one place, facing the same way, in different colours. Lint is
// structural and never assembles, and a rest-pose render draws the dither
// without naming it, so a model can be clean by every other check and still
// hatch on screen.

async function write(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-clash-test-'));
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }
  return dir;
}

// A geometry file's `palette` is a PATH, never an inline object — the schema
// rejects the object form outright.
const PALETTE = JSON.stringify({ colors: ['#FF0000', '#00FF00'] });

// Two 1x1x1 parts. `where` places the second one; the colours differ unless
// the caller says otherwise.
function model(
  where: [number, number, number],
  colours: [string, string] = ['0', '1'],
  rotation?: [number, number, number],
): Record<string, string> {
  return {
    'cuboidy.json': JSON.stringify({
      name: 'pair',
      version: '0.9',
      geometry: ['g.json'],
      parts: [
        { name: 'a', position: [0, 0, 0] },
        { name: 'b', position: where, ...(rotation ? { rotation } : {}) },
      ],
    }),
    'p.json': PALETTE,
    'g.json': JSON.stringify({
      version: '0.9',
      palette: 'p.json',
      parts: [
        {
          name: 'a',
          size: [1, 1, 1],
          pivot: { pos: [0, 0, 0] },
          voxels: [[colours[0]]],
        },
        {
          name: 'b',
          size: [1, 1, 1],
          pivot: { pos: [0, 0, 0] },
          voxels: [[colours[1]]],
        },
      ],
    }),
  };
}

const OPTS = { maxDistance: DEFAULT_MAX_DISTANCE, top: 40 };

describe('runClash', () => {
  it('finds two parts sharing one cell, and names both sides', async () => {
    const { text, exitCode } = await runClash(await write(model([0, 0, 0])), OPTS);
    // One cell, six faces a side, every one of them coincident and
    // differently coloured.
    expect(text).toContain('clashes: 6 visible  (exact 6');
    expect(exitCode).toBe(1);
    // The point of the tool: a finding you can act on without hunting.
    expect(text).toMatch(
      /clash d=0\.000\s+a cell\(0,0,0\) \+X #FF0000 {2}vs {2}b cell\(0,0,0\) \+X #00FF00/,
    );
  });

  it('says nothing when the two parts merely touch', async () => {
    // Adjacent cells share a plane, but each part's face there points away
    // from the other. Back-face culling keeps exactly one, so they never
    // compete — flagging this would fire on every joint in every model.
    const { text, exitCode } = await runClash(await write(model([1, 0, 0])), OPTS);
    expect(text).toContain('clashes: 0 visible');
    expect(exitCode).toBe(0);
  });

  it('ignores a coincidence the eye cannot see', async () => {
    // Same cell, same colour: the faces also share a normal, so they shade
    // identically and whichever the renderer picks draws the same pixel.
    const { text } = await runClash(
      await write(model([0, 0, 0], ['0', '0'])),
      OPTS,
    );
    expect(text).toContain('clashes: 0 visible');
  });

  it('measures separation along the normal, not centre to centre', async () => {
    // A part carrying a rest ROTATION. Its face CENTRES swing away from its
    // neighbour's, but the planes they lie on stay all but coincident, and it
    // is the planes a depth buffer fights over. So this is still caught with
    // the threshold wound down to a thousandth of a cell.
    //
    // Centre-to-centre distance was the first criterion tried and it reported
    // this model clean, because it mixed the separation of the planes with
    // how far the faces slide along them.
    const dir = await write(model([0, 0, 0], ['0', '1'], [0, 4, 0]));
    const tight = await runClash(dir, { ...OPTS, maxDistance: 0.001 });
    expect(tight.text).not.toContain('clashes: 0 visible');
    expect(tight.exitCode).toBe(1);
  });

  it('leaves faces that merely tile alone', async () => {
    // Two cells side by side. Their upward faces are exactly coplanar and
    // point the same way, but they are a whole cell apart in that plane, so
    // they cover none of each other and nothing competes. The lateral limit
    // is what keeps this from firing on every flat surface in every model.
    const { text, exitCode } = await runClash(await write(model([1, 0, 0])), OPTS);
    expect(text).toContain('clashes: 0 visible');
    expect(exitCode).toBe(0);
  });

  it('reports a summary alone when asked for no listing', async () => {
    const { text } = await runClash(await write(model([0, 0, 0])), {
      ...OPTS,
      top: 0,
    });
    expect(text).not.toContain('clash d=');
    expect(text).toContain('clashes: 6 visible');
  });

  it('counts a clash nobody can see separately, and does not fail on it', async () => {
    // Two 1x1x1 parts sharing a cell at the centre of a 5x5x5 block. They do
    // fight, but two solid cells of cover stand between them and every
    // direction, so no camera reaches it. Counting these beside the visible
    // ones makes two models incomparable: how deeply a rig buries its joints
    // is a property of the rig, not of its quality.
    const dir = await write({
      'p.json': PALETTE,
      'g.json': JSON.stringify({
        version: '0.9',
        palette: 'p.json',
        parts: [
          {
            name: 'cover',
            size: [5, 5, 5],
            pivot: { pos: [0, 0, 0] },
            voxels: Array.from({ length: 5 }, () =>
              Array.from({ length: 5 }, () => '00000'),
            ),
          },
          { name: 'x', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['0']] },
          { name: 'y', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['1']] },
        ],
      }),
      'cuboidy.json': JSON.stringify({
        name: 'buried',
        version: '0.9',
        geometry: ['g.json'],
        parts: [
          { name: 'cover', position: [0, 0, 0] },
          { name: 'x', position: [2, 2, 2] },
          { name: 'y', position: [2, 2, 2] },
        ],
      }),
    });
    const { text, exitCode } = await runClash(dir, OPTS);
    expect(text).toContain('clashes: 0 visible');
    expect(text).toMatch(/\+ [1-9]\d* hidden inside the model/);
    // Nothing an author could act on, so the gate stays green.
    expect(exitCode).toBe(0);
  });

  it('passes the loader exit code through for an unreadable model', async () => {
    const { exitCode } = await runClash(
      resolve(tmpdir(), 'cuboidy-clash-does-not-exist'),
      OPTS,
    );
    expect(exitCode).toBe(2);
  });
});
