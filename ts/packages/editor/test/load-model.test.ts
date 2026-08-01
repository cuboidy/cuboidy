import { describe, expect, it } from 'vitest';
import { parseGeometryText, parseManifest, type Geometry, type Manifest } from '@cuboidy/core';
import { strToU8, zipSync } from 'fflate';
import { isGeometryPath, isSafeEntryPath, loadFromCuboidyZip, loadFromFileList, normalizePath, resolveProjectRefs } from '../src/lib/load-model.js';
import { packageEntries } from '../src/lib/save.js';

// resolveProjectRefs is the pure `(manifest, files) -> derived state`
// function the whole project layer hangs off: the loader calls it, the
// manifest re-parse calls it, and "add file to model" calls it. Locking
// its behaviour down here is what makes it safe to route the REST of the
// editor's hand-maintained derived state through it.

const GEOM = (name: string, palette: string[] | string): string =>
  JSON.stringify({
    version: '0.9',
    palette,
    parts: [{ name, size: [1, 1, 1], voxels: [['0']] }],
  });
// Inline-palette fixture, the common case.
const GEOMC = (name: string, color: string): string => GEOM(name, [color]);

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

function manifestOf(text: string): Manifest {
  const r = parseManifest(JSON.parse(text));
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

function parseOk(text: string): Geometry {
  const r = parseGeometryText(text);
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

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
    const m = manifest({ geometry: ['body.json'] });
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
    const primary = { path: 'voxels.json', geometry: geom(GEOMC('a', '#FF0000')) };
    const refs = resolveProjectRefs(undefined, texts({}), primary);
    expect([...refs.geometries.keys()]).toEqual(['voxels.json']);
    expect(refs.geometries.get('voxels.json')).toBe(primary.geometry);
    expect(refs.projectErrors).toEqual([]);
  });

  it("prefers the primary's in-memory AST over its file text", () => {
    // The live-edited primary is authoritative: a stale file-map snapshot
    // must not win, or a mid-edit AST would be silently rolled back.
    const primary = { path: 'voxels.json', geometry: geom(GEOMC('live', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['voxels.json'] }),
      texts({ 'voxels.json': GEOMC('stale', '#000000') }),
      primary,
    );
    expect(refs.geometries.get('voxels.json')).toBe(primary.geometry);
    expect(refs.geometries.get('voxels.json')?.parts[0]?.name).toBe('live');
  });

  it('parses every non-primary geometry file, in list order', () => {
    const primary = { path: 'body.json', geometry: geom(GEOMC('body', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['body.json', 'limbs.json'] }),
      texts({ 'limbs.json': GEOMC('arm', '#00FF00') }),
      primary,
    );
    expect([...refs.geometries.keys()]).toEqual(['body.json', 'limbs.json']);
    expect(refs.geometries.get('limbs.json')?.parts[0]?.name).toBe('arm');
    expect(refs.projectErrors).toEqual([]);
  });

  it('normalizes reference paths before lookup', () => {
    const primary = { path: 'body.json', geometry: geom(GEOMC('body', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['body.json', './gear/../limbs.json'] }),
      texts({ 'limbs.json': GEOMC('arm', '#00FF00') }),
      primary,
    );
    expect(refs.geometries.has('limbs.json')).toBe(true);
    expect(refs.projectErrors).toEqual([]);
  });

  it('reports a missing geometry file without dropping the others', () => {
    const primary = { path: 'body.json', geometry: geom(GEOMC('body', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['body.json', 'gone.json', 'limbs.json'] }),
      texts({ 'limbs.json': GEOMC('arm', '#00FF00') }),
      primary,
    );
    expect([...refs.geometries.keys()]).toEqual(['body.json', 'limbs.json']);
    expect(refs.projectErrors).toHaveLength(1);
    expect(refs.projectErrors[0]?.file).toBe('gone.json');
    expect(refs.projectErrors[0]?.message).toMatch(/not found/);
  });

  it('reports an unparseable geometry file', () => {
    const primary = { path: 'body.json', geometry: geom(GEOMC('body', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['body.json', 'broken.json'] }),
      texts({ 'broken.json': '{ not json' }),
      primary,
    );
    expect(refs.geometries.has('broken.json')).toBe(false);
    expect(refs.projectErrors[0]?.file).toBe('broken.json');
  });

  it('flags a reference that escapes the package', () => {
    const primary = { path: 'body.json', geometry: geom(GEOMC('body', '#FF0000')) };
    const refs = resolveProjectRefs(
      manifest({ geometry: ['body.json', '../shared/limbs.json'] }),
      texts({}),
      primary,
    );
    expect(refs.projectErrors[0]?.message).toMatch(/outside the package/);
  });
});

describe('resolveProjectRefs — palette references', () => {
  // A geometry file that POINTS at a palette file (§7.4). Resolution fills
  // its `palette` in; the reference itself is kept.
  const pointer = () => ({
    path: 'voxels.json',
    geometry: geom(GEOM('a', 'palette.json')),
  });
  const inline = () => ({
    path: 'voxels.json',
    geometry: geom(GEOMC('a', '#FF0000')),
  });

  it('resolves a referenced palette into the geometry that points at it', () => {
    const refs = resolveProjectRefs(
      manifest(),
      texts({ 'palette.json': '{"colors":["#112233","#445566"]}' }),
      pointer(),
    );
    const g = refs.geometries.get('voxels.json');
    expect(g?.palette).toHaveLength(2);
    expect(g?.palette[0]).toMatchObject({ r: 0x11, g: 0x22, b: 0x33 });
    expect(g?.paletteRef).toBe('palette.json');
    expect(refs.projectErrors).toEqual([]);
  });

  it('resolves one shared palette into every file pointing at it', () => {
    const refs = resolveProjectRefs(
      manifest({ geometry: ['voxels.json', 'limbs.json'] }),
      texts({
        'limbs.json': GEOM('b', 'palette.json'),
        'palette.json': '{"colors":["#112233","#445566"]}',
      }),
      pointer(),
    );
    expect(refs.projectErrors).toEqual([]);
    for (const path of ['voxels.json', 'limbs.json']) {
      expect(refs.geometries.get(path)?.palette).toHaveLength(2);
      expect(refs.geometries.get(path)?.paletteRef).toBe('palette.json');
    }
  });

  it('reports a shared palette that is missing exactly once', () => {
    const refs = resolveProjectRefs(
      manifest({ geometry: ['voxels.json', 'limbs.json'] }),
      texts({ 'limbs.json': GEOM('b', 'palette.json') }),
      pointer(),
    );
    // Two files, one missing palette — one diagnostic, not two.
    expect(refs.projectErrors).toHaveLength(1);
    expect(refs.projectErrors[0]?.file).toBe('palette.json');
  });

  it('reports a missing palette file', () => {
    const refs = resolveProjectRefs(manifest(), texts({}), pointer());
    expect(refs.geometries.get('voxels.json')?.palette).toEqual([]);
    expect(refs.projectErrors[0]?.file).toBe('palette.json');
  });

  it('reports a palette file that is not valid JSON', () => {
    const refs = resolveProjectRefs(
      manifest(),
      texts({ 'palette.json': '{ oops' }),
      pointer(),
    );
    expect(refs.geometries.get('voxels.json')?.palette).toEqual([]);
    expect(refs.projectErrors[0]?.message).toMatch(/JSON parse/);
  });

  it('reports a palette file whose shape is wrong', () => {
    const refs = resolveProjectRefs(
      manifest(),
      texts({ 'palette.json': '{"colours":["#112233"]}' }),
      pointer(),
    );
    expect(refs.geometries.get('voxels.json')?.palette).toEqual([]);
    expect(refs.projectErrors).toHaveLength(1);
  });

  it('leaves an inline palette alone', () => {
    const refs = resolveProjectRefs(manifest(), texts({}), inline());
    const g = refs.geometries.get('voxels.json');
    expect(g?.paletteRef).toBeUndefined();
    expect(g?.palette).toHaveLength(1);
    expect(refs.projectErrors).toEqual([]);
  });
});

describe('resolveProjectRefs — §8 reference base', () => {
  // A reference resolves against the file that WROTE it. Everything the
  // manifest writes sits at the package root, so only a geometry file's
  // §7.4 palette can differ — and it used to be resolved against the root
  // too, which made a subdirectory unable to have its own palette and
  // unable to reach one that did.
  const body = JSON.stringify({
    version: '0.9',
    palette: 'palette.json',
    parts: [{ name: 'body', size: [1, 1, 1], voxels: [['0']] }],
  });
  const manifest = manifestOf(
    JSON.stringify({ name: 'n', geometry: ['gear/body.json'], parts: [{ name: 'body' }] }),
  );

  it('finds a palette beside the geometry file that names it', () => {
    const files: Record<string, string> = {
      'gear/body.json': body,
      'gear/palette.json': JSON.stringify({ colors: ['#FF0000'] }),
    };
    const refs = resolveProjectRefs(manifest, (p) => files[p], {
      path: 'gear/body.json',
      geometry: parseOk(body),
    });
    expect(refs.projectErrors).toEqual([]);
    expect(refs.geometries.get('gear/body.json')?.palette).toHaveLength(1);
  });

  it('does NOT fall back to a same-named palette at the package root', () => {
    const files: Record<string, string> = {
      'gear/body.json': body,
      'palette.json': JSON.stringify({ colors: ['#FF0000'] }),
    };
    const refs = resolveProjectRefs(manifest, (p) => files[p], {
      path: 'gear/body.json',
      geometry: parseOk(body),
    });
    expect(refs.projectErrors.map((e) => e.file)).toEqual(['gear/palette.json']);
  });
});

describe('resolveProjectRefs — external animations', () => {
  const primary = () => ({
    path: 'voxels.json',
    geometry: geom(GEOMC('a', '#FF0000')),
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
        { name: 'body.json', text: GEOMC('a', '#FF0000'), rel: 'robo/body.json' },
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
        { name: 'body.json', text: GEOMC('a', '#FF0000'), rel: '' },
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
        { name: 'body.json', text: GEOMC('a', '#FF0000'), rel: 'robo/body.json' },
        { name: 'thumb.png', text: 'not really a png', rel: 'robo/thumb.png' },
      ]),
    );
    expect(r.source?.files?.has('thumb.png')).toBe(false);
  });
});

// SPEC §13: the packed format. These pin the decisions the section makes,
// because until it existed the loader had made them silently — and one of
// them was losing data.
describe('loadFromCuboidyZip', () => {
  const MANIFEST_TEXT = JSON.stringify({
    name: 'packed',
    parts: [{ name: 'a' }],
  });
  const VOXELS = GEOM('a', ['#FF0000']);

  const zipFile = (entries: Record<string, string | Uint8Array>): File => {
    const zippable: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(entries)) {
      zippable[k] = typeof v === 'string' ? strToU8(v) : v;
    }
    return new File([zipSync(zippable) as unknown as BlobPart], 'packed.cuboidy');
  };

  it('reads an archive with cuboidy.json at the root', async () => {
    const r = await loadFromCuboidyZip(
      zipFile({ 'cuboidy.json': MANIFEST_TEXT, 'voxels.json': VOXELS }),
    );
    expect(r.error).toBeUndefined();
    expect(r.source?.manifest?.name).toBe('packed');
    expect([...r.source!.files.keys()].sort()).toEqual(['cuboidy.json', 'voxels.json']);
  });

  it('strips one wrapping directory — what compressing a folder produces', async () => {
    const r = await loadFromCuboidyZip(
      zipFile({ 'knight/cuboidy.json': MANIFEST_TEXT, 'knight/voxels.json': VOXELS }),
    );
    expect(r.error).toBeUndefined();
    expect([...r.source!.files.keys()].sort()).toEqual(['cuboidy.json', 'voxels.json']);
  });

  it('leaves two top-level entries alone rather than guessing', async () => {
    // Not a wrapped package — the manifest is already at the root, so
    // stripping `gear/` would invent a structure the archive never had.
    const r = await loadFromCuboidyZip(
      zipFile({
        'cuboidy.json': JSON.stringify({
          name: 'packed',
          geometry: ['gear/voxels.json'],
          parts: [{ name: 'a' }],
        }),
        'gear/voxels.json': VOXELS,
      }),
    );
    expect(r.error).toBeUndefined();
    expect([...r.source!.files.keys()].sort()).toEqual([
      'cuboidy.json',
      'gear/voxels.json',
    ]);
  });

  // §13.3. This is the bug the missing spec was hiding: open a package with
  // anything the editor does not parse, export it, and the file was gone.
  it('carries entries it does not understand through a round trip', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const r = await loadFromCuboidyZip(
      zipFile({
        'cuboidy.json': MANIFEST_TEXT,
        'voxels.json': VOXELS,
        'thumb.png': png,
        LICENSE: strToU8('MIT'),
      }),
    );
    expect(r.error).toBeUndefined();
    const assets = r.source!.assets;
    expect([...assets!.keys()].sort()).toEqual(['LICENSE', 'thumb.png']);
    expect(assets!.get('thumb.png')).toEqual(png);
    // …and they are not mistaken for model files.
    expect([...r.source!.files.keys()].sort()).toEqual(['cuboidy.json', 'voxels.json']);
  });

  // §13.2 — reject, do not sanitise.
  it.each([
    ['..%2Ftraversal', '../evil.json'],
    ['absolute', '/etc/passwd.json'],
    ['backslash', 'a\\b.json'],
  ])('rejects an unsafe entry path (%s)', async (_label, bad) => {
    const r = await loadFromCuboidyZip(
      zipFile({ 'cuboidy.json': MANIFEST_TEXT, 'voxels.json': VOXELS, [bad]: 'x' }),
    );
    expect(r.source).toBeUndefined();
    expect(r.error).toMatch(/unsafe entry path/);
  });

  it('rejects traversal even when EVERY entry shares the ../ prefix', async () => {
    // The gap the cases above could not reach: they each include a safe
    // sibling, so `commonTopDir` finds no shared prefix and the check sees
    // the traversal. When every name starts `../`, the prefix logic used
    // to strip it and the check then inspected an innocent-looking name —
    // sanitising the traversal away, which is what §13.2 forbids. The
    // names are now judged as the archive wrote them.
    const r = await loadFromCuboidyZip(
      zipFile({ '../cuboidy.json': MANIFEST_TEXT, '../voxels.json': VOXELS }),
    );
    expect(r.source).toBeUndefined();
    expect(r.error).toMatch(/unsafe entry path/);
  });

  it('rejects an archive with more entries than the bound allows', async () => {
    const many: Record<string, string> = {
      'cuboidy.json': MANIFEST_TEXT,
      'voxels.json': VOXELS,
    };
    for (let i = 0; i < 10_001; i++) many[`f${i}.txt`] = '';
    const r = await loadFromCuboidyZip(zipFile(many));
    expect(r.source).toBeUndefined();
    expect(r.error).toMatch(/more than 10000 entries/);
  });
});

describe('isSafeEntryPath', () => {
  it('accepts ordinary package-relative paths', () => {
    for (const p of ['cuboidy.json', 'anims/walk.json', 'a/b/c.json']) {
      expect(isSafeEntryPath(p), p).toBe(true);
    }
  });

  it('rejects traversal, absolute and Windows-shaped paths', () => {
    for (const p of ['', '/abs.json', '../up.json', 'a/../../up.json', 'a\\b.json', 'C:/x.json']) {
      expect(isSafeEntryPath(p), p).toBe(false);
    }
  });
});

// The round trip end to end: what Export writes must contain everything the
// archive brought in. Asserted on the entry map rather than through a browser
// download, which is why packageEntries is split out.
describe('packed round trip', () => {
  it('re-exports an unrecognised entry byte for byte', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7, 7]);
    const zippable: Record<string, Uint8Array> = {
      'cuboidy.json': strToU8(JSON.stringify({ name: 'packed', parts: [{ name: 'a' }] })),
      'voxels.json': strToU8(GEOM('a', ['#FF0000'])),
      'thumb.png': png,
    };
    const loaded = await loadFromCuboidyZip(
      new File([zipSync(zippable) as unknown as BlobPart], 'packed.cuboidy'),
    );
    expect(loaded.error).toBeUndefined();

    const out = packageEntries(loaded.source!);
    expect(Object.keys(out).sort()).toEqual([
      'cuboidy.json',
      'thumb.png',
      'voxels.json',
    ]);
    expect(new Uint8Array(out['thumb.png'] as Uint8Array)).toEqual(png);
  });
});
