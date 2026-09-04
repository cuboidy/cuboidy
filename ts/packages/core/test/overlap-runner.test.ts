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
    // The count, and how far apart the two parts are in the rig — 1 is the
    // joint, which is the distinction the report turns on.
    expect(text).toContain('cover(1 rest, 1 dead /1)');
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

  it('separates a joint from two parts the rig does not join', async () => {
    // Two chains off one root. `tip` sits inside its own parent, which is a
    // joint and how a joint is made, and it also sits inside the far chain's
    // block, four steps away, which has no structural reason to touch it.
    // Only the second is a finding; reporting the first would make the report
    // an argument for taking joints apart.
    const dir = await write({
      'p.json': PALETTE,
      'g.json': JSON.stringify({
        version: '0.9',
        palette: 'p.json',
        parts: [
          { name: 'hub', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['0']] },
          { name: 'limb', size: [5, 5, 5], pivot: { pos: [0, 0, 0] }, voxels: rows(5, 5, 5, '0') },
          { name: 'tip', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['1']] },
          { name: 'other', size: [5, 5, 5], pivot: { pos: [0, 0, 0] }, voxels: rows(5, 5, 5, '0') },
        ],
      }),
      'cuboidy.json': JSON.stringify({
        name: 'chains',
        version: '0.9',
        geometry: ['g.json'],
        parts: [
          { name: 'hub', position: [0, 0, 0] },
          { name: 'limb', parent: 'hub', position: [0, 0, 0] },
          { name: 'tip', parent: 'limb', position: [2, 2, 2] },
          { name: 'branch', parent: 'hub', position: [40, 0, 0] },
          { name: 'other', parent: 'branch', position: [-40, 0, 0] },
        ],
      }),
    });
    const { text } = await runOverlap(dir, OPTS);
    // tip -> limb -> hub -> branch -> other is four steps.
    expect(text).toContain('not joined: other and tip');
    expect(text).toContain('4 steps apart');
    // The joint is not reported as a finding, only in the table.
    expect(text).not.toContain('not joined: limb and tip');
    expect(text).not.toContain('not joined: tip and limb');
  });

  it('finds two parts a clip drives through each other', async () => {
    // The case the rest pose hides, and the one people actually see: two
    // limbs that clear each other while the model stands still and pass
    // through as it walks. Reading only the rest pose reads the one pose the
    // fault tends to avoid.
    const dir = await write({
      'p.json': PALETTE,
      'g.json': JSON.stringify({
        version: '0.9',
        palette: 'p.json',
        parts: [
          { name: 'hub', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['0']] },
          { name: 'block', size: [5, 5, 5], pivot: { pos: [0, 0, 0] }, voxels: rows(5, 5, 5, '0') },
          { name: 'swinger', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['1']] },
        ],
      }),
      'cuboidy.json': JSON.stringify({
        name: 'swing-through',
        version: '0.9',
        geometry: ['g.json'],
        // Two chains off one hub, four steps apart. At rest the swinger sits
        // well clear of the block; the clip walks it into the middle of it.
        animations: {
          walk: {
            duration: 2,
            loop: true,
            parts: {
              swinger: {
                '0.0': { pos: [0, 0, 0] },
                '1.0': { pos: [-20, 2, 2] },
                '2.0': { pos: [0, 0, 0] },
              },
            },
          },
        },
        parts: [
          { name: 'hub', position: [0, 0, 0] },
          { name: 'block', parent: 'hub', position: [0, 0, 0] },
          { name: 'arm', parent: 'hub', position: [20, 0, 0] },
          { name: 'swinger', parent: 'arm', position: [2, 0, 0] },
        ],
      }),
    });

    // Rest pose alone: nothing to see, and saying so is true and useless.
    const still = await runOverlap(dir, { ...OPTS, samples: 0 });
    expect(still.text).toContain('no overlap between parts the rig does not join');

    const swept = await runOverlap(dir, OPTS);
    expect(swept.text).toContain('not joined: block and swinger');
    expect(swept.text).toContain('worst at walk t=1.000');
  });

  it('reports a stranger pair on one line, not two', async () => {
    // Overlap is mutual: A is inside B exactly as B is inside A, and the
    // census counts both. The finding is one fact and prints once.
    const dir = await write({
      'p.json': PALETTE,
      'g.json': JSON.stringify({
        version: '0.9',
        palette: 'p.json',
        parts: [
          { name: 'hub', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['0']] },
          { name: 'limb', size: [5, 5, 5], pivot: { pos: [0, 0, 0] }, voxels: rows(5, 5, 5, '0') },
          { name: 'tip', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['1']] },
        ],
      }),
      'cuboidy.json': JSON.stringify({
        name: 'one-line',
        version: '0.9',
        geometry: ['g.json'],
        parts: [
          { name: 'hub', position: [0, 0, 0] },
          { name: 'limb', parent: 'hub', position: [0, 0, 0] },
          { name: 'branch', parent: 'hub', position: [40, 0, 0] },
          { name: 'tip', parent: 'branch', position: [-38, 2, 2] },
        ],
      }),
    });
    const lines = (await runOverlap(dir, OPTS)).text
      .split('\n')
      .filter((l) => l.startsWith('not joined:'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\blimb\b.*\btip\b|\btip\b.*\blimb\b/);
    expect(lines[0]).toContain('worst at rest');
  });

  it('splits dead and covering per pair, not just per part', async () => {
    // The part-wide totals are sums across every relationship a part has,
    // and a sum is the wrong number for the question an author asks. A cover
    // holding two pips -- one a clip walks out and one it never touches --
    // reports "1 dead" overall, and which of the two may be deleted cannot
    // be read off that. Getting it wrong deletes the load-bearing one.
    const dir = await write({
      'p.json': PALETTE,
      'g.json': JSON.stringify({
        version: '0.9',
        palette: 'p.json',
        parts: [
          { name: 'cover', size: [5, 5, 5], pivot: { pos: [0, 0, 0] }, voxels: rows(5, 5, 5, '0') },
          { name: 'mover', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['1']] },
          { name: 'stayer', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['1']] },
        ],
      }),
      'cuboidy.json': JSON.stringify({
        name: 'two-pips',
        version: '0.9',
        geometry: ['g.json'],
        animations: {
          move: {
            duration: 1,
            loop: true,
            parts: { mover: { '0.0': { pos: [0, 0, 0] }, '1.0': { pos: [0, 9, 0] } } },
          },
        },
        parts: [
          { name: 'cover', position: [0, 0, 0] },
          { name: 'mover', parent: 'cover', position: [1, 2, 2] },
          { name: 'stayer', parent: 'cover', position: [3, 2, 2] },
        ],
      }),
    });
    const { text } = await runOverlap(dir, OPTS);
    // The cover holds one cell of each. The clip lifts `mover` out, so the
    // cover cell under it is covering; nothing ever uncovers `stayer`.
    expect(text).toMatch(/^cover .*mover\(1 rest, 0 dead \/1\)/m);
    expect(text).toMatch(/^cover .*stayer\(1 rest, 1 dead \/1\)/m);
    // And the part-wide figure is the sum that cannot answer either.
    expect(text).toMatch(/^cover\s+\d+\s+2\s+\d+%\s+1\s/m);
  });

  it('counts a cell held by two parts against both of them', async () => {
    // Stopping at the first cover under-reports the second, and the second
    // is exactly the one an author is about to delete something from.
    const dir = await write({
      'p.json': PALETTE,
      'g.json': JSON.stringify({
        version: '0.9',
        palette: 'p.json',
        parts: [
          { name: 'a', size: [3, 3, 3], pivot: { pos: [0, 0, 0] }, voxels: rows(3, 3, 3, '0') },
          { name: 'b', size: [3, 3, 3], pivot: { pos: [0, 0, 0] }, voxels: rows(3, 3, 3, '0') },
          { name: 'pip', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['1']] },
        ],
      }),
      'cuboidy.json': JSON.stringify({
        name: 'both',
        version: '0.9',
        geometry: ['g.json'],
        parts: [
          { name: 'a', position: [0, 0, 0] },
          { name: 'b', parent: 'a', position: [0, 0, 0] },
          { name: 'pip', parent: 'b', position: [1, 1, 1] },
        ],
      }),
    });
    const { text } = await runOverlap(dir, OPTS);
    expect(text).toMatch(/^pip .*a\(1 rest, 1 dead \/2\)/m);
    expect(text).toMatch(/^pip .*b\(1 rest, 1 dead \/1\)/m);
  });

  it('passes the loader exit code through for an unreadable model', async () => {
    const { exitCode } = await runOverlap(
      resolve(tmpdir(), 'cuboidy-overlap-does-not-exist'),
      OPTS,
    );
    expect(exitCode).toBe(2);
  });
});
