import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest.js';
import type { Manifest } from '../src/manifest.js';
import {
  normalizeRefPath,
  projectFilePaths,
  resolveProject,
} from '../src/project.js';
import { geo } from './helpers/geometry.js';

// SPEC §6.10: the shared project-resolution layer — geometry list and
// palette binding.

function manifest(json: object): Manifest {
  const r = parseManifest(json);
  if (!r.ok) throw new Error(`manifest failed: ${r.message}`);
  return r.value;
}

describe('projectFilePaths', () => {
  it('applies the voxels.json default without a manifest', () => {
    expect(projectFilePaths(null)).toEqual({
      geometry: ['voxels.json'],
      animations: [],
    });
  });

  it('normalizes geometry, palette and animation refs', () => {
    const m = manifest({
      name: 'm',
      geometry: ['./body.json', 'gear/./hat.json'],
      palette: './palette.json',
      parts: [{ name: 'body' }],
      animations: { walk: './anims/walk.json' },
    });
    expect(projectFilePaths(m)).toEqual({
      geometry: ['body.json', 'gear/hat.json'],
      palette: 'palette.json',
      animations: ['anims/walk.json'],
    });
  });
});

describe('resolveProject', () => {
  const MANIFEST = manifest({
    name: 'm',
    geometry: ['body.json', 'arms.json'],
    palette: 'palette.json',
    parts: [{ name: 'arm' }, { name: 'arm_l', parent: 'arm' }],
  });
  // resolveProject is handed file *contents*, so these must be the JSON the
  // loader will actually read.
  const BODY = geo([{ name: 'arm', size: [2, 1, 1], voxels: [['01']] }]);
  const ARMS = geo([{ name: 'arm_l', size: [2, 1, 1], voxels: [['10']] }]);

  it('loads geometry files in list order plus the bound palette', () => {
    const r = resolveProject(
      MANIFEST,
      new Map([
        ['body.json', BODY],
        ['arms.json', ARMS],
        ['palette.json', '{ "colors": ["#FF0000", "#00FF00"] }'],
      ]),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.geometries.map((g) => g.path)).toEqual(['body.json', 'arms.json']);
    expect(r.geometries[1]!.geometry.parts[0]!.name).toBe('arm_l');
    expect(r.externalPalette).toHaveLength(2);
  });

  it('reports a missing geometry file and marks the project incomplete', () => {
    const r = resolveProject(MANIFEST, new Map([['body.json', BODY]]));
    expect(r.complete).toBe(false);
    const missing = r.diagnostics.filter((d) => d.diag.code === 'missing');
    expect(missing.map((d) => d.file)).toEqual(['arms.json', 'palette.json']);
  });

  it('reports a palette JSON error', () => {
    const r = resolveProject(
      MANIFEST,
      new Map([
        ['body.json', BODY],
        ['arms.json', ARMS],
        ['palette.json', '{ broken'],
      ]),
    );
    expect(r.complete).toBe(false);
    const pal = r.diagnostics.find((d) => d.file === 'palette.json');
    expect(pal?.diag.message).toMatch(/^JSON parse:/);
  });
});

describe('normalizeRefPath', () => {
  it('resolves ./ and // segments', () => {
    expect(normalizeRefPath('./a.json')).toBe('a.json');
    expect(normalizeRefPath('a//b.json')).toBe('a/b.json');
    expect(normalizeRefPath('a/./b.json')).toBe('a/b.json');
    expect(normalizeRefPath('a/../b.json')).toBe('b.json');
  });

  it('preserves leading .. (outside the package)', () => {
    expect(normalizeRefPath('../shared/p.json')).toBe('../shared/p.json');
  });
});
