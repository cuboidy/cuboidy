import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  gridRotationWarnings,
  loadAndAssemble,
  stringifyCoord,
} from '../src/cli/assemble.js';
import { geoFromText } from './helpers/geometry.js';

// SPEC §6.10 through the inspection-CLI assembly layer: manifest geometry
// lists and external palette binding — the same project resolution lint
// and the editor use.

// Geometry fixtures are authored in the compact text syntax and written out as
// JSON — see geoFromText in helpers/geometry.ts. A `.cvox` key marks "this
// value is geometry"; the file that lands on disk is `.json`, which is what the
// manifests below reference and what the loader reads.
async function makeModel(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-assemble-test-'));
  for (const [name, content] of Object.entries(files)) {
    const geometry = name.endsWith('.cvox');
    const path = resolve(dir, geometry ? name.replace(/\.cvox$/, '.json') : name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, geometry ? geoFromText(content) : content, 'utf-8');
  }
  return dir;
}

const ONE_VOXEL = (color: string) =>
  `palette ${color}\npart p\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 0 }`;

describe('loadAndAssemble — geometry list', () => {
  it('loads a package whose manifest lists geometry files (no voxels.json)', async () => {
    const dir = await makeModel({
      'body.cvox':
        'palette #FF0000\npart body\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 0 }',
      'gear/hat.cvox':
        'palette #00FF00\npart hat\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 0 }',
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.json', 'gear/hat.json'],
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
      'body.json',
      'gear/hat.json',
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
        geometry: ['body.json'],
        parts: [{ name: 'body' }],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.exitCode).toBe(2);
    expect(r.message).toMatch(/body\.json/);
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
        geometry: ['a.json', 'b.json'],
        parts: [{ name: 'p' }, { name: 'q', parent: 'p', position: [0, 5, 0] }],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Merged: [red, green, blue] — b.json's red dedupes into slot 0.
    expect(r.assembly.palette).toHaveLength(3);
    expect(r.assembly.grid.get(stringifyCoord(0, 5, 0))).toBe(2); // blue
    expect(r.assembly.grid.get(stringifyCoord(1, 5, 0))).toBe(0); // red
  });
});

// SPEC §6.2 / §7.7 rest rotations through the shared rig-transform layer:
// pivot placement is exact (a child of a rotated parent lands where the
// rig puts it); each part's own voxels stay axis-aligned in the grid.
describe('loadAndAssemble — rest rotations', () => {
  const TWO_PARTS = [
    'palette #FF0000 #00FF00',
    'part body\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 0 }',
    'part arm\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 1 }',
  ].join('\n');

  it("places a child's voxels at the parent-rotated pivot (float noise cleaned)", async () => {
    const dir = await makeModel({
      'voxels.cvox': TWO_PARTS,
      'cuboidy.json': JSON.stringify({
        name: 'm',
        parts: [
          { name: 'body', rotation: [0, 90, 0] },
          { name: 'arm', parent: 'body', position: [2, 0, 0] },
        ],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Ry(90) sends +X to −Z: the arm's pivot lands at exactly (0, 0, −2)
    // — round6 must strip the quaternion noise so the key is queryable.
    expect(r.assembly.grid.get(stringifyCoord(0, 0, -2))).toBe(1);
    expect(r.assembly.hasFractional).toBe(false);
  });

  it('exposes rotation-aware world transforms on resolvedParts', async () => {
    const dir = await makeModel({
      'voxels.cvox': TWO_PARTS,
      'cuboidy.json': JSON.stringify({
        name: 'm',
        parts: [
          { name: 'body', rotation: [0, 90, 0] },
          { name: 'arm', parent: 'body', position: [2, 0, 0] },
        ],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const arm = r.assembly.resolvedParts.find((p) => p.name === 'arm')!;
    expect(arm.transform.pos[0]).toBeCloseTo(0, 10);
    expect(arm.transform.pos[2]).toBeCloseTo(-2, 10);
    // The arm inherits the parent orientation (its quat turns +X to −Z).
    const q = arm.transform.quat;
    expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 10);
    expect(Math.abs(q[1])).toBeGreaterThan(0.1); // Y-axis rotation present
  });

  it('gridRotationWarnings names rotated parts; silent otherwise', async () => {
    const dir = await makeModel({
      'voxels.cvox': [
        'palette #FF0000 #00FF00',
        'part body\n    size 1 1 1\n    pivot 0 0 0 rot 0 45 0\n    voxels { 0 }',
        'part arm\n    size 1 1 1\n    pivot 0 0 0\n    voxels { 1 }',
      ].join('\n'),
      'cuboidy.json': JSON.stringify({
        name: 'm',
        parts: [
          { name: 'body' },
          { name: 'arm', parent: 'body', rotation: [0, 0, 30] },
        ],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const warnings = gridRotationWarnings(r.assembly);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/part "body" has pivot rotation/);
    expect(warnings[1]).toMatch(/part "arm" has manifest rotation/);
    // assembleWorld itself no longer emits rotation warnings.
    expect(r.assembly.warnings).toHaveLength(0);
  });

  it('emits no rotation warnings for an unrotated model', async () => {
    const dir = await makeModel({
      'voxels.cvox': TWO_PARTS,
      'cuboidy.json': JSON.stringify({
        name: 'm',
        parts: [{ name: 'body' }, { name: 'arm', position: [3, 0, 0] }],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(gridRotationWarnings(r.assembly)).toEqual([]);
  });
});
