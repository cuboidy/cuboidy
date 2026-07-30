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
import { geoFromText } from './helpers/geometry.js';

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

async function makeModel(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-query-test-'));
  for (const [name, content] of Object.entries(files)) {
    const geometry = name.endsWith('.cvox');
    const path = resolve(dir, geometry ? name.replace(/\.cvox$/, '.json') : name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, geometry ? geoFromText(content) : content, 'utf-8');
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

describe('runQuery — crown model (integer-only)', () => {
  const dir = resolve(REPO_ROOT, 'models/crown');

  // Crown geometry recap (models/crown/voxels.cvox):
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
    expect(r.text).toMatch(/^model: crown/m);
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
      'voxels.cvox':
        'palette #F00\npart p\nsize 1 1 1\npivot 0 0 0\nvoxels { 0 }',
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
      'voxels.cvox':
        'palette #F00\n' +
        'part p\nsize 1 1 1\npivot 0 0 0\nvoxels { 0 }\n' +
        'part q\nsize 1 1 1\npivot 0 0 0\nvoxels { 0 }',
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
    const r = await runQuery(resolve(REPO_ROOT, 'models/crown'), { queries: [] });
    expect(r.exitCode).toBe(2);
  });

  it('returns exit 2 when voxels.cvox is missing', async () => {
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
      'voxels.cvox': [
        'palette #FF0000 #00FF00',
        'part body\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 0 }',
        'part arm\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 1 }',
      ].join('\n'),
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
