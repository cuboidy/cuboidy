import { describe, expect, it } from 'vitest';
import { parseGeometryText, parseManifest, type Geometry, type Manifest } from '@cuboidy/core';
import { resolveProjectRefs } from '../src/lib/load-model.js';
import { applyFileEdit, deleteFileInSource, mapGeometryFiles, mergeGeometries, moveFolderInSource, remapPartPalette, renameFileInSource, repointPaletteRef, manifestText, primaryGeometry, uniquePartName, withManifest, withManifestText, writeFile } from '../src/lib/source-ops.js';
import type { LoadedSource } from '../src/lib/types.js';

// These are the operations that keep a package's REFERENCES intact while its
// files move around: renaming a file has to follow the manifest's geometry
// list, the palette a geometry points at, animation clip refs and their
// resolved records, all in one step — and a half-applied rewrite leaves a
// model that no longer loads. Nothing here touches React, so it can be
// pinned down directly.

const MANIFEST = 'cuboidy.json';

function geom(text: string): Geometry {
  const r = parseGeometryText(text);
  if (!r.ok) throw new Error(`fixture geometry: ${r.message}`);
  return r.value;
}

function manifestOf(text: string): Manifest {
  const r = parseManifest(JSON.parse(text));
  if (!r.ok) throw new Error(`fixture manifest: ${r.message}`);
  return r.value;
}

// A geometry document: `palette` is either colors or a §7.4 reference.
const GEO = (
  parts: Array<{ name: string; voxels: string }>,
  palette?: string[] | string,
): string =>
  JSON.stringify({
    version: '0.9',
    ...(palette !== undefined && { palette }),
    parts: parts.map((p) => ({
      name: p.name,
      size: [p.voxels.length, 1, 1],
      voxels: [[p.voxels]],
    })),
  });

const PALETTE = '{"colors":["#FF0000","#00FF00"]}';
const CLIP = '{"duration":1,"loop":true,"parts":{}}';

// Assembles the same shape the loader produces, so these tests exercise the
// real resolved state rather than a hand-rolled approximation.
function pkg(files: Record<string, string>, primary = 'voxels.json'): LoadedSource {
  const manifestText = files[MANIFEST];
  const manifest = manifestText !== undefined ? manifestOf(manifestText) : undefined;
  const primaryText = files[primary];
  if (primaryText === undefined) throw new Error(`fixture has no ${primary}`);
  const refs = resolveProjectRefs(manifest, (p) => files[p], {
    path: primary,
    geometry: geom(primaryText),
  });
  const geometries = new Map(refs.geometries);
  if (!geometries.has(primary)) geometries.set(primary, geom(primaryText));
  return {
    folderName: 'pkg',
    files: new Map(Object.entries(files)),
    primaryPath: primary,
    manifestPath: MANIFEST,
    ...(manifest !== undefined && { manifest }),
    geometries,
    parts: refs.parts,
    ...(refs.externalAnims !== undefined && { externalAnims: refs.externalAnims }),
    // The loader carries these; without them a test could not tell a
    // load-time problem from one that has been fixed.
    ...(refs.projectErrors.length > 0 && { projectErrors: refs.projectErrors }),
  };
}

const manifestJson = (m: object): string => JSON.stringify(m);

// ── the multi-file model ───────────────────────────────────────────────

describe('mergeGeometries', () => {
  it('unions parts across files in geometry-list order, recording each file', () => {
    const src = pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json', 'limbs.json'],
        parts: [{ name: 'body' }, { name: 'arm' }],
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], ['#FF0000']),
      'limbs.json': GEO([{ name: 'arm', voxels: '0' }], ['#00FF00']),
    }, 'body.json');
    const { parts, files } = mergeGeometries(src);
    expect(parts.map((p) => p.name)).toEqual(['body', 'arm']);
    expect(files.get('body')).toBe('body.json');
    expect(files.get('arm')).toBe('limbs.json');
  });

  it('keeps the FIRST definition when a name is defined twice', () => {
    // A cross-file duplicate is a lint error; the display model has to pick
    // one deterministically rather than render both.
    const src = pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['a.json', 'b.json'],
        parts: [{ name: 'dup' }],
      }),
      'a.json': GEO([{ name: 'dup', voxels: '00' }], ['#FF0000']),
      'b.json': GEO([{ name: 'dup', voxels: '0' }], ['#FF0000']),
    }, 'a.json');
    const { parts, files } = mergeGeometries(src);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.size.w).toBe(2); // a.json's
    expect(files.get('dup')).toBe('a.json');
  });

  it('reads the primary from the one AST store, like any other file', () => {
    const src = pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json'],
        parts: [{ name: 'body' }],
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], ['#FF0000']),
    }, 'body.json');
    // There is no second slot to disagree with it any more.
    expect(primaryGeometry(src)).toBe(src.geometries.get('body.json'));
    expect(mergeGeometries(src).parts.map((p) => p.name)).toEqual(['body']);
  });
});

describe('mapGeometryFiles', () => {
  const src = () =>
    pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json', 'limbs.json'],
        parts: [{ name: 'body' }, { name: 'arm' }],
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], ['#FF0000']),
      'limbs.json': GEO([{ name: 'arm', voxels: '0' }], ['#00FF00']),
    }, 'body.json');

  it('returns the SAME object when nothing changes', () => {
    const s = src();
    expect(mapGeometryFiles(s, () => null)).toBe(s);
  });

  it('keeps the AST, the file text and the live primary pair in sync', () => {
    const s = src();
    const next = mapGeometryFiles(s, (g, path) =>
      path === 'body.json' ? { ...g, parts: [] } : null,
    );
    expect(next.geometries.get('body.json')?.parts).toEqual([]);
    expect(primaryGeometry(next)?.parts).toEqual([]); // the live primary
    expect(next.files.get('body.json')).not.toContain('"body"');
    expect(next.files.get(next.primaryPath!)).toBe(next.files.get('body.json'));
    // Untouched files keep their identity.
    expect(next.geometries.get('limbs.json')).toBe(s.geometries.get('limbs.json'));
  });

  it('rewrites a NON-primary file without disturbing the primary', () => {
    const s = src();
    const next = mapGeometryFiles(s, (g, path) =>
      path === 'limbs.json' ? { ...g, parts: [] } : null,
    );
    expect(primaryGeometry(next)).toBe(primaryGeometry(s));
    expect(next.primaryPath).toBe(s.primaryPath);
    expect(next.files.get('limbs.json')).not.toContain('"arm"');
  });
});

// ── palette references (§7.4) ──────────────────────────────────────────

describe('repointPaletteRef', () => {
  const shared = () =>
    pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json', 'limbs.json'],
        parts: [{ name: 'body' }, { name: 'arm' }],
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], 'palette.json'),
      'limbs.json': GEO([{ name: 'arm', voxels: '1' }], 'palette.json'),
      'palette.json': PALETTE,
    }, 'body.json');

  it('re-points every file sharing the palette', () => {
    const next = repointPaletteRef(shared(), 'palette.json', 'skins/dark.json');
    for (const path of ['body.json', 'limbs.json']) {
      expect(next.geometries.get(path)?.paletteRef).toBe('skins/dark.json');
      expect(next.files.get(path)).toContain('skins/dark.json');
    }
  });

  it('dropping the reference writes the resolved colors back inline', () => {
    // Better than leaving a dangling reference, which cannot load at all.
    const next = repointPaletteRef(shared(), 'palette.json', null);
    const g = next.geometries.get('body.json');
    expect(g?.paletteRef).toBeUndefined();
    expect(g?.palette).toHaveLength(2);
    expect(next.files.get('body.json')).toContain('#FF0000');
  });

  it('leaves files pointing somewhere else alone', () => {
    const s = shared();
    expect(repointPaletteRef(s, 'other.json', 'x.json')).toBe(s);
  });
});

describe('remapPartPalette', () => {
  const RED = { r: 255, g: 0, b: 0, a: 255 };
  const GREEN = { r: 0, g: 255, b: 0, a: 255 };
  const BLUE = { r: 0, g: 0, b: 255, a: 255 };

  const part = (voxels: number[]) => ({
    name: 'p',
    size: { w: voxels.length, h: 1, d: 1 },
    pivot: { pos: { x: 0, y: 0, z: 0 } },
    sockets: [],
    voxels: [[voxels]],
  });

  it('appends colors the target lacks and rewrites the indices', () => {
    const r = remapPartPalette(part([0, 1]), [RED, GREEN], [BLUE]);
    expect(r.palette).toEqual([BLUE, RED, GREEN]);
    expect(r.part.voxels[0]?.[0]).toEqual([1, 2]);
  });

  it('reuses an exact rgba match rather than duplicating it', () => {
    const r = remapPartPalette(part([0]), [RED], [GREEN, RED]);
    expect(r.palette).toEqual([GREEN, RED]);
    expect(r.part.voxels[0]?.[0]).toEqual([1]);
  });

  it('is identity when the palettes already agree', () => {
    const p = part([0, 1]);
    const to = [RED, GREEN];
    const r = remapPartPalette(p, [RED, GREEN], to);
    expect(r.part).toBe(p);
    expect(r.palette).toBe(to);
  });
});

// ── file rename / move / delete ────────────────────────────────────────

describe('renameFileInSource', () => {
  const full = () =>
    pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json', 'limbs.json'],
        parts: [{ name: 'body' }, { name: 'arm' }],
        animations: { wave: 'anims/wave.json' },
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], 'palette.json'),
      'limbs.json': GEO([{ name: 'arm', voxels: '1' }], 'palette.json'),
      'palette.json': PALETTE,
      'anims/wave.json': CLIP,
      'README.md': '# notes\n',
    }, 'body.json');

  it('follows a geometry rename into the manifest list', () => {
    const next = renameFileInSource(full(), 'limbs.json', 'arms.json');
    expect(next).not.toBeNull();
    expect(next!.manifest?.geometry).toEqual(['body.json', 'arms.json']);
    expect(manifestText(next!)).toContain('arms.json');
    expect(next!.geometries.has('arms.json')).toBe(true);
    expect(next!.geometries.has('limbs.json')).toBe(false);
    expect(next!.removedFiles?.has('limbs.json')).toBe(true);
  });

  it('follows a palette rename into every geometry pointing at it', () => {
    const next = renameFileInSource(full(), 'palette.json', 'skin.json');
    expect(next).not.toBeNull();
    for (const path of ['body.json', 'limbs.json']) {
      expect(next!.geometries.get(path)?.paletteRef).toBe('skin.json');
      expect(next!.files.get(path)).toContain('skin.json');
    }
    // The manifest never mentioned the palette, so it is untouched.
    expect(next!.manifest?.geometry).toEqual(['body.json', 'limbs.json']);
  });

  it('follows an animation rename into the manifest AND the resolved record', () => {
    const next = renameFileInSource(full(), 'anims/wave.json', 'anims/hi.json');
    expect(next).not.toBeNull();
    expect(next!.manifest?.animations?.['wave']).toBe('anims/hi.json');
    // A stale record would write timeline edits back to the OLD path.
    expect(next!.externalAnims?.get('wave')?.path).toBe('anims/hi.json');
  });

  it('renames the primary geometry, following it into the manifest', () => {
    const next = renameFileInSource(full(), 'body.json', 'torso.json');
    expect(next).not.toBeNull();
    expect(next!.primaryPath).toBe('torso.json');
    expect(next!.manifest?.geometry).toEqual(['torso.json', 'limbs.json']);
  });

  it('refuses to rename the manifest anchor', () => {
    expect(renameFileInSource(full(), MANIFEST, 'model.json')).toBeNull();
  });

  it('refuses a rename that would collide', () => {
    expect(renameFileInSource(full(), 'limbs.json', 'body.json')).toBeNull();
    expect(renameFileInSource(full(), 'README.md', MANIFEST)).toBeNull();
  });

  it('refuses to strip the .json extension off a referenced file', () => {
    // §8 requires the extension; without it the reference stops resolving.
    expect(renameFileInSource(full(), 'limbs.json', 'limbs.txt')).toBeNull();
    expect(renameFileInSource(full(), 'palette.json', 'palette.txt')).toBeNull();
    expect(renameFileInSource(full(), 'anims/wave.json', 'anims/wave.txt')).toBeNull();
  });

  it('allows renaming an unreferenced file freely', () => {
    const next = renameFileInSource(full(), 'README.md', 'docs/NOTES.txt');
    expect(next).not.toBeNull();
    expect(next!.files.has('docs/NOTES.txt')).toBe(true);
  });

  it('refuses to rename a geometry file with no manifest to record it', () => {
    // Without a manifest entry the loader could not find the file again.
    const bare = pkg({ 'voxels.json': GEO([{ name: 'p', voxels: '0' }], ['#FF0000']) });
    expect(renameFileInSource(bare, 'voxels.json', 'shape.json')).toBeNull();
  });

  it('un-marks a path that is renamed back', () => {
    const once = renameFileInSource(full(), 'README.md', 'NOTES.md')!;
    const back = renameFileInSource(once, 'NOTES.md', 'README.md')!;
    expect(back.removedFiles?.has('README.md')).toBe(false);
    expect(back.removedFiles?.has('NOTES.md')).toBe(true);
  });
});

describe('moveFolderInSource', () => {
  const withFolder = () =>
    pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['voxels.json', 'gear/hat.json'],
        parts: [{ name: 'p' }, { name: 'hat' }],
      }),
      'voxels.json': GEO([{ name: 'p', voxels: '0' }], ['#FF0000']),
      'gear/hat.json': GEO([{ name: 'hat', voxels: '0' }], ['#FF0000']),
      'gear/notes.md': 'x\n',
    });

  it('moves every file under the folder and follows the references', () => {
    const next = moveFolderInSource(withFolder(), 'gear', 'parts/gear');
    expect(next).not.toBeNull();
    expect(next!.files.has('parts/gear/hat.json')).toBe(true);
    expect(next!.files.has('parts/gear/notes.md')).toBe(true);
    expect(next!.manifest?.geometry).toEqual(['voxels.json', 'parts/gear/hat.json']);
  });

  it('refuses to move a folder into itself', () => {
    expect(moveFolderInSource(withFolder(), 'gear', 'gear/inner')).toBeNull();
  });

  it('returns null for a folder that holds no files', () => {
    expect(moveFolderInSource(withFolder(), 'empty', 'other')).toBeNull();
  });

  it('aborts the WHOLE move when any single file rejects', () => {
    // gear/hat.json would land on a name that is already taken, so nothing
    // may move — a half-applied folder move is unrecoverable by undo shape.
    const src = pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['voxels.json', 'gear/hat.json'],
        parts: [{ name: 'p' }, { name: 'hat' }],
      }),
      'voxels.json': GEO([{ name: 'p', voxels: '0' }], ['#FF0000']),
      'gear/hat.json': GEO([{ name: 'hat', voxels: '0' }], ['#FF0000']),
      'worn/hat.json': GEO([{ name: 'spare', voxels: '0' }], ['#FF0000']),
    });
    expect(moveFolderInSource(src, 'gear', 'worn')).toBeNull();
  });
});

describe('deleteFileInSource', () => {
  const full = () =>
    pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json', 'limbs.json'],
        parts: [{ name: 'body' }, { name: 'arm' }],
        animations: { wave: 'anims/wave.json', greet: 'anims/wave.json' },
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], 'palette.json'),
      'limbs.json': GEO([{ name: 'arm', voxels: '1' }], 'palette.json'),
      'palette.json': PALETTE,
      'anims/wave.json': CLIP,
    }, 'body.json');

  it('drops a geometry file from the manifest list and the AST map', () => {
    const next = deleteFileInSource(full(), 'limbs.json');
    expect(next).not.toBeNull();
    expect(next!.manifest?.geometry).toEqual(['body.json']);
    expect(next!.geometries.has('limbs.json')).toBe(false);
    expect(next!.removedFiles?.has('limbs.json')).toBe(true);
  });

  it('deleting a palette file inlines the colors into its referrers', () => {
    const next = deleteFileInSource(full(), 'palette.json');
    expect(next).not.toBeNull();
    for (const path of ['body.json', 'limbs.json']) {
      const g = next!.geometries.get(path);
      expect(g?.paletteRef).toBeUndefined();
      expect(g?.palette).toHaveLength(2);
      expect(next!.files.get(path)).toContain('#FF0000');
    }
  });

  it('deleting an animation file removes EVERY clip that referenced it', () => {
    const next = deleteFileInSource(full(), 'anims/wave.json');
    expect(next).not.toBeNull();
    // Both clips pointed at the one file, so `animations` empties out and
    // the key is dropped rather than left as {}.
    expect(next!.manifest?.animations).toBeUndefined();
    expect(next!.externalAnims).toBeUndefined();
  });

  it('refuses to delete the manifest anchor or the primary geometry', () => {
    expect(deleteFileInSource(full(), MANIFEST)).toBeNull();
    expect(deleteFileInSource(full(), 'body.json')).toBeNull();
  });

  it('returns null for a path that is not in the package', () => {
    expect(deleteFileInSource(full(), 'nope.json')).toBeNull();
  });
});

describe('uniquePartName', () => {
  it('returns the base when it is free', () => {
    expect(uniquePartName(new Set(), 'head')).toBe('head');
  });

  it('suffixes from -2 upward, skipping taken names', () => {
    expect(uniquePartName(new Set(['head']), 'head')).toBe('head-2');
    expect(uniquePartName(new Set(['head', 'head-2']), 'head')).toBe('head-3');
  });
});

describe('withManifest / withManifestText / writeFile', () => {
  const src = () =>
    pkg({
      [MANIFEST]: manifestJson({ name: 'm', parts: [{ name: 'p' }] }),
      'voxels.json': GEO([{ name: 'p', voxels: '0' }], ['#FF0000']),
    });

  it('writes the AST and its canonical text together', () => {
    const next = withManifest(src(), manifestOf(
      manifestJson({ name: 'renamed', parts: [{ name: 'p' }] }),
    ));
    expect(next.manifest?.name).toBe('renamed');
    expect(manifestText(next)).toBe(
      JSON.stringify({ name: 'renamed', parts: [{ name: 'p' }] }, null, 2) + '\n',
    );
    // The AST and the bytes agree — that is the whole point of the helper.
    expect(JSON.parse(manifestText(next)!)).toEqual(next.manifest);
  });

  it('replaces the manifest wholesale, AST and bytes together', () => {
    const s = pkg({
      [MANIFEST]: manifestJson({ name: 'old', parts: [{ name: 'p' }] }),
      'voxels.json': GEO([{ name: 'p', voxels: '0' }], ['#FF0000']),
    });
    const next = withManifest(s, manifestOf(
      manifestJson({ name: 'fresh', parts: [{ name: 'p' }] }),
    ));
    expect(next.manifestPath).toBe(MANIFEST);
    expect(next.manifest?.name).toBe('fresh');
    expect(JSON.parse(manifestText(next)!)).toEqual(next.manifest);
  });

  it('withManifestText records bytes WITHOUT touching the AST', () => {
    // The typing path: the text is authoritative while it is mid-edit, and
    // the debounced re-parse lands the AST separately once it parses.
    const s = src();
    const next = withManifestText(s, '{ broken');
    expect(manifestText(next)).toBe('{ broken');
    expect(next.manifest).toBe(s.manifest);
  });

  it('writeFile replaces one path and leaves the rest identical', () => {
    const s = src();
    const next = writeFile(s, 'notes.md', 'hello\n');
    expect(next.files.get('notes.md')).toBe('hello\n');
    expect(next.files.get('voxels.json')).toBe(s.files.get('voxels.json'));
  });
});

// The single sync point: writing a file's text re-derives everything that
// file feeds. Nothing else may write `files`, so these are the guarantees
// every edit path inherits for free.
describe('writeFile — text and derived state move together', () => {
  const shared = () =>
    pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json', 'limbs.json'],
        parts: [{ name: 'body' }, { name: 'arm' }],
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], 'palette.json'),
      'limbs.json': GEO([{ name: 'arm', voxels: '1' }], 'palette.json'),
      'palette.json': PALETTE,
    }, 'body.json');

  it('writing a geometry file updates its AST', () => {
    const next = writeFile(
      shared(),
      'limbs.json',
      GEO([{ name: 'renamed', voxels: '1' }], 'palette.json'),
    );
    expect(next.geometries.get('limbs.json')?.parts[0]?.name).toBe('renamed');
  });

  it('writing a shared palette re-resolves it into EVERY referrer', () => {
    const next = writeFile(
      shared(),
      'palette.json',
      '{"colors":["#111111","#222222","#333333"]}',
    );
    for (const path of ['body.json', 'limbs.json']) {
      expect(next.geometries.get(path)?.palette).toHaveLength(3);
      expect(next.geometries.get(path)?.palette[0]).toMatchObject({ r: 0x11 });
    }
  });

  it('writing the manifest re-resolves the references it owns', () => {
    const s = shared();
    // Drop limbs.json from the geometry list: its parts leave the model.
    const dropped = writeFile(
      s,
      MANIFEST,
      manifestJson({
        name: 'm',
        geometry: ['body.json'],
        parts: [{ name: 'body' }],
      }),
    );
    expect(dropped.geometries.has('limbs.json')).toBe(false);
    // …and putting it back brings them straight back.
    const restored = writeFile(dropped, MANIFEST, s.files.get(MANIFEST)!);
    expect(restored.geometries.get('limbs.json')?.parts[0]?.name).toBe('arm');
  });

  it('writing the manifest resolves a NEW animation reference', () => {
    const s = writeFile(shared(), 'anims/wave.json', CLIP);
    // The file alone is inert; the manifest reference is what loads it.
    expect(s.externalAnims).toBeUndefined();
    const next = writeFile(
      s,
      MANIFEST,
      manifestJson({
        name: 'm',
        geometry: ['body.json', 'limbs.json'],
        parts: [{ name: 'body' }, { name: 'arm' }],
        animations: { wave: 'anims/wave.json' },
      }),
    );
    expect(next.externalAnims?.get('wave')?.path).toBe('anims/wave.json');
  });

  it('text that does not parse keeps the last good AST', () => {
    // This is what the debounce used to buy: the 3D view does not flicker
    // through the invalid states every keystroke passes through.
    const s = shared();
    const next = writeFile(s, 'limbs.json', '{ broken');
    expect(next.files.get('limbs.json')).toBe('{ broken');
    expect(next.geometries.get('limbs.json')).toBe(s.geometries.get('limbs.json'));
  });

  // A referenced file has a SCHEMA, and breaking it used to be swallowed:
  // the last good AST stayed, no error was reported, the banner never
  // appeared, structural edits stayed unblocked and the broken bytes were
  // what got saved. Silence was the bug, not the stale AST.
  describe('a referenced file that is valid JSON but invalid content', () => {
    const referencing = () =>
      pkg(
        {
          [MANIFEST]: manifestJson({
            name: 'm',
            geometry: ['v.json'],
            parts: [{ name: 'p' }],
            animations: { walk: 'anims/walk.json' },
          }),
          'v.json': GEO([{ name: 'p', voxels: '0' }], 'palette.json'),
          'palette.json': '{"colors":["#FF0000"]}',
          'anims/walk.json': '{"duration":1,"loop":true,"parts":{}}',
        },
        'v.json',
      );

    it('reports a schema-invalid palette instead of ignoring it', () => {
      const r = applyFileEdit(referencing(), 'palette.json', '{}');
      expect(r.error).toMatch(/colors/);
    });

    it('reports a schema-invalid animation, naming the clip', () => {
      const r = applyFileEdit(
        referencing(),
        'anims/walk.json',
        '{"duration":-1,"loop":true,"parts":{}}',
      );
      expect(r.error).toMatch(/animation 'walk'/);
    });

    it('a VALID palette edit reaches every geometry pointing at it', () => {
      const r = applyFileEdit(
        referencing(),
        'palette.json',
        '{"colors":["#00FF00","#0000FF"]}',
      );
      expect(r.error).toBeNull();
      expect(r.source.geometries.get('v.json')?.palette).toHaveLength(2);
    });

    it('a VALID animation edit reaches the clip record', () => {
      const r = applyFileEdit(
        referencing(),
        'anims/walk.json',
        '{"duration":2,"loop":false,"parts":{}}',
      );
      expect(r.error).toBeNull();
      expect(r.source.externalAnims?.get('walk')?.anim.duration).toBe(2);
    });

    it('fixing a file clears the projectError it caused at load', () => {
      // The other half: load-time problems were computed once and never
      // recomputed, so the Console kept reporting a file the author had
      // already repaired.
      const missing = pkg(
        {
          [MANIFEST]: manifestJson({
            name: 'm',
            geometry: ['v.json'],
            parts: [{ name: 'p' }],
          }),
          'v.json': GEO([{ name: 'p', voxels: '0' }], 'palette.json'),
        },
        'v.json',
      );
      expect(missing.projectErrors?.[0]?.file).toBe('palette.json');
      const fixed = writeFile(missing, 'palette.json', '{"colors":["#FF0000"]}');
      expect(fixed.projectErrors ?? []).toEqual([]);
      expect(fixed.geometries.get('v.json')?.palette).toHaveLength(1);
    });
  });

  it('applyFileEdit refuses a path the package no longer has', () => {
    // A stale handler must not resurrect a deleted file; creating one goes
    // through writeFile, which has no such guard.
    const s = shared();
    expect(applyFileEdit(s, 'gone.json', 'x').source).toBe(s);
    expect(writeFile(s, 'new.md', 'x\n').files.get('new.md')).toBe('x\n');
  });
});
