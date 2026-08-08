import { describe, expect, it } from 'vitest';
import { MATTE, parseGeometryText, parseManifest, type Geometry, type Manifest } from '@cuboidy/core';
import { resolveProjectRefs } from '../src/lib/load-model.js';
import { applyFileEdit, clipFilesIn, deleteFileInSource, freePalettePath, geometryFilesIn, mapGeometryFiles, mergeGeometries, moveFolderInSource, paletteFilesIn, relativeRefFrom, renameFileInSource, repointPaletteRef, resolvedModelPalette, manifestText, primaryGeometry, uniquePartName, withManifest, withManifestText, writeFile, writeModelPalette } from '../src/lib/source-ops.js';
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
  const refs = resolveProjectRefs(manifest, new Map(Object.entries(files)), {
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

// remapPartPalette moved to @cuboidy/core (geometry/transform.ts), which
// owns its tests — the editor had a byte-identical copy of both.

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

  it('deleting a geometry file deletes the parts it defined', () => {
    // The file's deletion takes its parts with it — an `arm` entry left in
    // the manifest would reference a definition that no longer exists.
    const next = deleteFileInSource(full(), 'limbs.json');
    expect(next!.manifest?.parts.map((p) => p.name)).toEqual(['body']);
    expect(next!.parts.has('arm')).toBe(false);
  });

  it('deleting a §6.13 by-path file deletes the parts bound to it, under their rig names', () => {
    // `left-arm` reaches `arm` in limbs.json via geometry.path — a rig name
    // the file itself never mentions. Before the sweep this left a dangling
    // path, which was a load error on the next open.
    const src = pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json'],
        parts: [
          { name: 'body' },
          { name: 'left-arm', parent: 'body', geometry: { path: 'limbs.json', part: 'arm' } },
        ],
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], ['#FF0000']),
      'limbs.json': GEO([{ name: 'arm', voxels: '0' }], ['#00FF00']),
    }, 'body.json');
    const next = deleteFileInSource(src, 'limbs.json');
    expect(next).not.toBeNull();
    expect(next!.manifest?.parts.map((p) => p.name)).toEqual(['body']);
    expect(next!.files.get(MANIFEST)).not.toContain('limbs.json');
  });

  it('a deleted part takes its sockets and tracks along, and its children re-parent', () => {
    const src = pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json', 'limbs.json'],
        parts: [
          { name: 'body' },
          { name: 'arm', parent: 'body' },
          { name: 'hand', parent: 'arm' },
        ],
        sockets: {
          grip: { part: 'arm', socket: 'palm' },
          top: { part: 'body', socket: 'crown' },
        },
        animations: {
          wave: {
            duration: 1,
            loop: true,
            parts: { arm: { '0.0': { rot: [0, 0, 0] } }, body: { '0.0': { rot: [0, 0, 0] } } },
          },
          ext: 'anims/wave.json',
        },
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }, { name: 'hand', voxels: '0' }], ['#FF0000']),
      'limbs.json': GEO([{ name: 'arm', voxels: '0' }], ['#00FF00']),
      'anims/wave.json':
        '{"duration":1,"loop":true,"parts":{"arm":{"0.0":{"rot":[0,0,0]}},"body":{"0.0":{"rot":[0,0,0]}}}}',
    }, 'body.json');
    const next = deleteFileInSource(src, 'limbs.json');
    expect(next).not.toBeNull();
    const m = next!.manifest!;
    expect(m.parts.map((p) => p.name)).toEqual(['body', 'hand']);
    // hand's parent (arm) is gone, so it re-parents to arm's own parent.
    expect(m.parts.find((p) => p.name === 'hand')?.parent).toBe('body');
    expect(Object.keys(m.sockets ?? {})).toEqual(['top']);
    const wave = m.animations?.['wave'];
    expect(typeof wave).toBe('object');
    expect(Object.keys((wave as { parts: object }).parts)).toEqual(['body']);
    // The external clip's resolved record AND its file text both lose the track.
    expect(Object.keys(next!.externalAnims!.get('ext')!.anim.parts)).toEqual(['body']);
    expect(next!.files.get('anims/wave.json')).not.toContain('"arm"');
  });

  it('re-parenting walks past a whole deleted chain', () => {
    // arm and hand both live in limbs.json; finger (elsewhere) hangs off
    // hand. Deleting the file removes both ancestors, so finger climbs to
    // the nearest survivor: body.
    const src = pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json', 'limbs.json'],
        parts: [
          { name: 'body' },
          { name: 'arm', parent: 'body' },
          { name: 'hand', parent: 'arm' },
          { name: 'finger', parent: 'hand' },
        ],
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }, { name: 'finger', voxels: '0' }], ['#FF0000']),
      'limbs.json': GEO([{ name: 'arm', voxels: '0' }, { name: 'hand', voxels: '0' }], ['#00FF00']),
    }, 'body.json');
    const next = deleteFileInSource(src, 'limbs.json');
    expect(next!.manifest?.parts.map((p) => p.name)).toEqual(['body', 'finger']);
    expect(next!.manifest?.parts.find((p) => p.name === 'finger')?.parent).toBe('body');
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

  it('refuses to delete only the manifest anchor (§3, the one fixed file)', () => {
    expect(deleteFileInSource(full(), MANIFEST)).toBeNull();
  });

  it('deleting the panel-default ("primary") geometry file promotes the next one', () => {
    // The SPEC has no primary geometry — the first file is merely the
    // geometry panel's default document, so deleting it works like any
    // other geometry-file delete and the default moves along.
    const next = deleteFileInSource(full(), 'body.json');
    expect(next).not.toBeNull();
    expect(next!.primaryPath).toBe('limbs.json');
    expect(next!.manifest?.geometry).toEqual(['limbs.json']);
    expect(next!.manifest?.parts.map((p) => p.name)).toEqual(['arm']);
  });

  it('deleting the last geometry file leaves a working all-inline model', () => {
    const src = pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json'],
        parts: [
          { name: 'body' },
          { name: 'orb', geometry: { size: [1, 1, 1], voxels: [['.']] } },
        ],
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], ['#FF0000']),
    }, 'body.json');
    const next = deleteFileInSource(src, 'body.json');
    expect(next).not.toBeNull();
    // No geometry file left: no primary, and the list is DROPPED rather
    // than written as the schema-invalid [].
    expect(next!.primaryPath).toBeUndefined();
    expect(next!.manifest?.geometry).toBeUndefined();
    expect(next!.manifest?.parts.map((p) => p.name)).toEqual(['orb']);
    expect(next!.parts.has('orb')).toBe(true);
  });

  it('returns null for a path that is not in the package', () => {
    expect(deleteFileInSource(full(), 'nope.json')).toBeNull();
  });
});

describe('paletteFilesIn', () => {
  // Every file in a v0.9 package is `.json`, so the NAME settles nothing:
  // these tests pin that the content decides, the way the CLI's W07 scan
  // already does for geometry.
  it('finds palette files by content, whatever they are called or where', () => {
    const src = pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json'],
        parts: [{ name: 'body' }],
        animations: { wave: 'anims/wave.json' },
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], ['#FF0000']),
      // Named nothing like a palette, in a subfolder, and unreferenced.
      'gear/autumn.json': PALETTE,
      'palette.json': PALETTE,
      'anims/wave.json': CLIP,
    }, 'body.json');
    expect(paletteFilesIn(src)).toEqual(['gear/autumn.json', 'palette.json']);
  });

  it('never mistakes the manifest, a geometry file or a clip for a palette', () => {
    const src = pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json'],
        parts: [{ name: 'body' }],
        animations: { wave: 'anims/wave.json' },
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], ['#FF0000']),
      'anims/wave.json': CLIP,
      'notes.txt': 'not json at all',
      'broken.json': '{ this is not json',
    }, 'body.json');
    expect(paletteFilesIn(src)).toEqual([]);
  });
});

describe('clipFilesIn / geometryFilesIn', () => {
  const mixed = () =>
    pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['body.json'],
        parts: [{ name: 'body' }],
      }),
      'body.json': GEO([{ name: 'body', voxels: '0' }], ['#FF0000']),
      'spare.json': GEO([{ name: 'spare', voxels: '0' }], ['#00FF00']),
      'anims/wave.json': CLIP,
      'palette.json': PALETTE,
    }, 'body.json');

  it('tells the three kinds apart by content, with no overlap', () => {
    const src = mixed();
    expect(clipFilesIn(src)).toEqual(['anims/wave.json']);
    expect(geometryFilesIn(src)).toEqual(['body.json', 'spare.json']);
    expect(paletteFilesIn(src)).toEqual(['palette.json']);
  });

  it('never offers the manifest as any kind', () => {
    // The anchor's own text parses as none of them anyway; excluding it
    // explicitly means a future schema change cannot make the package's
    // one fixed file (§3) a candidate for adoption.
    const all = [
      ...clipFilesIn(mixed()),
      ...geometryFilesIn(mixed()),
      ...paletteFilesIn(mixed()),
    ];
    expect(all).not.toContain(MANIFEST);
  });
});

describe('writeModelPalette — the manifest palette, wherever it lives', () => {
  // §6.1 lets cuboidy.json's `palette` be colors OR a reference, exactly
  // as a geometry file's does (§7.4). The write has to follow the form
  // in use; it used to always spell the colors out, so editing a single
  // swatch of a REFERENCED model palette silently dropped the reference.
  // A geometry file rides along because the fixture helper needs one;
  // the model palette under test is the manifest's, which the INLINE
  // part draws on (§6.13).
  const modelWith = (palette: unknown, extra: Record<string, string> = {}) =>
    pkg({
      [MANIFEST]: manifestJson({
        name: 'm',
        geometry: ['v.json'],
        palette,
        parts: [
          { name: 'p' },
          { name: 'orb', geometry: { size: [1, 1, 1], voxels: [['0']] } },
        ],
      }),
      'v.json': GEO([{ name: 'p', voxels: '0' }], ['#FF0000']),
      ...extra,
    }, 'v.json');

  const inlineModel = () => modelWith(['#FF0000']);
  const referencedModel = () =>
    modelWith('palette.json', { 'palette.json': PALETTE });

  const GREEN = [{ color: { r: 0, g: 255, b: 0, a: 255 }, material: MATTE }];

  it('spells the colors out when the manifest declares them inline', () => {
    const next = writeModelPalette(inlineModel(), GREEN);
    expect(next).not.toBeNull();
    expect(next!.manifest?.palette).toEqual(['#00FF00']);
  });

  it('writes the palette FILE when the manifest references one', () => {
    const next = writeModelPalette(referencedModel(), GREEN);
    expect(next).not.toBeNull();
    // The reference survives; the colors land in the file it names.
    expect(next!.manifest?.palette).toBe('palette.json');
    expect(next!.files.get('palette.json')).toContain('#00FF00');
  });

  // SPEC §7.4 material has to survive a write. Both writers used
  // `serializeColor`, which emits four channels and nothing else, so every
  // save reset the palette to matte — and because the panel re-reads what
  // it just wrote, it looked like the material SLIDER was broken.
  const POLISHED = [
    {
      color: { r: 0xc0, g: 0xc4, b: 0xcc, a: 255 },
      material: { ...MATTE, metallic: 1, roughness: 0.08 },
    },
  ];

  it('keeps the material when the manifest declares colors inline', () => {
    const next = writeModelPalette(inlineModel(), POLISHED);
    expect(next!.manifest?.palette).toEqual([
      { color: '#C0C4CC', metallic: 1, roughness: 0.08 },
    ]);
  });

  it('keeps the material when it writes a palette file', () => {
    const next = writeModelPalette(referencedModel(), POLISHED);
    const text = next!.files.get('palette.json') ?? '';
    expect(text).toContain('"metallic": 1');
    expect(text).toContain('"roughness": 0.08');
    // And it round-trips back to the same entry.
    expect(resolvedModelPalette(next!)).toEqual(POLISHED);
  });

  it('still writes a matte entry as a bare color', () => {
    const next = writeModelPalette(inlineModel(), GREEN);
    expect(next!.manifest?.palette).toEqual(['#00FF00']);
  });

  it('drops the field entirely when the inline palette empties (§6.1)', () => {
    const next = writeModelPalette(inlineModel(), []);
    expect(next!.manifest?.palette).toBeUndefined();
    expect(next!.files.get(MANIFEST)).not.toContain('"palette"');
  });

  it('resolves a referenced model palette back to its colors', () => {
    expect(resolvedModelPalette(referencedModel())).toHaveLength(2);
    // A reference that does not load has nothing to resolve — callers
    // use the empty result to refuse a move that would lose the colors.
    expect(resolvedModelPalette(modelWith('gone.json'))).toEqual([]);
  });
});

describe('freePalettePath', () => {
  it('suffixes past the names already taken', () => {
    const src = pkg({
      [MANIFEST]: manifestJson({ name: 'm', geometry: ['v.json'], parts: [{ name: 'p' }] }),
      'v.json': GEO([{ name: 'p', voxels: '0' }], ['#FF0000']),
    }, 'v.json');
    expect(freePalettePath(src)).toBe('palette.json');
    const taken = {
      ...src,
      files: new Map([...src.files, ['palette.json', PALETTE]]),
    };
    expect(freePalettePath(taken)).toBe('palette-2.json');
  });
});

describe('relativeRefFrom', () => {
  // SPEC §8: a reference is resolved against the file that WROTE it, so
  // binding a palette has to express the target from the referrer's seat.
  it('writes a package-relative target as a ref relative to the referrer', () => {
    expect(relativeRefFrom('body.json', 'palette.json')).toBe('palette.json');
    expect(relativeRefFrom('gear/body.json', 'palette.json')).toBe('../palette.json');
    expect(relativeRefFrom('body.json', 'gear/palette.json')).toBe('gear/palette.json');
    expect(relativeRefFrom('gear/body.json', 'gear/palette.json')).toBe('palette.json');
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
      expect(next.geometries.get(path)?.palette[0]?.color).toMatchObject({ r: 0x11 });
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

    it('a geometry text edit rebuilds the resolved parts (the render source)', () => {
      // The 3D view draws src.parts (§6.13). This branch used to update
      // only the AST map, leaving the render on the stale shape until
      // some structural edit rebuilt parts as a side effect.
      const r = applyFileEdit(
        referencing(),
        'v.json',
        GEO([{ name: 'p', voxels: '00' }], 'palette.json'),
      );
      expect(r.error).toBeNull();
      expect(r.source.parts.get('p')?.part.size.w).toBe(2);
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
