import { describe, expect, it } from 'vitest';
import { buildLibrary } from '../src/lib/library.js';

// The workspace's unit is a FOLDER OF MODELS. Grouping a flat path map by
// first segment and reading each group as a package is the whole of it —
// everything past that point is core's resolveProject, so what these test
// is the grouping and what the library does with a group that misbehaves.

const geometry = (name: string) =>
  JSON.stringify({
    version: '0.9',
    palette: ['#FF0000'],
    parts: [{ name, size: [1, 1, 1], voxels: [['0']] }],
  });

const manifest = (name: string, extra: object = {}) =>
  JSON.stringify({ name, parts: [{ name: 'body' }], ...extra });

describe('buildLibrary', () => {
  it('reads each subfolder holding a cuboidy.json as a model', () => {
    const lib = buildLibrary(
      'models',
      new Map([
        ['knight/cuboidy.json', manifest('knight')],
        ['knight/voxels.json', geometry('body')],
        ['sword/cuboidy.json', manifest('sword')],
        ['sword/voxels.json', geometry('body')],
      ]),
    );
    expect(lib.models.map((m) => m.dir)).toEqual(['knight', 'sword']);
    expect(lib.models[0]?.problems).toEqual([]);
    expect(lib.models[0]?.parts.size).toBe(1);
  });

  it('sorts models by folder name, so the list does not depend on walk order', () => {
    const lib = buildLibrary(
      'models',
      new Map([
        ['zebra/cuboidy.json', manifest('zebra')],
        ['zebra/voxels.json', geometry('body')],
        ['apple/cuboidy.json', manifest('apple')],
        ['apple/voxels.json', geometry('body')],
      ]),
    );
    expect(lib.models.map((m) => m.dir)).toEqual(['apple', 'zebra']);
  });

  it('skips a subfolder with no manifest, and says which', () => {
    // SPEC §3: no manifest, no model. A library folder may hold anything,
    // so this is reported rather than treated as an error.
    const lib = buildLibrary(
      'models',
      new Map([
        ['knight/cuboidy.json', manifest('knight')],
        ['knight/voxels.json', geometry('body')],
        ['notes/README.md', '# hello'],
      ]),
    );
    expect(lib.models.map((m) => m.dir)).toEqual(['knight']);
    expect(lib.skipped).toEqual(['notes']);
  });

  it('ignores a loose file at the library root', () => {
    const lib = buildLibrary('models', new Map([['cuboidy.json', manifest('x')]]));
    expect(lib.models).toEqual([]);
    expect(lib.skipped).toEqual([]);
  });

  it('still lists a model whose manifest does not parse', () => {
    // Seeing that a folder is there and broken beats it silently missing
    // from the list — the user would otherwise wonder where it went.
    const lib = buildLibrary(
      'models',
      new Map([['broken/cuboidy.json', '{ not json']]),
    );
    expect(lib.models.map((m) => m.dir)).toEqual(['broken']);
    expect(lib.models[0]?.problems[0]).toMatch(/cuboidy\.json/);
    expect(lib.models[0]?.parts.size).toBe(0);
  });

  it('reports a model whose geometry reference is missing', () => {
    const lib = buildLibrary(
      'models',
      new Map([['ghost/cuboidy.json', manifest('ghost')]]),
    );
    expect(lib.models[0]?.problems.join(' ')).toMatch(/voxels\.json/);
  });

  it('flattens inline and external clips into one map', () => {
    // §6.3: a scene plays a clip by name and has no reason to know which
    // form the author wrote.
    const lib = buildLibrary(
      'models',
      new Map([
        [
          'm/cuboidy.json',
          manifest('m', {
            animations: {
              idle: { duration: 1, loop: true, parts: {} },
              walk: 'anims/walk.json',
            },
          }),
        ],
        ['m/voxels.json', geometry('body')],
        ['m/anims/walk.json', '{"duration":2,"loop":true,"parts":{}}'],
      ]),
    );
    expect([...(lib.models[0]?.animations.keys() ?? [])].sort()).toEqual([
      'idle',
      'walk',
    ]);
  });

  it('carries a model with an all-inline manifest and no other file', () => {
    // SPEC §6.13 / §3: one cuboidy.json is a complete model. The library
    // must not demand a voxels.json beside it.
    const lib = buildLibrary(
      'models',
      new Map([
        [
          'tiny/cuboidy.json',
          JSON.stringify({
            name: 'tiny',
            palette: ['#FF0000'],
            parts: [
              { name: 'body', geometry: { size: [1, 1, 1], voxels: [['0']] } },
            ],
          }),
        ],
      ]),
    );
    expect(lib.models[0]?.problems).toEqual([]);
    expect(lib.models[0]?.parts.size).toBe(1);
  });
});
