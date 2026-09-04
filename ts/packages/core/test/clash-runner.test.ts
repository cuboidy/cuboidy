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
    expect(text).toContain('clashes: 6  (exact 6');
    expect(exitCode).toBe(1);
    // The point of the tool: a finding you can act on without hunting.
    expect(text).toMatch(/clash d=0\.000 {2}a cell\(0,0,0\) \+X #FF0000 {2}vs {2}b cell\(0,0,0\) \+X #00FF00/);
  });

  it('says nothing when the two parts merely touch', async () => {
    // Adjacent cells share a plane, but each part's face there points away
    // from the other. Back-face culling keeps exactly one, so they never
    // compete — flagging this would fire on every joint in every model.
    const { text, exitCode } = await runClash(await write(model([1, 0, 0])), OPTS);
    expect(text).toContain('clashes: 0');
    expect(exitCode).toBe(0);
  });

  it('ignores a coincidence the eye cannot see', async () => {
    // Same cell, same colour: the faces also share a normal, so they shade
    // identically and whichever the renderer picks draws the same pixel.
    const { text } = await runClash(
      await write(model([0, 0, 0], ['0', '0'])),
      OPTS,
    );
    expect(text).toContain('clashes: 0');
  });

  it('catches a near miss that an equality test would not', async () => {
    // The case that motivated the distance: a part carrying a rest ROTATION
    // lands near its neighbour rather than on it, so exact coincidence never
    // happens and an equality test reports a clean model.
    const dir = await write(model([0, 0, 0], ['0', '1'], [0, 4, 0]));
    const loose = await runClash(dir, OPTS);
    const exact = await runClash(dir, { ...OPTS, maxDistance: 0.001 });
    expect(exact.text).toContain('clashes: 0');
    expect(loose.text).not.toContain('clashes: 0');
    expect(loose.exitCode).toBe(1);
  });

  it('reports a summary alone when asked for no listing', async () => {
    const { text } = await runClash(await write(model([0, 0, 0])), {
      ...OPTS,
      top: 0,
    });
    expect(text).not.toContain('clash d=');
    expect(text).toContain('clashes: 6');
  });

  it('passes the loader exit code through for an unreadable model', async () => {
    const { exitCode } = await runClash(
      resolve(tmpdir(), 'cuboidy-clash-does-not-exist'),
      OPTS,
    );
    expect(exitCode).toBe(2);
  });
});
