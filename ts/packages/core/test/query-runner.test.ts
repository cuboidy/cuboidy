import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  parseAtArg,
  parseCoreArg,
  runQuery,
  type Query,
} from '../src/cli/query-runner.js';
import { geo } from './helpers/geometry.js';
import { SINGLE } from './helpers/corpus.js';

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

async function makeModel(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-query-test-'));
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }
  return dir;
}

describe('parseAtArg', () => {
  it('parses integer triple', () => {
    expect(parseAtArg('3,4,5')).toEqual({ kind: 'at', x: 3, y: 4, z: 5 });
  });

  it('parses fractional triple', () => {
    expect(parseAtArg('2.5,1,3')).toEqual({ kind: 'at', x: 2.5, y: 1, z: 3 });
  });

  it('parses negative values', () => {
    expect(parseAtArg('-1,0,-2.5')).toEqual({ kind: 'at', x: -1, y: 0, z: -2.5 });
  });

  it('rejects wrong arity', () => {
    expect(parseAtArg('1,2')).toEqual({ error: expect.stringContaining('3 comma-separated') });
    expect(parseAtArg('1,2,3,4')).toEqual({ error: expect.stringContaining('3 comma-separated') });
  });

  it('rejects non-numeric', () => {
    expect(parseAtArg('1,abc,3')).toEqual({ error: expect.stringContaining('not a number') });
  });
});

describe('parseCoreArg', () => {
  it('parses axis + two pins', () => {
    expect(parseCoreArg('y,x=3,z=4')).toEqual({
      kind: 'core',
      axis: 'y',
      pin1: { axis: 'x', value: 3 },
      pin2: { axis: 'z', value: 4 },
    });
  });

  it('accepts fractional pin values', () => {
    expect(parseCoreArg('y,x=2.5,z=4')).toEqual({
      kind: 'core',
      axis: 'y',
      pin1: { axis: 'x', value: 2.5 },
      pin2: { axis: 'z', value: 4 },
    });
  });

  it('rejects duplicate axes', () => {
    // x as iteration axis, x as pin — not a permutation.
    expect(parseCoreArg('x,x=3,z=4')).toEqual({
      error: expect.stringContaining('permutation'),
    });
  });

  it('rejects unknown axis', () => {
    expect(parseCoreArg('w,x=3,z=4')).toEqual({
      error: expect.stringContaining('iteration axis must be'),
    });
  });

  it('rejects missing "="', () => {
    expect(parseCoreArg('y,x3,z=4')).toEqual({
      error: expect.stringContaining('missing "="'),
    });
  });
});

describe('runQuery — single-part corpus model (integer-only)', () => {
  const dir = resolve(REPO_ROOT, SINGLE);

  // Geometry recap (ts/testdata/single/voxels.json):
  //   size 3 2 3, pivot 1 0 1 (= manifest position 1,0,1 → world pivot
  //   identical to part-local pivot, so voxel (x,y,z) lands at world
  //   (x, y, z) for x∈0..2, y∈0..1, z∈0..2).
  //   Layer 0: solid (all 9 cells = palette index 0)
  //   Layer 1: 4 corner pillars at (0,1,0), (2,1,0), (0,1,2), (2,1,2)

  it('at(0,0,0) hits filled base voxel', async () => {
    const at: Query = { kind: 'at', x: 0, y: 0, z: 0 };
    const r = await runQuery(dir, { queries: [at] });
    expect(r.exitCode).toBe(0);
    expect(r.text).toMatch(/at\(0,0,0\)=0/);
  });

  it('at(1,1,1) is AIR (hollow middle)', async () => {
    const at: Query = { kind: 'at', x: 1, y: 1, z: 1 };
    const r = await runQuery(dir, { queries: [at] });
    expect(r.text).toMatch(/at\(1,1,1\)=\./);
  });

  it('at(0,1,0) hits the corner pillar', async () => {
    const at: Query = { kind: 'at', x: 0, y: 1, z: 0 };
    const r = await runQuery(dir, { queries: [at] });
    expect(r.text).toMatch(/at\(0,1,0\)=0/);
  });

  it('at(2.5,0,0) is AIR (no voxel between cells)', async () => {
    // The 0.5 case: the model has no half-voxel offsets, so any
    // fractional query returns ".".
    const at: Query = { kind: 'at', x: 2.5, y: 0, z: 0 };
    const r = await runQuery(dir, { queries: [at] });
    expect(r.text).toMatch(/at\(2\.5,0,0\)=\./);
  });

  it('core(y, x=0, z=0) walks the back-left pillar', async () => {
    // Y range = [0, 1]; both cells filled (base + pillar).
    const q: Query = {
      kind: 'core',
      axis: 'y',
      pin1: { axis: 'x', value: 0 },
      pin2: { axis: 'z', value: 0 },
    };
    const r = await runQuery(dir, { queries: [q] });
    expect(r.text).toMatch(/core\(y,x=0,z=0\) y=0\.\.1: 00/);
  });

  it('core(y, x=1, z=1) walks the middle column — only base filled', async () => {
    const q: Query = {
      kind: 'core',
      axis: 'y',
      pin1: { axis: 'x', value: 1 },
      pin2: { axis: 'z', value: 1 },
    };
    const r = await runQuery(dir, { queries: [q] });
    // y=0 filled, y=1 hollow → "0."
    expect(r.text).toMatch(/core\(y,x=1,z=1\) y=0\.\.1: 0\./);
  });

  it('header lists palette and bbox', async () => {
    const at: Query = { kind: 'at', x: 0, y: 0, z: 0 };
    const r = await runQuery(dir, { queries: [at] });
    expect(r.text).toMatch(/^model: single/m);
    expect(r.text).toMatch(/bbox: X=0\.\.2 Y=0\.\.1 Z=0\.\.2/);
    expect(r.text).toMatch(/palette: 0=#FFD700/);
  });
});

describe('runQuery — half-voxel offsets', () => {
  // Construct a model whose part position contains 0.5, so voxel
  // world coords land on half-integer X. This is precisely the case
  // the integer-snapped projection in cuboidy-view loses information
  // for — cuboidy-query must still answer correctly.
  async function makeHalfVoxelModel(): Promise<string> {
    return makeModel({
      'voxels.json': geo(
        [{ name: 'p', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] }],
        ['#F00'],
      ),
      'cuboidy.json': JSON.stringify({
        name: 'half',
        parts: [{ name: 'p', position: [2.5, 1, 3] }],
      }),
    });
  }

  it('at(2.5,1,3) finds the half-voxel', async () => {
    const dir = await makeHalfVoxelModel();
    const r = await runQuery(dir, {
      queries: [{ kind: 'at', x: 2.5, y: 1, z: 3 }],
    });
    expect(r.exitCode).toBe(0);
    expect(r.text).toMatch(/at\(2\.5,1,3\)=0/);
  });

  it('at(3,1,3) misses (no integer-snap)', async () => {
    const dir = await makeHalfVoxelModel();
    const r = await runQuery(dir, {
      queries: [{ kind: 'at', x: 3, y: 1, z: 3 }],
    });
    expect(r.text).toMatch(/at\(3,1,3\)=\./);
  });

  it('bbox header flags half-voxel offsets', async () => {
    const dir = await makeHalfVoxelModel();
    const r = await runQuery(dir, {
      queries: [{ kind: 'at', x: 2.5, y: 1, z: 3 }],
    });
    expect(r.text).toMatch(/contains half-voxel offsets/);
  });

  it('core along X with step=0.5 when half-voxels present', async () => {
    // Two voxels: one at x=2.5 (the half-voxel part), one at x=4
    // (integer). Iterating X with both pinned at y=1, z=3 yields
    // a 4-cell string from x=2.5 to x=4 at step 0.5:
    //   2.5→0, 3→., 3.5→., 4→0   ⇒   "0..0"
    const dir = await makeModel({
      'voxels.json': geo(
        [
          { name: 'p', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] },
          { name: 'q', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] },
        ],
        ['#F00'],
      ),
      'cuboidy.json': JSON.stringify({
        name: 'mixed',
        parts: [
          { name: 'p', position: [2.5, 1, 3] },
          { name: 'q', position: [4, 1, 3] },
        ],
      }),
    });
    const r = await runQuery(dir, {
      queries: [{
        kind: 'core',
        axis: 'x',
        pin1: { axis: 'y', value: 1 },
        pin2: { axis: 'z', value: 3 },
      }],
    });
    expect(r.text).toMatch(/core\(x,y=1,z=3\) x=2\.5\.\.4 step=0\.5: 0\.\.0/);
  });
});

describe('runQuery — IO + arg errors', () => {
  it('returns exit 2 when no queries given', async () => {
    const r = await runQuery(resolve(REPO_ROOT, SINGLE), { queries: [] });
    expect(r.exitCode).toBe(2);
  });

  it('returns exit 2 when voxels.json is missing', async () => {
    const dir = await makeModel({});
    const r = await runQuery(dir, {
      queries: [{ kind: 'at', x: 0, y: 0, z: 0 }],
    });
    expect(r.exitCode).toBe(2);
  });
});

// Rest rotations (§6.2 / §7.7): the grid keeps voxels axis-aligned, so
// the query surface must say so — and still answer at the rig-exact
// pivot placement of a rotated parent's child.
describe('runQuery — rest rotations', () => {
  it('warns about axis-aligned voxels and answers at the rotated placement', async () => {
    const dir = await makeModel({
      'voxels.json': geo(
        [
          { name: 'body', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] },
          { name: 'arm', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['1']] },
        ],
        ['#FF0000', '#00FF00'],
      ),
      'cuboidy.json': JSON.stringify({
        name: 'm',
        parts: [
          { name: 'body', rotation: [0, 90, 0] },
          { name: 'arm', parent: 'body', position: [2, 0, 0] },
        ],
      }),
    });
    const r = await runQuery(dir, {
      queries: [{ kind: 'at', x: 0, y: 0, z: -2 }],
    });
    expect(r.exitCode).toBe(0);
    // Ry(90) sends the arm's +X offset to −Z; its voxel answers there.
    expect(r.text).toContain('at(0,0,-2)=1');
    expect(r.text).toMatch(/warning: part "body" has manifest rotation/);
  });
});

// The acceptance contract for the C# port is numeric parity through this
// CLI, and until now the only numbers it printed were six bbox values and
// two range endpoints — everything else was palette characters over an
// AXIS-ALIGNED grid. Measured against the shipped models, that grid cannot
// see `pivot.rot` at all (only windmill uses it, on childless blades) nor
// the §7.7 composition order. These queries print the rig math itself.
describe('runQuery — --transforms / --sockets', () => {
  const model = (name: string) => resolve(REPO_ROOT, 'models', name);
  const lines = (text: string, prefix: string) =>
    text.split('\n').filter((l) => l.startsWith(prefix));

  it('prints a world transform per part, six decimals', async () => {
    const r = await runQuery(model('knight'), {
      queries: [{ kind: 'transforms' }],
    });
    expect(r.exitCode).toBe(0);
    const t = lines(r.text, 'transform ');
    expect(t.length).toBeGreaterThan(10);
    for (const line of t) {
      expect(line).toMatch(
        /^transform \S+ pos=-?\d+\.\d{6},-?\d+\.\d{6},-?\d+\.\d{6} quat=-?\d+\.\d{6},-?\d+\.\d{6},-?\d+\.\d{6},-?\d+\.\d{6}$/,
      );
    }
  });

  it('never prints -0', async () => {
    // JavaScript renders it "0" and .NET renders it "-0", so a text
    // comparison would disagree on a value both agree about.
    for (const name of ['fox', 'knight', 'windmill', 'koi']) {
      const r = await runQuery(model(name), {
        queries: [{ kind: 'transforms' }, { kind: 'sockets' }],
      });
      expect(r.text, name).not.toMatch(/=-0\.000000|,-0\.000000/);
    }
  });

  it('makes pivot.rot observable — the grid cannot', async () => {
    // windmill is the only model that uses `pivot.rot`, and its five
    // bearers are childless leaves, so dropping the field entirely moves
    // no voxel in any shipped model. It moves these quaternions.
    const r = await runQuery(model('windmill'), {
      queries: [{ kind: 'transforms' }],
    });
    const fans = lines(r.text, 'transform fan-').filter((l) =>
      /fan-[1-5] /.test(l),
    );
    expect(fans).toHaveLength(5);
    for (const line of fans) {
      expect(line).not.toContain('quat=0.000000,0.000000,0.000000,1.000000');
    }
    // And they differ from each other — the blades are the same shape at
    // five different pivot rotations, so a port that ignored the field
    // would print one identical quaternion five times.
    const quats = new Set(fans.map((l) => l.split('quat=')[1]));
    expect(quats.size).toBe(5);
  });

  it('prints published socket frames as numbers', async () => {
    const r = await runQuery(model('knight'), {
      queries: [{ kind: 'sockets' }],
    });
    const s = lines(r.text, 'socket ');
    expect(s.map((l) => l.split(' ')[1])).toEqual(['crest', 'weapon']);
  });

  it('says so when a model publishes none', async () => {
    const r = await runQuery(model('koi'), { queries: [{ kind: 'sockets' }] });
    expect(r.text).toContain('sockets: (model publishes none)');
  });

  it('samples a clip, moving both transforms and sockets', async () => {
    const rest = await runQuery(model('knight'), {
      queries: [{ kind: 'transforms' }, { kind: 'sockets' }],
    });
    const posed = await runQuery(model('knight'), {
      queries: [{ kind: 'transforms' }, { kind: 'sockets' }],
      anim: 'walk',
      time: 0.4,
    });
    expect(posed.exitCode).toBe(0);
    expect(posed.text).toContain('anim: walk t=0.400000');
    expect(lines(posed.text, 'transform ')).not.toEqual(
      lines(rest.text, 'transform '),
    );
    expect(lines(posed.text, 'socket ')).not.toEqual(
      lines(rest.text, 'socket '),
    );
  });

  it('wraps a time past the clip, per §6.7', async () => {
    const at = async (time: number) =>
      lines(
        (
          await runQuery(model('knight'), {
            queries: [{ kind: 'transforms' }],
            anim: 'walk',
            time,
          })
        ).text,
        'transform ',
      );
    // knight/walk is a 1.0s loop, so one full period later is the same
    // pose — and the wrap is the shared clampToClip, not a second formula.
    const t0 = await at(0.25);
    const wrapped = await at(1.25);
    expect(wrapped).toEqual(t0);
  });

  it('names the clips it has when asked for one it does not', async () => {
    const r = await runQuery(model('knight'), {
      queries: [{ kind: 'transforms' }],
      anim: 'sprint',
    });
    expect(r.exitCode).toBe(2);
    expect(r.text).toContain('has: walk');
  });

  it('warns that the voxel grid is rest-only', async () => {
    const r = await runQuery(model('knight'), {
      queries: [{ kind: 'at', x: 0, y: 10, z: 0 }],
      anim: 'walk',
      time: 0.4,
    });
    expect(r.text).toContain('read the rest-pose grid');
  });
});
