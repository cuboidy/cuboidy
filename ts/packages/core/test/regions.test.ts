import { describe, expect, it } from 'vitest';
import { parseGeometry, parseGeometryText } from '../src/geometry/parse.js';
import { serializeGeometry } from '../src/geometry/serialize.js';
import { duplicatePart, mirrorPart, refitRegions } from '../src/geometry/transform.js';
import type { Geometry, Part, RegionGrid } from '../src/geometry/types.js';
import { AIR } from '../src/geometry/voxel-row.js';
import { lintGeometry } from '../src/lint/voxel-rules.js';
import { validateProject } from '../src/lint/cross-file.js';
import { parseManifest } from '../src/manifest.js';
import { buildMesh } from '../src/mesh.js';
import { resolveProject } from '../src/project.js';

// SPEC §7.13: which of a part's cells belong to which named region — a name
// for the whole part, or a grid the shape of its voxels with keys. Region
// names are the reader's; nothing here knows what a `skin` is.

// A 3-wide, 2-high, 1-deep part. Its bottom layer is two cells marked skin
// and one of air; its top layer is painted in one entry throughout, two cells
// marked cloth and the third in no region -- a stud painted as the cloth
// beside it, the case the colour of a cell cannot tell apart.
const voxels = [['11.'], ['000']];
const grid = { keys: { s: 'skin', c: 'cloth' }, cells: [['ss.'], ['cc.']] };

function file(regions: unknown, partVoxels: unknown = voxels, size: unknown = [3, 2, 1]): unknown {
  return {
    palette: ['#F6CA9F', '#424C6E'],
    parts: [{ name: 'forearm', size, voxels: partVoxels, ...(regions === undefined ? {} : { regions }) }],
  };
}

function codeOf(json: unknown): string {
  const r = parseGeometry(json);
  return r.ok ? 'ok' : r.code;
}

function geometryOf(json: unknown): Geometry {
  const r = parseGeometry(json);
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

function partOf(json: unknown): Part {
  return geometryOf(json).parts[0]!;
}

describe('regions (§7.13) — reading', () => {
  it('reads a region name for the whole part', () => {
    expect(partOf(file('skin')).regions).toBe('skin');
  });

  it('reads a grid as written, keys included', () => {
    expect(partOf(file(grid)).regions).toEqual(grid);
  });

  it('is absent from a part that declares none, and nothing stands in for it', () => {
    expect(Object.hasOwn(partOf(file(undefined)), 'regions')).toBe(false);
  });

  it('keys mean nothing to the palette: a key may be a character that is also a colour', () => {
    // `0` is palette entry 0 in `voxels`; as a key it is just the name of `skin`.
    const r = partOf(file({ keys: { '0': 'skin' }, cells: [['00.'], ['...']] }));
    expect((r.regions as RegionGrid).keys).toEqual({ '0': 'skin' });
  });

  it('two keys may name one region', () => {
    expect(codeOf(file({ keys: { a: 'skin', b: 'skin' }, cells: [['ab.'], ['...']] }))).toBe('ok');
  });

  it.each([
    ['a field other than keys and cells', { ...grid, names: {} }, 'unknown'],
    ['a grid with no cells', { keys: grid.keys }, 'missing'],
    ['a grid with no keys', { cells: grid.cells }, 'missing'],
    ['a grid with no key at all', { keys: {}, cells: [['...'], ['...']] }, 'wrong-arity'],
    ['a key of two characters', { keys: { ss: 'skin' }, cells: [['...'], ['...']] }, 'invalid-value'],
    ['`.` as a key, which is what no region is', { keys: { '.': 'skin' }, cells: [['...'], ['...']] }, 'invalid-value'],
    ['a key outside the voxel alphabet', { keys: { '#': 'skin' }, cells: [['...'], ['...']] }, 'invalid-value'],
    ['a region name failing §5', '1skin', 'invalid-value'],
    ['a reserved word as a region name', 'palette', 'invalid-value'],
    ['a key naming a region that fails §5', { keys: { s: 'skin tone' }, cells: [['s..'], ['...']] }, 'invalid-value'],
    ['a number', 7, 'invalid-value'],
    ['an array', ['skin'], 'invalid-value'],
    ['a cell outside the voxel alphabet', { keys: { s: 'skin' }, cells: [['s#.'], ['...']] }, 'invalid-value'],
  ])('refuses %s', (_label, regions, code) => {
    expect(codeOf(file(regions))).toBe(code);
  });

  it.each([
    ['too few layers', { keys: { s: 'skin' }, cells: [['s..']] }],
    ['too few rows in a layer', { keys: { s: 'skin' }, cells: [['s..'], []] }],
    ['a row too short', { keys: { s: 'skin' }, cells: [['s.'], ['...']] }],
    ['a row too long', { keys: { s: 'skin' }, cells: [['s...'], ['...']] }],
  ])('refuses a grid that is not the shape of the voxels: %s', (_label, regions) => {
    expect(codeOf(file(regions))).toBe('wrong-arity');
  });

  it('refuses a cell holding a character the grid declares no key for', () => {
    expect(codeOf(file({ keys: { s: 'skin' }, cells: [['sc.'], ['...']] }))).toBe('invalid-value');
  });

  it('reports a field error elsewhere ahead of a grid of the wrong shape (§11.8)', () => {
    // A stale grid is phase 3; a part with no `name` is phase 2.
    const json = file({ keys: { s: 'skin' }, cells: [['s.'], ['...']] }) as { parts: unknown[] };
    json.parts.push({ size: [1, 1, 1], voxels: [['0']] });
    expect(codeOf(json)).toBe('missing');
  });

  it('names where the stale grid is', () => {
    const r = parseGeometryText(JSON.stringify(file({ keys: { s: 'skin' }, cells: [['s.'], ['...']] }), null, 2));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.path).toEqual(['parts', 0, 'regions', 'cells', 0, 0]);
  });
});

describe('regions (§7.13) — inline in a manifest (§6.13)', () => {
  const manifest = (geometry: Record<string, unknown>) => ({
    name: 'one_file',
    palette: ['#F6CA9F', '#424C6E'],
    parts: [{ name: 'forearm', geometry }],
  });
  const inline = { size: [3, 2, 1], voxels };

  it('reaches the resolved part, so a model of one file carries it', () => {
    const m = parseManifest(manifest({ ...inline, regions: grid }));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const project = resolveProject(m.value, new Map());
    expect(project.parts.get('forearm')?.part.regions).toEqual(grid);
  });

  it('is held to the part shape there too', () => {
    const m = parseManifest(manifest({ ...inline, regions: { keys: { s: 'skin' }, cells: [['s..']] } }));
    expect(m.ok ? 'ok' : m.code).toBe('wrong-arity');
  });

  it('belongs to the shape, so a reference to a file cannot carry it', () => {
    const m = parseManifest(manifest({ path: 'voxels.json', regions: 'skin' }));
    expect(m.ok ? 'ok' : m.code).toBe('unknown');
  });
});

describe('regions (§7.13) — writing', () => {
  it('round-trips both forms byte for byte', () => {
    const json = {
      palette: ['#F6CA9F', '#424C6E'],
      parts: [
        { name: 'forearm', size: [3, 2, 1], voxels, regions: grid },
        { name: 'hand', size: [1, 1, 1], voxels: [['0']], regions: 'skin' },
      ],
    };
    const first = parseGeometry(json);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const text = serializeGeometry(first.value);
    const again = parseGeometryText(text);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(serializeGeometry(again.value)).toBe(text);
    expect(again.value.parts[0]!.regions).toEqual(grid);
    expect(again.value.parts[1]!.regions).toBe('skin');
  });

  it('writes keys in the order of the voxel alphabet, whatever order they were read in', () => {
    const json = file({ keys: { s: 'skin', '0': 'zero', B: 'big', b: 'cloth' }, cells: [['s0.'], ['bB.']] });
    const text = serializeGeometry(geometryOf(json));
    expect(text).toContain('"keys": { "0": "zero", "b": "cloth", "s": "skin", "B": "big" }');
  });

  it('writes a grid after the voxels, one layer a line, as the voxels are', () => {
    const text = serializeGeometry(geometryOf(file(grid)));
    expect(text).toContain(
      [
        '      "voxels": [',
        '        ["11."],',
        '        ["000"]',
        '      ],',
        '      "regions": {',
        '        "keys": { "c": "cloth", "s": "skin" },',
        '        "cells": [',
        '          ["ss."],',
        '          ["cc."]',
        '        ]',
        '      }',
      ].join('\n'),
    );
  });

  it('writes nothing for a part with none', () => {
    const text = serializeGeometry(geometryOf(file(undefined)));
    expect(text).not.toContain('regions');
  });
});

describe('regions (§7.13) — draw nothing', () => {
  it('two parts differing only in their regions mesh to the same faces', () => {
    const palette = geometryOf(file(undefined)).palette;
    const plain = buildMesh(partOf(file(undefined)), palette);
    const marked = buildMesh(partOf(file(grid)), palette);
    expect(marked).toEqual(plain);
  });
});

describe('regions (§7.13) — tools that reshape a part', () => {
  const forearm = partOf(file(grid));

  it('mirror reflects a grid with the voxels it marks', () => {
    const mirrored = mirrorPart(forearm, 'x', 'forearm-r');
    expect(mirrored.voxels).toEqual([[[AIR, 1, 1]], [[0, 0, 0]]]);
    expect(mirrored.regions).toEqual({ keys: grid.keys, cells: [['.ss'], ['.cc']] });
  });

  it('duplicate copies it', () => {
    expect(duplicatePart(forearm, 'copy').regions).toEqual(grid);
  });

  it('a refit moves each mark with its cell and gives a new cell none', () => {
    // The grid grows one column on the left: every old cell moves +1 in x.
    // The new cell at x 0 is solid and in no region; the stud stays out.
    const grown = [[[0, 1, 1, AIR]], [[AIR, 0, 0, 0]]];
    expect(refitRegions(forearm.regions, grown, { x: 1, y: 0, z: 0 })).toEqual({
      keys: grid.keys,
      cells: [['.ss.'], ['.cc.']],
    });
  });

  it('a refit drops the mark of a cell that is now air', () => {
    const erased = [[[AIR, 1, AIR]], [[0, 0, 0]]];
    expect(refitRegions(forearm.regions, erased)).toEqual({ keys: grid.keys, cells: [['.s.'], ['cc.']] });
  });

  it('a refit keeps a region name and an absence as they are', () => {
    expect(refitRegions('skin', [[[AIR]]])).toBe('skin');
    expect(refitRegions(undefined, [[[0]]])).toBeUndefined();
  });
});

describe('regions (§7.13) — W12, a mark on a cell with no voxel', () => {
  it('reports a grid marking air, once per part', () => {
    const stale = partOf(file({ keys: { s: 'skin' }, cells: [['s.s'], ['..s']] }, [['0..'], ['000']]));
    const w12 = lintGeometry({ palette: [], parts: [stale] }).filter((d) => d.ruleId === 'W12');
    expect(w12).toHaveLength(1);
    expect(w12[0]!.severity).toBe('warning');
    expect(w12[0]!.message).toContain('1 region mark(s)');
    expect(w12[0]!.message).toContain('[2, 0, 0]');
  });

  it('is silent for marks on solid cells, and for a region name', () => {
    expect(lintGeometry({ palette: [], parts: [partOf(file(grid))] }).some((d) => d.ruleId === 'W12')).toBe(false);
    expect(lintGeometry({ palette: [], parts: [partOf(file('skin'))] }).some((d) => d.ruleId === 'W12')).toBe(false);
  });

  it('reaches a part written inline, which no geometry file holds', () => {
    const m = parseManifest({
      name: 'one_file',
      palette: ['#F6CA9F'],
      parts: [{ name: 'hand', geometry: { size: [2, 1, 1], voxels: [['0.']], regions: { keys: { s: 'skin' }, cells: [['ss']] } } }],
    });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const project = resolveProject(m.value, new Map());
    const diags = validateProject({
      manifest: m.value,
      geometries: project.geometries,
      parts: project.parts,
      unresolved: project.unresolved,
    });
    expect(diags.filter((d) => d.ruleId === 'W12')).toHaveLength(1);
  });
});
