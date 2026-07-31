import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtemp, writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  DEFAULT_ANGLES,
  DEFAULTS,
  renderSnapshots,
  runSnap,
  type SnapOptions,
} from '../src/cli/snap-runner.js';
import { loadAndAssemble } from '../src/cli/assemble.js';
import { geo } from './helpers/geometry.js';
import { SINGLE } from './helpers/corpus.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CROWN = resolve(REPO_ROOT, SINGLE);

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(buf: Buffer): boolean {
  return PNG_SIG.every((b, i) => buf[i] === b);
}

function pngDims(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function opts(over: Partial<SnapOptions> = {}): SnapOptions {
  return {
    angles: DEFAULT_ANGLES,
    tileSize: 64,
    ss: 1,
    bg: DEFAULTS.bg,
    cols: 4,
    sheet: true,
    individual: true,
    outDir: '(unused)',
    ...over,
  };
}

async function makeModel(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-snap-test-'));
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }
  return dir;
}

describe('renderSnapshots — crown model', () => {
  it('renders one valid PNG per angle plus a contact sheet', async () => {
    const loaded = await loadAndAssemble(CROWN);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const out = renderSnapshots(loaded.assembly, opts());
    expect(out.tiles).toHaveLength(DEFAULT_ANGLES.length);
    for (const tile of out.tiles) {
      expect(isPng(tile.png)).toBe(true);
      expect(pngDims(tile.png)).toEqual({ width: 64, height: 64 });
    }
    expect(out.sheet).not.toBeNull();
    expect(isPng(out.sheet!)).toBe(true);
    // The sheet is larger than a single tile in both dimensions.
    const d = pngDims(out.sheet!);
    expect(d.width).toBeGreaterThan(64);
    expect(d.height).toBeGreaterThan(64);
  });

  it('honors the tile size and supersample factor', async () => {
    const loaded = await loadAndAssemble(CROWN);
    if (!loaded.ok) return;
    const out = renderSnapshots(loaded.assembly, opts({ tileSize: 96, ss: 2 }));
    expect(pngDims(out.tiles[0]!.png)).toEqual({ width: 96, height: 96 });
  });

  it('omits the contact sheet when sheet=false', async () => {
    const loaded = await loadAndAssemble(CROWN);
    if (!loaded.ok) return;
    const out = renderSnapshots(loaded.assembly, opts({ sheet: false }));
    expect(out.sheet).toBeNull();
    expect(out.tiles).toHaveLength(DEFAULT_ANGLES.length);
  });

  it('renders only the requested angles', async () => {
    const loaded = await loadAndAssemble(CROWN);
    if (!loaded.ok) return;
    const front = DEFAULT_ANGLES.find((a) => a.id === 'front')!;
    const out = renderSnapshots(loaded.assembly, opts({ angles: [front] }));
    expect(out.tiles.map((t) => t.id)).toEqual(['front']);
  });

  it('is deterministic', async () => {
    const loaded = await loadAndAssemble(CROWN);
    if (!loaded.ok) return;
    const a = renderSnapshots(loaded.assembly, opts());
    const b = renderSnapshots(loaded.assembly, opts());
    expect(a.tiles[0]!.png.equals(b.tiles[0]!.png)).toBe(true);
    expect(a.sheet!.equals(b.sheet!)).toBe(true);
  });
});

describe('runSnap — filesystem', () => {
  it('writes per-angle PNGs and the contact sheet, exit 0', async () => {
    const outDir = await mkdtemp(resolve(tmpdir(), 'cuboidy-snap-out-'));
    const r = await runSnap(CROWN, opts({ outDir }));
    expect(r.exitCode).toBe(0);
    const files = (await readdir(outDir)).sort();
    expect(files).toContain('contact.png');
    expect(files).toContain('front.png');
    expect(files.filter((f) => f.endsWith('.png'))).toHaveLength(
      DEFAULT_ANGLES.length + 1,
    );
    expect(isPng(await readFile(resolve(outDir, 'contact.png')))).toBe(true);
  });

  it('skips per-angle PNGs when individual=false', async () => {
    const outDir = await mkdtemp(resolve(tmpdir(), 'cuboidy-snap-out-'));
    await runSnap(CROWN, opts({ outDir, individual: false }));
    const files = await readdir(outDir);
    expect(files).toEqual(['contact.png']);
  });

  it('returns exit 1 for a model with no visible voxels', async () => {
    const dir = await makeModel({
      'voxels.json': geo(
        [{ name: 'p', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['.']] }],
        ['#F00'],
      ),
      'cuboidy.json': JSON.stringify({ name: 'empty', parts: [{ name: 'p' }] }),
    });
    const r = await runSnap(dir, opts({ outDir: dir }));
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/no visible voxels/);
  });

  it('returns exit 2 when voxels.json is missing', async () => {
    const dir = await makeModel({});
    const r = await runSnap(dir, opts({ outDir: dir }));
    expect(r.exitCode).toBe(2);
  });
});

describe('runSnap — rest rotations', () => {
  it('renders a rotated part with no rotation warning and widened bounds', async () => {
    // A 6-voxel boom resting at 45° about Z: rendered as true oriented
    // cubes (the old grid path drew it horizontal and warned).
    const dir = await makeModel({
      'voxels.json': geo(
        [
          {
            name: 'torso',
            size: [2, 1, 2],
            pivot: [1, 0, 1],
            voxels: [['00', '00']],
          },
          {
            name: 'boom',
            size: [6, 1, 1],
            pivot: [0, 0, 0],
            voxels: [['000001']],
          },
        ],
        ['#888888', '#FF3B30'],
      ),
      'cuboidy.json': JSON.stringify({
        name: 'boom45',
        parts: [
          { name: 'torso', position: [0, 0, 0] },
          { name: 'boom', parent: 'torso', position: [0, 2, 0], rotation: [0, 0, 45] },
        ],
      }),
    });
    const outDir = await mkdtemp(resolve(tmpdir(), 'cuboidy-snap-rot-'));
    const r = await runSnap(dir, opts({ outDir }));
    expect(r.exitCode).toBe(0);
    expect(r.text).not.toMatch(/rotation/);
    // The 6-long boom at 45° reaches y ≈ 2 + 6·sin45 ≈ 6.2: the reported
    // world bounds must cover the rotated extent, not the 1-high grid row.
    const m = r.text.match(/Y=(-?\d+)\.\.(-?\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![2])).toBeGreaterThanOrEqual(6);
    expect(isPng(await readFile(resolve(outDir, 'front.png')))).toBe(true);
  });
});

describe('renderSnapshots — v0.7 project shapes', () => {
  it('renders a model whose geometry references a palette file', async () => {
    const dir = await makeModel({
      'voxels.json': geo(
        [{ name: 'p', size: [2, 1, 1], pivot: [0, 0, 0], voxels: [['01']] }],
        'palette.json',
      ),
      'palette.json': JSON.stringify({ colors: ['#F00', '#0F0'] }),
      'cuboidy.json': JSON.stringify({ name: 'bound', parts: [{ name: 'p' }] }),
    });
    const loaded = await loadAndAssemble(dir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const out = renderSnapshots(loaded.assembly, opts());
    expect(out.tiles).toHaveLength(DEFAULT_ANGLES.length);
    for (const tile of out.tiles) expect(isPng(tile.png)).toBe(true);
  });

  it('renders a multi-geometry model spanning two geometry files', async () => {
    const dir = await makeModel({
      'body.json': geo(
        [{ name: 'arm', size: [2, 1, 1], pivot: [0, 0, 0], voxels: [['01']] }],
        ['#F00', '#0F0'],
      ),
      'arms.json': geo(
        [{ name: 'arm_r', size: [2, 1, 1], pivot: [2, 0, 0], voxels: [['10']] }],
        ['#F00', '#0F0'],
      ),
      'cuboidy.json': JSON.stringify({
        name: 'multi',
        geometry: ['body.json', 'arms.json'],
        parts: [
          { name: 'arm', position: [-2, 0, 0] },
          { name: 'arm_r', position: [2, 0, 0] },
        ],
      }),
    });
    const loaded = await loadAndAssemble(dir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const out = renderSnapshots(loaded.assembly, opts());
    for (const tile of out.tiles) expect(isPng(tile.png)).toBe(true);
  });
});
