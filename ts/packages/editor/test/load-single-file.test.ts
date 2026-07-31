import { describe, expect, it } from 'vitest';
import { loadSingleFile } from '../src/lib/load-model.js';

// SPEC §3 + §6.13: the editor's single-file entry. It used to read a loose
// file as raw GEOMETRY, producing a second-class document with no manifest,
// no rig view, no animation view and a "Create manifest" promotion step.
// The spec never allowed that shape, and inline geometry replaces the case
// it served — so a loose file is now read as the MANIFEST.

const file = (name: string, text: string): File =>
  new File([text], name, { type: 'application/json' });

const INLINE_MODEL = JSON.stringify({
  name: 'tiny',
  palette: ['#FF0000'],
  parts: [
    { name: 'body', geometry: { size: [1, 1, 1], voxels: [['0']] } },
  ],
});

describe('loadSingleFile', () => {
  it('reads a loose .json as the manifest, giving a complete model', async () => {
    const r = await loadSingleFile(file('tiny.json', INLINE_MODEL));
    expect(r.error).toBeUndefined();
    expect(r.source?.manifest?.name).toBe('tiny');
    // A package like any other — not the lesser document the old path made.
    expect(r.source?.folderName).toBe('tiny');
    expect(r.source?.manifestPath).toBe('cuboidy.json');
    expect([...(r.source?.parts.keys() ?? [])]).toEqual(['body']);
  });

  it('stores it under cuboidy.json whatever the file was called', async () => {
    // Every path-keyed reader in the editor expects the anchor at its
    // fixed name (§3); the name on disk is not authoritative.
    const r = await loadSingleFile(file('whatever.json', INLINE_MODEL));
    expect([...(r.source?.files.keys() ?? [])]).toEqual(['cuboidy.json']);
  });

  it('needs no geometry file, and does not ask for one', async () => {
    // The ["voxels.json"] default would otherwise report it missing —
    // §6.9 skips the default when no part needs the by-name lookup.
    const r = await loadSingleFile(file('tiny.json', INLINE_MODEL));
    expect(r.source?.primaryPath).toBeUndefined();
    expect(r.source?.projectErrors ?? []).toEqual([]);
  });

  it('a loose GEOMETRY file opens as a broken manifest, not as a model', async () => {
    // It is read as a manifest, so it fails as one — and that failure is
    // reported the way any bad manifest is: the document opens with its
    // text and the error, rather than being refused. The author can then
    // turn it into a manifest without leaving the editor.
    const geometry = JSON.stringify({
      version: '0.9',
      palette: ['#FF0000'],
      parts: [{ name: 'body', size: [1, 1, 1], voxels: [['0']] }],
    });
    const r = await loadSingleFile(file('voxels.json', geometry));
    expect(r.error).toBeUndefined();
    expect(r.source?.manifest).toBeUndefined();
    // A geometry `parts` entry has no `name` at the manifest's level.
    expect(r.source?.manifestError).toMatch(/name/);
  });

  it('a manifest that PARSES badly still opens, so it can be fixed', async () => {
    const r = await loadSingleFile(file('tiny.json', '{ "name": 42 }'));
    expect(r.source).toBeDefined();
    expect(r.source?.manifest).toBeUndefined();
    expect(r.source?.manifestError).toBeDefined();
    // The bytes are on screen — that is the whole point of loading it.
    expect(r.source?.files.get('cuboidy.json')).toBe('{ "name": 42 }');
  });
});
