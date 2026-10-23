import { describe, expect, it } from 'vitest';
import { AIR, parseManifest, type Part } from '@cuboidy/core';
import { loadSingleFile } from '../src/lib/load-model.js';
import { withRegions } from '../src/lib/regions.js';
import { manifestText, withInlinePart } from '../src/lib/source-ops.js';

// SPEC §7.13 in the editor. It has no tool that paints regions; what it owes
// a model that carries them is to keep them — written back on save, and still
// the shape of the part after an edit that reshapes it, since a grid left at
// its old size is a document the reader refuses.

const file = (name: string, text: string): File =>
  new File([text], name, { type: 'application/json' });

// One file, one part: a 2-wide hand, skin on the left cell, a ring on the right.
const ONE_FILE = JSON.stringify({
  name: 'hand',
  palette: ['#F6CA9F', '#FFD700'],
  parts: [
    {
      name: 'hand',
      geometry: {
        size: [2, 1, 1],
        voxels: [['01']],
        regions: { keys: { s: 'skin' }, cells: [['s.']] },
      },
    },
  ],
});

describe('regions (§7.13) in the editor', () => {
  it('loads a one-file model with its regions on the part', async () => {
    const r = await loadSingleFile(file('hand.json', ONE_FILE));
    expect(r.source?.parts.get('hand')?.part.regions).toEqual({ keys: { s: 'skin' }, cells: [['s.']] });
  });

  it('writes them back when the shape is edited, refitted to the new grid', async () => {
    const r = await loadSingleFile(file('hand.json', ONE_FILE));
    const src = r.source!;
    // What the stroke tool does when a cell is attached on the left: the grid
    // grows a column, every old cell moves +1 in x, and the new cell is solid.
    const next = withInlinePart(src, 'hand', (prev) => {
      const p = prev!;
      const grown: Part = { ...p, size: { w: 3, h: 1, d: 1 }, voxels: [[[0, 0, 1]]] };
      return withRegions(p, grown, { x: 1, y: 0, z: 0 });
    });
    const written = parseManifest(JSON.parse(manifestText(next)!));
    expect(written.ok, written.ok ? '' : written.message).toBe(true);
    if (!written.ok) return;
    expect(written.value.parts[0]!.geometry?.regions).toEqual({ keys: { s: 'skin' }, cells: [['.s.']] });
  });

  it('withRegions drops the mark of an erased cell and keeps a name and an absence', () => {
    const p: Part = {
      name: 'hand',
      size: { w: 2, h: 1, d: 1 },
      pivot: { pos: { x: 1, y: 0, z: 0.5 } },
      sockets: [],
      voxels: [[[0, 1]]],
      regions: { keys: { s: 'skin' }, cells: [['ss']] },
    };
    expect(withRegions(p, { ...p, voxels: [[[AIR, 1]]] }).regions).toEqual({ keys: { s: 'skin' }, cells: [['.s']] });
    expect(withRegions({ ...p, regions: 'skin' }, { ...p, voxels: [[[AIR]]] }).regions).toBe('skin');
    const { regions: _none, ...bare } = p;
    expect(Object.hasOwn(withRegions(bare, { ...bare, voxels: [[[0]]] }), 'regions')).toBe(false);
  });
});
