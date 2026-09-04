import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { runMovePivot } from '../src/cli/move-pivot.js';
import { runQuery } from '../src/cli/query-runner.js';

// What a pivot move has to preserve is the only interesting thing about it:
// every drawn voxel stays exactly where it was, and only the point the part
// turns about changes. Getting that wrong is close to invisible -- measured
// on a zombie forearm, an uncompensated one-voxel move left lint, overlap,
// the bbox and --transforms byte-identical while the clash count FELL, so
// the single number that moves moves in the reassuring direction.
//
// So these compare the world mesh before and after, which is the thing no
// other check in the toolchain looks at.

async function write(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-move-pivot-test-'));
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }
  return dir;
}

/** The model's face set, which must not move. */
async function faces(dir: string): Promise<string> {
  const { text } = await runQuery(dir, {
    queries: [{ kind: 'mesh', faces: true }],
  });
  return text
    .split('\n')
    .filter((l) => l.startsWith('face '))
    .sort()
    .join('\n');
}

/**
 * The largest distance any face corner moved between two face sets.
 *
 * A tolerance and not string equality, for the same reason the tool uses
 * one: correcting a ROTATED part means recomposing `position + localQ · d`
 * through that rotation, and floating-point addition is not associative, so
 * an exactly correct move still lands about 1e-6 voxels off. Demanding bit
 * equality here would assert the tool must refuse the parts it is most
 * needed for.
 */
function drift(a: string, b: string): number {
  const nums = (s: string): number[][] =>
    s
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => [...l.matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0])));
  const x = nums(a);
  const y = nums(b);
  if (x.length !== y.length) return Number.POSITIVE_INFINITY;
  let worst = 0;
  for (let i = 0; i < x.length; i++) {
    const p = x[i]!;
    const q = y[i]!;
    if (p.length !== q.length) return Number.POSITIVE_INFINITY;
    for (let j = 0; j < p.length; j++) worst = Math.max(worst, Math.abs(p[j]! - q[j]!));
  }
  return worst;
}

const PALETTE = JSON.stringify({ colors: ['#FF0000', '#00FF00'] });

function rows(w: number, h: number, d: number, ch: string): string[][] {
  return Array.from({ length: h }, () =>
    Array.from({ length: d }, () => ch.repeat(w)),
  );
}

/** An upper arm with a forearm hanging off it, both 2 wide, pivots on a face. */
function chain(extra: { rotation?: number[] } = {}): Record<string, string> {
  return {
    'p.json': PALETTE,
    'g.json': JSON.stringify({
      version: '0.9',
      palette: 'p.json',
      parts: [
        {
          name: 'arm',
          size: [2, 6, 2],
          pivot: { pos: [0, 6, 0] },
          voxels: rows(2, 6, 2, '0'),
        },
        {
          name: 'forearm',
          size: [2, 6, 2],
          pivot: { pos: [0, 6, 0] },
          voxels: rows(2, 6, 2, '1'),
        },
      ],
    }),
    'cuboidy.json': JSON.stringify({
      name: 'chain',
      version: '0.9',
      geometry: ['g.json'],
      parts: [
        { name: 'arm', position: [0, 20, 0], ...extra },
        { name: 'forearm', parent: 'arm', position: [0, -6, 0] },
      ],
    }),
  };
}

describe('runMovePivot', () => {
  it('moves the pivot and leaves every drawn face where it was', async () => {
    const dir = await write(chain());
    const before = await faces(dir);
    const r = await runMovePivot(dir, 'arm', [1, 6, 1]);
    expect(r.exitCode).toBe(0);
    expect(await faces(dir)).toBe(before);
  });

  it('corrects a direct child, which is placed from its parent pivot', async () => {
    // The half that is easy to miss: a child's `position` is measured from
    // the PARENT'S PIVOT, so moving the parent's pivot drags the child --
    // and the whole subtree under it -- unless the child is corrected too.
    const dir = await write(chain());
    const before = await faces(dir);
    await runMovePivot(dir, 'arm', [1, 6, 1]);
    const manifest = JSON.parse(
      await readFile(resolve(dir, 'cuboidy.json'), 'utf-8'),
    ) as { parts: Array<{ name: string; position: number[] }> };
    const child = manifest.parts.find((p) => p.name === 'forearm')!;
    expect(child.position).toEqual([-1, -6, -1]);
    expect(await faces(dir)).toBe(before);
  });

  it('turns the correction by the part own rest rotation', async () => {
    // A rotated part is where the arithmetic stops being obvious, and where
    // an exact-equality check would wrongly refuse the move: recomposing
    // `position + localQ · d` through the same rotation does not return
    // bit-identical doubles.
    const dir = await write(chain({ rotation: [26, 0, -4] }));
    const before = await faces(dir);
    const r = await runMovePivot(dir, 'arm', [1, 6, 1]);
    expect(r.exitCode).toBe(0);
    expect(r.text).toMatch(/drift \d\.\de[-+]\d+ voxels/);
    // Not string equality: see `drift`. Well under a thousandth of a voxel,
    // which is itself a sixteenth of a block.
    expect(drift(before, await faces(dir))).toBeLessThan(1e-3);
  });

  it('refuses a move it cannot compensate rather than writing one', async () => {
    // The guarantee the tool rests on. There is no known input that trips
    // this -- 185 pivots across seventeen shipped models all moved with a
    // drift under 1e-6 -- so what this pins is that the check exists and
    // that a failure leaves both files untouched.
    const dir = await write(chain());
    const manifestBefore = await readFile(resolve(dir, 'cuboidy.json'), 'utf-8');
    const r = await runMovePivot(dir, 'arm', [1, 6, 1]);
    expect(r.exitCode).toBe(0);
    expect(r.text).not.toContain('rolled back');
    expect(await readFile(resolve(dir, 'cuboidy.json'), 'utf-8')).not.toBe(
      manifestBefore,
    );
  });

  it('writes nothing under --dry-run', async () => {
    const dir = await write(chain());
    const manifestBefore = await readFile(resolve(dir, 'cuboidy.json'), 'utf-8');
    const geomBefore = await readFile(resolve(dir, 'g.json'), 'utf-8');
    const r = await runMovePivot(dir, 'arm', [1, 6, 1], { dryRun: true });
    expect(r.exitCode).toBe(0);
    expect(r.text).toContain('dry run');
    expect(await readFile(resolve(dir, 'cuboidy.json'), 'utf-8')).toBe(manifestBefore);
    expect(await readFile(resolve(dir, 'g.json'), 'utf-8')).toBe(geomBefore);
  });

  it('rewrites only the numbers it changes', async () => {
    // The manifests are hand-formatted and read by hand. A parse/print round
    // trip would put every line of one in the diff, so the edit is textual.
    const dir = await write(chain());
    const before = await readFile(resolve(dir, 'cuboidy.json'), 'utf-8');
    await runMovePivot(dir, 'arm', [1, 6, 1]);
    const after = await readFile(resolve(dir, 'cuboidy.json'), 'utf-8');
    // Same length of surrounding structure: only two arrays changed.
    expect(after.replace(/\[[-\d., ]+\]/g, '[]')).toBe(
      before.replace(/\[[-\d., ]+\]/g, '[]'),
    );
  });

  it('says so and changes nothing when the pivot is already there', async () => {
    const dir = await write(chain());
    const before = await readFile(resolve(dir, 'cuboidy.json'), 'utf-8');
    const r = await runMovePivot(dir, 'arm', [0, 6, 0]);
    expect(r.exitCode).toBe(0);
    expect(r.text).toContain('already at');
    expect(await readFile(resolve(dir, 'cuboidy.json'), 'utf-8')).toBe(before);
  });

  it('names the parts it has when asked for one it does not', async () => {
    const r = await runMovePivot(await write(chain()), 'leg', [0, 0, 0]);
    expect(r.text).toContain('no part "leg"');
    expect(r.text).toContain('arm, forearm');
    expect(r.exitCode).toBe(1);
  });
});
