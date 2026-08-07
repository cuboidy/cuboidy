import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest.js';
import type { Manifest } from '../src/manifest.js';
import {
  normalizeRefPath,
  projectFilePaths,
  resolveProject,
} from '../src/project.js';
import { geo } from './helpers/geometry.js';

// SPEC §6.9 / §7.4: the shared project-resolution layer — geometry list
// and per-file palette references.

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

  it('normalizes geometry and animation refs', () => {
    const m = manifest({
      name: 'm',
      geometry: ['./body.json', 'gear/./hat.json'],
      parts: [{ name: 'body' }],
      animations: { walk: './anims/walk.json' },
    });
    expect(projectFilePaths(m)).toEqual({
      geometry: ['body.json', 'gear/hat.json'],
      animations: ['anims/walk.json'],
    });
  });
});

describe('resolveProject', () => {
  const MANIFEST = manifest({
    name: 'm',
    geometry: ['body.json', 'arms.json'],
    parts: [{ name: 'arm' }, { name: 'arm_l', parent: 'arm' }],
  });
  // resolveProject is handed file *contents*, so these must be the JSON the
  // loader will actually read.
  // Both files point at ONE shared palette file (§7.4 reference form).
  const BODY = geo([{ name: 'arm', size: [2, 1, 1], voxels: [['01']] }], 'palette.json');
  const ARMS = geo([{ name: 'arm_l', size: [2, 1, 1], voxels: [['10']] }], 'palette.json');

  it('loads geometry files in list order and resolves their palette', () => {
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
    // The reference is resolved IN PLACE, once per file, and the ref is kept
    // so a re-serialize keeps pointing at the shared file.
    for (const g of r.geometries) {
      expect(g.geometry.palette).toHaveLength(2);
      expect(g.geometry.paletteRef).toBe('palette.json');
    }
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

// SPEC §11.6 / §11.8 phase 4: "the same part name defined in more than one
// file of the `geometry` list". Reported here rather than by lint, because
// what it breaks is the by-`name` lookup — a runtime with no lint (the C#
// port) would otherwise bind the name to whichever file it saw first, which
// is a choice about collection ordering rather than about the model.
describe('resolveProject — ambiguous part names (§11.6)', () => {
  const twoFiles = (extra: object = {}) => ({
    name: 't',
    geometry: ['a.json', 'b.json'],
    parts: [{ name: 'body' }],
    ...extra,
  });
  const one = (name: string) => geo([{ name, size: [1, 1, 1], voxels: [['0']] }]);
  const body = one('body');

  it('refuses to resolve a name defined in two listed files', () => {
    const p = resolveProject(
      manifest(twoFiles()),
      new Map([
        ['a.json', body],
        ['b.json', body],
      ]),
    );
    expect(p.complete).toBe(false);
    const dup = p.diagnostics.find((d) => d.diag.code === 'duplicate');
    expect(dup?.diag.severity).toBe('error');
    expect(dup?.diag.message).toContain('a.json');
    expect(dup?.diag.message).toContain('b.json');
  });

  it('resolves cleanly when the name is defined once', () => {
    const p = resolveProject(
      manifest(twoFiles()),
      new Map([
        ['a.json', body],
        ['b.json', one('tail')],
      ]),
    );
    expect(p.complete).toBe(true);
    expect(p.parts.get('body')?.source?.file).toBe('a.json');
  });

  it('a file reached only by geometry.path does not take part', () => {
    // §11.6 says so explicitly, and the by-name lookup must agree: the
    // `path` form binds by path, so its own part names are its business.
    const p = resolveProject(
      manifest({
        name: 't',
        geometry: ['a.json'],
        parts: [
          { name: 'body' },
          { name: 'clone', geometry: { path: 'b.json', part: 'body' } },
        ],
      }),
      new Map([
        ['a.json', body],
        ['b.json', body],
      ]),
    );
    expect(p.complete).toBe(true);
    expect(p.parts.get('body')?.source?.file).toBe('a.json');
    expect(p.parts.get('clone')?.source?.file).toBe('b.json');
  });
});
