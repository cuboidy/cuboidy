import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { runOverlap, DEFAULT_TOP } from '../src/cli/overlap-runner.js';

// The distinction this covers is the one that makes the census usable: a cell
// buried at rest is not automatically waste. If a clip uncovers it, it is what
// stops the joint tearing open when the limb swings, and deleting it puts a
// hole in the model. Only a cell that is buried at rest AND at every pose is
// dead.

async function write(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-overlap-test-'));
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }
  return dir;
}

const PALETTE = JSON.stringify({ colors: ['#FF0000', '#00FF00'] });

function rows(w: number, h: number, d: number, ch: string): string[][] {
  return Array.from({ length: h }, () =>
    Array.from({ length: d }, () => ch.repeat(w)),
  );
}

/** A 5x5x5 cover with a 1x1x1 part parked inside it at `at`. */
function model(
  at: [number, number, number],
  clip?: Record<string, unknown>,
): Record<string, string> {
  return {
    'p.json': PALETTE,
    'g.json': JSON.stringify({
      version: '0.9',
      palette: 'p.json',
      parts: [
        {
          name: 'cover',
          size: [5, 5, 5],
          pivot: { pos: [0, 0, 0] },
          voxels: rows(5, 5, 5, '0'),
        },
        {
          name: 'pip',
          size: [1, 1, 1],
          pivot: { pos: [0, 0, 0] },
          voxels: [['1']],
        },
      ],
    }),
    'cuboidy.json': JSON.stringify({
      name: 'buried',
      version: '0.9',
      geometry: ['g.json'],
      ...(clip ? { animations: { move: clip } } : {}),
      parts: [
        { name: 'cover', position: [0, 0, 0] },
        { name: 'pip', parent: 'cover', position: at },
      ],
    }),
  };
}

const OPTS = { samples: 8, top: DEFAULT_TOP };

describe('runOverlap', () => {
  it('counts a cell no clip ever uncovers as dead', async () => {
    const { text, exitCode } = await runOverlap(await write(model([2, 2, 2])), OPTS);
    expect(text).toMatch(/^pip\s+1\s+1\s+100%\s+1\s+100%\s+0/m);
    // Two, not one: overlap is mutual. The cover's cell at that spot is
    // inside the pip exactly as the pip's is inside the cover.
    expect(text).toContain('dead: 2');
    expect(text).toContain('counted on both sides');
    // A census, not a gate: overlap is not by itself a fault.
    expect(exitCode).toBe(0);
  });

  it('counts a cell a clip uncovers as covering, not dead', async () => {
    // The same buried cell, with a clip that walks it out of the cover. It is
    // still 100% buried at rest and it is not waste — this is the shape of an
    // overlap that keeps a joint shut.
    const { text } = await runOverlap(
      await write(
        model([2, 2, 2], {
          duration: 1,
          loop: true,
          parts: { pip: { '0.0': { pos: [0, 0, 0] }, '1.0': { pos: [0, 9, 0] } } },
        }),
      ),
      OPTS,
    );
    expect(text).toMatch(/^pip\s+1\s+1\s+100%\s+0\s+0%\s+1/m);
  });

  it('names who each part is buried in', async () => {
    const { text } = await runOverlap(await write(model([2, 2, 2])), OPTS);
    expect(text).toContain('cover(1)');
  });

  it('says so when no clip was sampled, because dead then over-counts', async () => {
    const { text } = await runOverlap(await write(model([2, 2, 2])), {
      ...OPTS,
      samples: 0,
    });
    expect(text).toContain('no clips sampled');
  });

  it('reports nothing buried when the parts merely sit apart', async () => {
    const { text } = await runOverlap(await write(model([9, 0, 0])), OPTS);
    expect(text).toContain('buried at rest: 0');
    expect(text).toContain('dead: 0');
  });

  it('passes the loader exit code through for an unreadable model', async () => {
    const { exitCode } = await runOverlap(
      resolve(tmpdir(), 'cuboidy-overlap-does-not-exist'),
      OPTS,
    );
    expect(exitCode).toBe(2);
  });
});
