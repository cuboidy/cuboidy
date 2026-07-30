import { describe, expect, it } from 'vitest';
import { parseGeometryText, type Geometry, type Manifest } from '@cuboidy/core';
import {
  isGeometryPath,
  loadFromFileList,
  normalizePath,
  resolveProjectRefs,
} from '../src/lib/load-model.js';

// resolveProjectRefs is the pure `(manifest, files) -> derived state`
// function the whole project layer hangs off: the loader calls it, the
// manifest re-parse calls it, and "add file to model" calls it. Locking
// its behaviour down here is what makes it safe to route the REST of the
// editor's hand-maintained derived state through it.

const GEOM = (name: string, color: string): string =>
  JSON.stringify({
    version: '0.9',
    palette: [color],
    parts: [{ name, size: [1, 1, 1], voxels: [['0']] }],
  });

function geom(text: string): Geometry {
  const r = parseGeometryText(text);
  if (!r.ok) throw new Error(`fixture does not parse: ${r.message}`);
  return r.value;
}

function manifest(patch: Partial<Manifest> = {}): Manifest {
  return { name: 'model', parts: [{ name: 'a' }], ...patch };
}

// A file map as the `getText` callback resolveProjectRefs expects.
const texts =
  (files: Record<string, string>) =>
  (p: string): string | undefined =>
    files[p];

describe('normalizePath', () => {
  it('collapses empty and "." segments', () => {
    expect(normalizePath('a//b/./c.json')).toBe('a/b/c.json');
    expect(normalizePath('./voxels.json')).toBe('voxels.json');
  });

  it('resolves ".." against a preceding segment', () => {
    expect(normalizePath('a/b/../c.json')).toBe('a/c.json');
    expect(normalizePath('a/b/../../c.json')).toBe('c.json');
  });

  it('preserves leading ".." (outside the package)', () => {
    expect(normalizePath('../shared/palette.json')).toBe('../shared/palette.json');
    expect(normalizePath('../../a.json')).toBe('../../a.json');
  });

  it('is idempotent', () => {
    const once = normalizePath('./a/b/../c//d.json');
    expect(normalizePath(once)).toBe(once);
  });
});

describe('isGeometryPath', () => {
  it('always accepts the primary file, manifest or not', () => {
    expect(isGeometryPath('voxels.json', 'voxels.json', undefined)).toBe(true);
    expect(isGeometryPath('./voxels.json', 'voxels.json', undefined)).toBe(true);
  });

  it('accepts files the manifest lists as geometry', () => {
    const m = manifest({ geometry: ['body.json', 'gear/hat.json'] });
    expect(isGeometryPath('body.json', 'body.json', m)).toBe(true);
    expect(isGeometryPath('gear/hat.json', 'body.json', m)).toBe(true);
  });

  it('rejects package files the manifest does not list as geometry', () => {
    const m = manifest({ geometry: ['body.json'], palette: 'palette.json' });
    expect(isGeometryPath('palette.json', 'body.json', m)).toBe(false);
    expect(isGeometryPath('anims/wave.json', 'body.json', m)).toBe(false);
    expect(isGeometryPath('README.md', 'body.json', m)).toBe(false);
  });

  it('without a manifest, only the primary counts', () => {
    expect(isGeometryPath('other.json', 'voxels.json', undefined)).toBe(false);
  });
});

describe('resolveProjectRefs — geometry list', () => {
  it('with no manifest, resolves the primary alone', () => {
    const primary = { path: 'voxels.json', geometry: geom(GEOM('a', '#FF0000')) };
    const refs = resolveProjectRefs(undefined, texts({}), primary);
    expect([...refs.geometries.keys()]).toEqual(['voxels.json']);
    expect(refs.geometries.get('voxels.json')).toBe(primary.geometry);
    expect(refs.projectErrors).toEqual([]);
  });

  it("prefers the primary's in-memory AST over its file text", () => {
    // The live-edited primary is authoritative: a stale file-map snapshot
    // must not win, or a mid-edit AST would be silently rolled back.
    const primary = { path: 'voxels.json', geometry: geom(GEOM('live', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['voxels.json'] }),
      texts({ 'voxels.json': GEOM('stale', '#000000') }),
      primary,
    );
    expect(refs.geometries.get('voxels.json')).toBe(primary.geometry);
    expect(refs.geometries.get('voxels.json')?.parts[0]?.name).toBe('live');
  });

  it('parses every non-primary geometry file, in list order', () => {
    const primary = { path: 'body.json', geometry: geom(GEOM('body', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['body.json', 'limbs.json'] }),
      texts({ 'limbs.json': GEOM('arm', '#00FF00') }),
      primary,
    );
    expect([...refs.geometries.keys()]).toEqual(['body.json', 'limbs.json']);
    expect(refs.geometries.get('limbs.json')?.parts[0]?.name).toBe('arm');
    expect(refs.projectErrors).toEqual([]);
  });

  it('normalizes reference paths before lookup', () => {
    const primary = { path: 'body.json', geometry: geom(GEOM('body', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['body.json', './gear/../limbs.json'] }),
      texts({ 'limbs.json': GEOM('arm', '#00FF00') }),
      primary,
    );
    expect(refs.geometries.has('limbs.json')).toBe(true);
    expect(refs.projectErrors).toEqual([]);
  });

  it('reports a missing geometry file without dropping the others', () => {
    const primary = { path: 'body.json', geometry: geom(GEOM('body', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['body.json', 'gone.json', 'limbs.json'] }),
      texts({ 'limbs.json': GEOM('arm', '#00FF00') }),
      primary,
    );
    expect([...refs.geometries.keys()]).toEqual(['body.json', 'limbs.json']);
    expect(refs.projectErrors).toHaveLength(1);
    expect(refs.projectErrors[0]?.file).toBe('gone.json');
    expect(refs.projectErrors[0]?.message).toMatch(/not found/);
  });

  it('reports an unparseable geometry file', () => {
    const primary = { path: 'body.json', geometry: geom(GEOM('body', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['body.json', 'broken.json'] }),
      texts({ 'broken.json': '{ not json' }),
      primary,
    );
    expect(refs.geometries.has('broken.json')).toBe(false);
    expect(refs.projectErrors[0]?.file).toBe('broken.json');
  });

  it('flags a reference that escapes the package', () => {
    const primary = { path: 'body.json', geometry: geom(GEOM('body', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['body.json', '../shared/limbs.json'] }),
      texts({}),
      primary,
    );
    expect(refs.projectErrors[0]?.message).toMatch(/outside the package/);
  });
});

describe('resolveProjectRefs — palette binding', () => {
  const primary = () => ({
    path: 'voxels.json',
    geometry: geom(GEOM('a', '#FF0000')),
  });

  it('resolves a bound palette file', () => {
    const refs = resolveProjectRefs(
      manifest({ palette: 'palette.json' }),
      texts({ 'palette.json': '{"colors":["#112233","#445566"]}' }),
      primary(),
    );
    expect(refs.externalPalette).toHaveLength(2);
    expect(refs.externalPalette?.[0]).toMatchObject({ r: 0x11, g: 0x22, b: 0x33 });
    expect(refs.projectErrors).toEqual([]);
  });

  it('leaves the palette unresolved when the file is missing', () => {
    const refs = resolveProjectRefs(
      manifest({ palette: 'palette.json' }),
      texts({}),
      primary(),
    );
    expect(refs.externalPalette).toBeUndefined();
    expect(refs.projectErrors[0]?.file).toBe('palette.json');
  });

  it('leaves the palette unresolved when the file is not valid JSON', () => {
    const refs = resolveProjectRefs(
      manifest({ palette: 'palette.json' }),
      texts({ 'palette.json': '{ oops' }),
      primary(),
    );
    expect(refs.externalPalette).toBeUndefined();
    expect(refs.projectErrors[0]?.message).toMatch(/JSON parse/);
  });

  it('leaves the palette unresolved when the shape is wrong', () => {
    const refs = resolveProjectRefs(
      manifest({ palette: 'palette.json' }),
      texts({ 'palette.json': '{"colours":["#112233"]}' }),
      primary(),
    );
    expect(refs.externalPalette).toBeUndefined();
    expect(refs.projectErrors).toHaveLength(1);
  });

  it('reports nothing when no binding is declared', () => {
    const refs = resolveProjectRefs(manifest(), texts({}), primary());
    expect(refs.externalPalette).toBeUndefined();
    expect(refs.projectErrors).toEqual([]);
  });
});

describe('resolveProjectRefs — external animations', () => {
  const primary = () => ({
    path: 'voxels.json',
    geometry: geom(GEOM('a', '#FF0000')),
  });
  const CLIP = '{"duration":1,"loop":true,"parts":{}}';

  it('resolves a string ref, keyed by CLIP name rather than path', () => {
    const refs = resolveProjectRefs(
      manifest({ animations: { wave: 'anims/wave.json' } }),
      texts({ 'anims/wave.json': CLIP }),
      primary(),
    );
    expect(refs.externalAnims?.get('wave')).toEqual({
      path: 'anims/wave.json',
      anim: { duration: 1, loop: true, parts: {} },
    });
  });

  it('resolves two clips that share one file', () => {
    const refs = resolveProjectRefs(
      manifest({ animations: { wave: 'anims/w.json', greet: 'anims/w.json' } }),
      texts({ 'anims/w.json': CLIP }),
      primary(),
    );
    expect(refs.externalAnims?.get('wave')?.path).toBe('anims/w.json');
    expect(refs.externalAnims?.get('greet')?.path).toBe('anims/w.json');
  });

  it('leaves inline clips alone', () => {
    const refs = resolveProjectRefs(
      manifest({ animations: { wave: { duration: 1, loop: true, parts: {} } } }),
      texts({}),
      primary(),
    );
    expect(refs.externalAnims).toBeUndefined();
    expect(refs.projectErrors).toEqual([]);
  });

  it('names the clip in the error when its file is missing', () => {
    const refs = resolveProjectRefs(
      manifest({ animations: { wave: 'anims/wave.json' } }),
      texts({}),
      primary(),
    );
    expect(refs.externalAnims).toBeUndefined();
    expect(refs.projectErrors[0]?.message).toMatch(/wave/);
  });

  it('reports a schema-invalid clip file', () => {
    const refs = resolveProjectRefs(
      manifest({ animations: { wave: 'anims/wave.json' } }),
      texts({ 'anims/wave.json': '{"duration":-1,"parts":{}}' }),
      primary(),
    );
    expect(refs.externalAnims).toBeUndefined();
    expect(refs.projectErrors).toHaveLength(1);
  });
});

describe('loadFromFileList', () => {
  // Node's File has no webkitRelativePath at all, but the DOM's always
  // DEFINES it — as "" for a File that did not come from a directory
  // picker. Defining it explicitly is what makes these tests exercise the
  // real browser contract rather than Node's.
  const fileList = (
    entries: ReadonlyArray<{ name: string; text: string; rel: string }>,
  ): FileList => {
    const files = entries.map((e) => {
      const f = new File([e.text], e.name, { type: 'application/json' });
      Object.defineProperty(f, 'webkitRelativePath', { value: e.rel });
      return f;
    });
    return Object.assign(files, {
      item: (i: number) => files[i] ?? null,
    }) as unknown as FileList;
  };

  const MANIFEST = JSON.stringify({
    name: 'model',
    geometry: ['body.json'],
    parts: [{ name: 'a' }],
  });

  it('takes the package name from the first path segment', async () => {
    const r = await loadFromFileList(
      fileList([
        { name: 'cuboidy.json', text: MANIFEST, rel: 'robo/cuboidy.json' },
        { name: 'body.json', text: GEOM('a', '#FF0000'), rel: 'robo/body.json' },
      ]),
    );
    expect(r.error).toBeUndefined();
    expect(r.source?.folderName).toBe('robo');
    expect(r.source?.manifest?.name).toBe('model');
    expect([...(r.source?.files?.keys() ?? [])]).toEqual([
      'cuboidy.json',
      'body.json',
    ]);
  });

  it('falls back to the bare file name when the relative path is empty', async () => {
    // Regression: an empty webkitRelativePath used to reach `?? f.name`,
    // which does not treat "" as absent — every path became "", failed the
    // text-file filter, and the package loaded as empty.
    const r = await loadFromFileList(
      fileList([
        { name: 'cuboidy.json', text: MANIFEST, rel: '' },
        { name: 'body.json', text: GEOM('a', '#FF0000'), rel: '' },
      ]),
    );
    expect(r.error).toBeUndefined();
    expect(r.source?.manifest?.name).toBe('model');
    expect(r.source?.geometries?.has('body.json')).toBe(true);
  });

  it('skips files the loader does not read as text', async () => {
    const r = await loadFromFileList(
      fileList([
        { name: 'cuboidy.json', text: MANIFEST, rel: 'robo/cuboidy.json' },
        { name: 'body.json', text: GEOM('a', '#FF0000'), rel: 'robo/body.json' },
        { name: 'thumb.png', text: 'not really a png', rel: 'robo/thumb.png' },
      ]),
    );
    expect(r.source?.files?.has('thumb.png')).toBe(false);
  });
});
