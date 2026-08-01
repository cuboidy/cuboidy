import { describe, expect, it } from 'vitest';
import { parseGeometryText, parseManifest, type Manifest } from '@cuboidy/core';
import { resolveProjectRefs } from '../src/lib/load-model.js';
import { manifestText, mergeGeometries, renameFileInSource } from '../src/lib/source-ops.js';
import type { LoadedSource } from '../src/lib/types.js';

// SPEC §6.13 lets a part reach a shape under a different name, and lets two
// rig parts share one shape. The editor used to answer "what parts does
// this model have?" by unioning the geometry FILES, which is a second
// resolution that does not know about either — so a two-wheeled cart came
// out as the single part the file names, and everything keyed on that name
// (the tree, selection, edit routing) disagreed with the rig.

const MANIFEST = 'cuboidy.json';

function pkg(files: Record<string, string>, primary?: string): LoadedSource {
  const mR = parseManifest(JSON.parse(files[MANIFEST]!));
  if (!mR.ok) throw new Error(mR.message);
  const manifest: Manifest = mR.value;
  const refs = resolveProjectRefs(
    manifest,
    (p) => files[p],
    primary === undefined
      ? undefined
      : { path: primary, geometry: parseOk(files[primary]!) },
  );
  return {
    folderName: 'pkg',
    files: new Map(Object.entries(files)),
    manifestPath: MANIFEST,
    manifest,
    ...(primary !== undefined && { primaryPath: primary }),
    geometries: refs.geometries,
    parts: refs.parts,
  };
}

function parseOk(text: string) {
  const r = parseGeometryText(text);
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

const WHEELS = JSON.stringify({
  version: '0.9',
  palette: ['#FF0000'],
  parts: [
    { name: 'wheel', size: [1, 1, 1], voxels: [['0']] },
    { name: 'spare', size: [1, 1, 1], voxels: [['0']] },
  ],
});

const CART = JSON.stringify(
  {
    name: 'cart',
    parts: [
      { name: 'wheel-l', geometry: { path: 'w.json', part: 'wheel' } },
      { name: 'wheel-r', geometry: { path: 'w.json', part: 'wheel' } },
    ],
  },
  null,
  2,
);

describe('the display model under §6.13 references', () => {
  it('shows the RIG names, not the name the file happens to use', () => {
    const src = pkg({ [MANIFEST]: CART, 'w.json': WHEELS }, 'w.json');
    const { parts } = mergeGeometries(src);
    expect(parts.map((p) => p.name)).toEqual(['wheel-l', 'wheel-r', 'spare']);
  });

  it('routes each rig part to the file its shape actually lives in', () => {
    const src = pkg({ [MANIFEST]: CART, 'w.json': WHEELS }, 'w.json');
    const { files } = mergeGeometries(src);
    expect(files.get('wheel-l')).toBe('w.json');
    expect(files.get('wheel-r')).toBe('w.json');
  });

  it('still lists a geometry part no manifest part uses', () => {
    // `spare` is in the file and in no rig slot. It is not in the model
    // (§11.6 warns), but hiding it would make a part just added to a
    // geometry file invisible until its manifest entry existed.
    const src = pkg({ [MANIFEST]: CART, 'w.json': WHEELS }, 'w.json');
    expect(mergeGeometries(src).parts.map((p) => p.name)).toContain('spare');
  });
});

describe('renaming a file reached only by a part reference', () => {
  it('moves every parts[].geometry.path with it', () => {
    // The rename followed the top-level `geometry` list only, so a file
    // referenced per part kept the old name and the model broke on the
    // next load.
    const src = pkg({ [MANIFEST]: CART, 'w.json': WHEELS }, 'w.json');
    const next = renameFileInSource(src, 'w.json', 'wheel.json');
    expect(next).not.toBeNull();
    const m = JSON.parse(manifestText(next!)!) as Manifest;
    expect(m.parts.map((p) => p.geometry?.path)).toEqual([
      'wheel.json',
      'wheel.json',
    ]);
    expect([...next!.parts.keys()]).toEqual(['wheel-l', 'wheel-r']);
  });

  it('does NOT invent a geometry list the manifest never had', () => {
    // It used to write back `manifestGeometry()`, which supplies the
    // ["voxels.json"] default — so the rename added a list naming a file
    // that does not exist (§6.9: the default is not materialised).
    const src = pkg({ [MANIFEST]: CART, 'w.json': WHEELS }, 'w.json');
    const next = renameFileInSource(src, 'w.json', 'wheel.json');
    const m = JSON.parse(manifestText(next!)!) as Manifest;
    expect(m.geometry).toBeUndefined();
  });

  it('still rewrites a list the manifest DOES have', () => {
    const withList = JSON.stringify({
      name: 'cart',
      geometry: ['w.json'],
      parts: [{ name: 'wheel' }],
    });
    const src = pkg({ [MANIFEST]: withList, 'w.json': WHEELS }, 'w.json');
    const next = renameFileInSource(src, 'w.json', 'wheel.json');
    const m = JSON.parse(manifestText(next!)!) as Manifest;
    expect(m.geometry).toEqual(['wheel.json']);
  });
});
