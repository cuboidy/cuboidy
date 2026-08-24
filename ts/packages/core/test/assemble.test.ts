import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  gridRotationWarnings,
  loadAndAssemble,
  stringifyCoord,
} from '../src/cli/assemble.js';
import { geo } from './helpers/geometry.js';
import { rgba } from './helpers/palette.js';

// SPEC §6.10 through the inspection-CLI assembly layer: manifest geometry
// lists and per-file palette references — the same project resolution lint
// and the editor use.

async function makeModel(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-assemble-test-'));
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }
  return dir;
}

// A single-voxel part `p`, with however many colours the case needs in the
// palette (only index 0 is used).
const ONE_VOXEL = (...colors: string[]) =>
  geo([{ name: 'p', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] }], colors);

describe('loadAndAssemble — geometry list', () => {
  it('loads a package whose manifest lists geometry files (no voxels.json)', async () => {
    const dir = await makeModel({
      'body.json': geo(
        [{ name: 'body', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] }],
        ['#FF0000'],
      ),
      'gear/hat.json': geo(
        [{ name: 'hat', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] }],
        ['#00FF00'],
      ),
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

describe('loadAndAssemble — §7.4 referenced palette', () => {
  it('resolves the palette a geometry file points at', async () => {
    const dir = await makeModel({
      'voxels.json': geo(
        [{ name: 'p', size: [2, 1, 1], pivot: [0, 0, 0], voxels: [['01']] }],
        'palette.json',
      ),
      'palette.json': '{ "colors": ["#112233", "#445566"] }',
      'cuboidy.json': JSON.stringify({ name: 'm', parts: [{ name: 'p' }] }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.assembly.palette).toEqual([
      rgba(0x11, 0x22, 0x33, 0xff),
      rgba(0x44, 0x55, 0x66, 0xff),
    ]);
    expect(r.assembly.grid.get(stringifyCoord(1, 0, 0))).toBe(1);
  });

  it('rejects a referenced palette shorter than the used indices (exit 1)', async () => {
    const dir = await makeModel({
      'voxels.json': geo(
        [{ name: 'p', size: [2, 1, 1], pivot: [0, 0, 0], voxels: [['01']] }],
        'palette.json',
      ),
      'palette.json': '{ "colors": ["#112233"] }',
      'cuboidy.json': JSON.stringify({ name: 'm', parts: [{ name: 'p' }] }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.exitCode).toBe(1);
    expect(r.message).toMatch(/palette index 1/);
  });

  it('rejects color indices with no palette at all (exit 1)', async () => {
    const dir = await makeModel({
      'voxels.json': geo([
        { name: 'p', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] },
      ]),
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
      'a.json': ONE_VOXEL('#FF0000', '#00FF00'),
      'b.json': geo(
        [{ name: 'q', size: [2, 1, 1], pivot: [0, 0, 0], voxels: [['01']] }],
        ['#0000FF', '#FF0000'],
      ),
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

  // SPEC §7.4 caps a palette at 64 — that is how many characters the voxel
  // alphabet has — so a merged palette above it is not a cuboidy palette and
  // cannot be written, printed or indexed. This used to be a WARNING pushed
  // onto a list the runners print at the end, and every consumer reached
  // `indexToChar` first and died with a RangeError, so the advice arrived
  // after the crash it existed to prevent.
  it('refuses a merge over 64 colors instead of crashing downstream', async () => {
    const forty = (base: number) =>
      Array.from({ length: 40 }, (_, i) =>
        `#${(((base + i) * 2654435761) % 0x1000000).toString(16).padStart(6, '0').toUpperCase()}`,
      );
    const dir = await makeModel({
      'a.json': geo(
        [{ name: 'p', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] }],
        forty(1),
      ),
      'b.json': geo(
        [{ name: 'q', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] }],
        forty(900),
      ),
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['a.json', 'b.json'],
        parts: [{ name: 'p' }, { name: 'q', parent: 'p' }],
      }),
    });
    const r = await loadAndAssemble(dir);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('80');
    expect(r.message).toContain('64');
  });
});

// SPEC §6.2 / §7.7 rest rotations through the shared rig-transform layer:
// pivot placement is exact (a child of a rotated parent lands where the
// rig puts it); each part's own voxels stay axis-aligned in the grid.
describe('loadAndAssemble — rest rotations', () => {
  const TWO_PARTS = geo(
    [
      { name: 'body', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] },
      { name: 'arm', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['1']] },
    ],
    ['#FF0000', '#00FF00'],
  );

  it("places a child's voxels at the parent-rotated pivot (float noise cleaned)", async () => {
    const dir = await makeModel({
      'voxels.json': TWO_PARTS,
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
      'voxels.json': TWO_PARTS,
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
      'voxels.json': geo(
        [
          {
            name: 'body',
            size: [1, 1, 1],
            pivot: [0, 0, 0],
            pivotRot: [0, 45, 0],
            voxels: [['0']],
          },
          { name: 'arm', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['1']] },
        ],
        ['#FF0000', '#00FF00'],
      ),
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
      'voxels.json': TWO_PARTS,
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
