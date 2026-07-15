import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest.js';
import type { Manifest } from '../src/manifest.js';
import {
  normalizeRefPath,
  projectFilePaths,
  resolveProject,
} from '../src/project.js';

// SPEC §6.10: the shared project-resolution layer — geometry list and
// palette binding.

function manifest(json: object): Manifest {
  const r = parseManifest(json);
  if (!r.ok) throw new Error(`manifest failed: ${r.message}`);
  return r.value;
}

describe('projectFilePaths', () => {
  it('applies the voxels.cvox default without a manifest', () => {
    expect(projectFilePaths(null)).toEqual({
      geometry: ['voxels.cvox'],
      animations: [],
    });
  });

  it('normalizes geometry, palette and animation refs', () => {
    const m = manifest({
      name: 'm',
      geometry: ['./body.cvox', 'gear/./hat.cvox'],
      palette: './palette.json',
      parts: [{ name: 'body' }],
      animations: { walk: './anims/walk.json' },
    });
    expect(projectFilePaths(m)).toEqual({
      geometry: ['body.cvox', 'gear/hat.cvox'],
      palette: 'palette.json',
      animations: ['anims/walk.json'],
    });
  });
});

describe('resolveProject', () => {
  const MANIFEST = manifest({
    name: 'm',
    geometry: ['body.cvox', 'arms.cvox'],
    palette: 'palette.json',
    parts: [{ name: 'arm' }, { name: 'arm_l', parent: 'arm' }],
  });
  const BODY = 'part arm\n    size 2 1 1\n    voxels { 01 }';
  const ARMS = 'part arm_l\n    size 2 1 1\n    voxels { 10 }';

  it('loads geometry files in list order plus the bound palette', () => {
    const r = resolveProject(
      MANIFEST,
      new Map([
        ['body.cvox', BODY],
        ['arms.cvox', ARMS],
        ['palette.json', '{ "colors": ["#FF0000", "#00FF00"] }'],
      ]),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.geometries.map((g) => g.path)).toEqual(['body.cvox', 'arms.cvox']);
    expect(r.geometries[1]!.cvox.parts[0]!.name).toBe('arm_l');
    expect(r.externalPalette).toHaveLength(2);
  });

  it('reports a missing geometry file and marks the project incomplete', () => {
    const r = resolveProject(MANIFEST, new Map([['body.cvox', BODY]]));
    expect(r.complete).toBe(false);
    const missing = r.diagnostics.filter((d) => d.diag.code === 'missing');
    expect(missing.map((d) => d.file)).toEqual(['arms.cvox', 'palette.json']);
  });

  it('reports a palette JSON error', () => {
    const r = resolveProject(
      MANIFEST,
      new Map([
        ['body.cvox', BODY],
        ['arms.cvox', ARMS],
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
    expect(normalizeRefPath('./a.cvox')).toBe('a.cvox');
    expect(normalizeRefPath('a//b.cvox')).toBe('a/b.cvox');
    expect(normalizeRefPath('a/./b.cvox')).toBe('a/b.cvox');
    expect(normalizeRefPath('a/../b.cvox')).toBe('b.cvox');
  });

  it('preserves leading .. (outside the package)', () => {
    expect(normalizeRefPath('../shared/p.json')).toBe('../shared/p.json');
  });
});
