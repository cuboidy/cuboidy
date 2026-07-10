import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadAndAssemble, stringifyCoord } from '../src/cli/assemble.js';

// SPEC §6.9 / §6.10 through the inspection-CLI assembly layer: manifest
// geometry lists, external palette binding, and cross-file reuse — the
// same project resolution lint and the editor use.

async function makeModel(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-assemble-test-'));
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }
  return dir;
}

const ONE_VOXEL = (color: string) =>
  `palette ${color}\npart p\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 0 }`;

describe('loadAndAssemble — §6.9 geometry list', () => {
  it('loads a package whose manifest lists geometry files (no voxels.cvox)', async () => {
    const dir = await makeModel({
      'body.cvox':
        'palette #FF0000\npart body\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 0 }',
      'gear/hat.cvox':
        'palette #00FF00\npart hat\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 0 }',
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.cvox', 'gear/hat.cvox'],
        parts: [
          { name: 'body' },
          { name: 'hat', parent: 'body', position: [0, 2, 0] },
        ],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.assembly.geometries.map((g) => g.path)).toEqual([
      'body.cvox',
      'gear/hat.cvox',
    ]);
    expect(r.assembly.grid.get(stringifyCoord(0, 0, 0))).toBe(0);
    // hat's index 0 remaps into the merged palette (green = merged 1).
    expect(r.assembly.grid.get(stringifyCoord(0, 2, 0))).toBe(1);
    expect(r.assembly.palette).toHaveLength(2);
  });

  it('reports a listed-but-absent geometry file as setup failure (exit 2)', async () => {
    const dir = await makeModel({
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.cvox'],
        parts: [{ name: 'body' }],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.exitCode).toBe(2);
    expect(r.message).toMatch(/body\.cvox/);
  });

  it('assembles a cross-file clone with the referent file colors', async () => {
    const dir = await makeModel({
      'body.cvox':
        'palette #FF0000 #00FF00\npart arm\n    size 2 1 1\n    pivot 0 0 0\n    voxels { 01 }',
      'arms.cvox': 'part arm_l clone arm',
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.cvox', 'arms.cvox'],
        parts: [
          { name: 'arm' },
          { name: 'arm_l', parent: 'arm', position: [0, 3, 0] },
        ],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The clone's voxels keep the referent's palette indices (0=red, 1=green)
    // even though arms.cvox has no inline palette of its own.
    expect(r.assembly.grid.get(stringifyCoord(0, 3, 0))).toBe(0);
    expect(r.assembly.grid.get(stringifyCoord(1, 3, 0))).toBe(1);
  });

  it('surfaces an unresolvable cross-file referent as exit 1', async () => {
    const dir = await makeModel({
      'body.cvox': ONE_VOXEL('#FF0000'),
      'arms.cvox': 'part arm_l clone nope',
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.cvox', 'arms.cvox'],
        parts: [{ name: 'p' }, { name: 'arm_l', parent: 'p' }],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.exitCode).toBe(1);
    expect(r.message).toMatch(/unknown part "nope"/);
  });
});

describe('loadAndAssemble — §6.10 external palette', () => {
  it('binds an external palette over a palette-less geometry file', async () => {
    const dir = await makeModel({
      'voxels.cvox':
        'part p\n    size 2 1 1\n    pivot 0 0 0\n    voxels { 01 }',
      'palette.json': '{ "colors": ["#112233", "#445566"] }',
      'cuboidy.json': JSON.stringify({
        name: 'm',
        palette: 'palette.json',
        parts: [{ name: 'p' }],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.assembly.palette).toEqual([
      { r: 0x11, g: 0x22, b: 0x33, a: 0xff },
      { r: 0x44, g: 0x55, b: 0x66, a: 0xff },
    ]);
    expect(r.assembly.grid.get(stringifyCoord(1, 0, 0))).toBe(1);
  });

  it('rejects a bound palette shorter than the used indices (exit 1)', async () => {
    const dir = await makeModel({
      'voxels.cvox':
        'part p\n    size 2 1 1\n    pivot 0 0 0\n    voxels { 01 }',
      'palette.json': '{ "colors": ["#112233"] }',
      'cuboidy.json': JSON.stringify({
        name: 'm',
        palette: 'palette.json',
        parts: [{ name: 'p' }],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.exitCode).toBe(1);
    expect(r.message).toMatch(/palette index 1/);
  });

  it('rejects color indices with neither inline palette nor binding (exit 1)', async () => {
    const dir = await makeModel({
      'voxels.cvox':
        'part p\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 0 }',
      'cuboidy.json': JSON.stringify({ name: 'm', parts: [{ name: 'p' }] }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.exitCode).toBe(1);
    expect(r.message).toMatch(/no palette is available/);
  });
});

describe('loadAndAssemble — merged inline palettes', () => {
  it('dedupes shared colors and remaps later files into the merged palette', async () => {
    const dir = await makeModel({
      'a.cvox': ONE_VOXEL('#FF0000 #00FF00'),
      'b.cvox':
        'palette #0000FF #FF0000\npart q\n    size 2 1 1\n    pivot 0 0 0\n    voxels { 01 }',
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['a.cvox', 'b.cvox'],
        parts: [{ name: 'p' }, { name: 'q', parent: 'p', position: [0, 5, 0] }],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Merged: [red, green, blue] — b.cvox's red dedupes into slot 0.
    expect(r.assembly.palette).toHaveLength(3);
    expect(r.assembly.grid.get(stringifyCoord(0, 5, 0))).toBe(2); // blue
    expect(r.assembly.grid.get(stringifyCoord(1, 5, 0))).toBe(0); // red
  });
});
