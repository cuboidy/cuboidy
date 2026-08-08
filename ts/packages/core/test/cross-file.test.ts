import { describe, expect, it } from 'vitest';
import { parseManifest, type Manifest } from '../src/manifest.js';
import { resolveProject } from '../src/project.js';
import { parseGeometryText } from '../src/geometry/parse.js';
import { geo } from './helpers/geometry.js';
import { validateProject } from '../src/lint/cross-file.js';
import { readFixtureJson, readFixtureText } from './helpers/fixtures.js';
import { RIGGED, RIGGED_PARTS, SINGLE } from './helpers/corpus.js';
import { rgba } from './helpers/palette.js';

async function loadModel(folder: string) {
  const manifestR = parseManifest(
    await readFixtureJson(`${folder}/cuboidy.json`),
  );
  if (!manifestR.ok) throw new Error(`manifest parse failed: ${manifestR.message}`);
  const voxelDef = parseGeometryText(await readFixtureText(`${folder}/voxels.json`));
  if (!voxelDef.ok) throw new Error(`geometry parse failed: ${voxelDef.message}`);
  return { manifest: manifestR.value, voxelDef: voxelDef.value };
}

function manifestOrThrow(json: unknown) {
  const r = parseManifest(json);
  if (!r.ok) throw new Error(`manifest parse failed: ${r.message}`);
  return r.value;
}

// The single-file shape: a manifest and one geometry file, with no
// per-part binding. Called `validateCrossFile` through a shim until the
// shim's last non-test caller disappeared; the shape it exercises — the
// fallback that joins parts to shapes by NAME — is still reachable and
// still worth covering.
describe('validateProject — single geometry file', () => {
  it('reports no diagnostics for a rigged corpus model', async () => {
    const { manifest, voxelDef } = await loadModel(RIGGED);
    expect(validateProject({
      manifest: manifest,
      geometries: [{ path: 'voxels.json', geometry: voxelDef }],
    })).toEqual([]);
  });

  it('reports no diagnostics for a single-part corpus model', async () => {
    const { manifest, voxelDef } = await loadModel(SINGLE);
    expect(validateProject({
      manifest: manifest,
      geometries: [{ path: 'voxels.json', geometry: voxelDef }],
    })).toEqual([]);
  });

  it('X01: error when manifest references a part missing from voxels', async () => {
    const { voxelDef } = await loadModel(RIGGED);
    // Include every geometry part so the only cross-file delta is the extra
    // `tongue` — keeps this test focused on the X01 code path.
    const manifest = manifestOrThrow({
      name: 'rigged',
      parts: [
        ...RIGGED_PARTS,
        { name: 'tongue', parent: 'head' },
      ],
    });
    const diags = validateProject({
      manifest: manifest,
      geometries: [{ path: 'voxels.json', geometry: voxelDef }],
    });
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('missing');
    expect(diags[0]?.severity).toBe('error');
    expect(diags[0]?.message).toMatch(/tongue/);
  });

  it('X02: warning when voxels define a part not in manifest', async () => {
    const { voxelDef } = await loadModel(RIGGED);
    // Manifest omits only `tail`; every other part is present so the
    // diagnostic set narrows to the single X02 we want to assert on.
    const manifest = manifestOrThrow({
      name: 'rigged',
      parts: RIGGED_PARTS.filter((p) => p.name !== 'tail'),
    });
    const diags = validateProject({
      manifest: manifest,
      geometries: [{ path: 'voxels.json', geometry: voxelDef }],
    });
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('unknown');
    expect(diags[0]?.severity).toBe('warning');
    expect(diags[0]?.message).toMatch(/tail/);
  });

  it('reports both X01 and X02 when present', async () => {
    const { voxelDef } = await loadModel(RIGGED);
    // Manifest is missing two parts (head, tail) AND introduces an unknown
    // `wing` — so we expect 1 X01 (`missing`) + 2 X02 (`unknown`).
    const manifest = manifestOrThrow({
      name: 'rigged',
      parts: [
        ...RIGGED_PARTS.filter((p) => p.name !== 'head' && p.name !== 'tail'),
        { name: 'wing' },
      ],
    });
    const diags = validateProject({
      manifest: manifest,
      geometries: [{ path: 'voxels.json', geometry: voxelDef }],
    });
    const codes = diags.map((d) => d.code).sort();
    expect(codes).toEqual(['missing', 'unknown', 'unknown']);
  });
});

// SPEC §11 (v0.7): project-shaped validation — multiple geometry files,
// palette binding resolution, unreferenced-file warning.
describe('validateProject (v0.7)', () => {
  function geometryOrThrow(text: string) {
    const r = parseGeometryText(text);
    if (!r.ok) throw new Error(`geometry parse failed: ${r.message}`);
    return r.value;
  }
  const oneVoxel = (name: string, cell: string, palette?: string[] | string) =>
    geometryOrThrow(
      geo([{ name, size: [1, 1, 1], voxels: [[cell]] }], palette),
    );

  const bodyCvox = oneVoxel('body', '1', ['#F00', '#0F0']);
  // No palette at all; uses index 0 (an error — nothing defines that color).
  const bareCvox = oneVoxel('gear', '0');
  // No palette; all air (never needs one).
  const airCvox = oneVoxel('ghost', '.');
  // A file that POINTS at a palette file. resolveProject fills `palette` in
  // before validateProject sees it, so these fixtures do that by hand.
  const resolved = (name: string, cell: string, colors: number) => ({
    ...oneVoxel(name, cell, 'palette.json'),
    palette: Array.from({ length: colors }, (_, i) => (rgba(i, 0, 0, 255))),
  });

  it('errors on a manifest part defined in no geometry file', () => {
    const manifest = manifestOrThrow({
      name: 't',
      parts: [{ name: 'body' }, { name: 'wing' }],
    });
    const diags = validateProject({
      manifest,
      geometries: [{ path: 'voxels.json', geometry: bodyCvox }],
    });
    expect(diags.some((d) => d.code === 'missing' && d.message.includes("'wing'"))).toBe(
      true,
    );
  });

  it('errors when a file uses color indices with no palette anywhere', () => {
    const manifest = manifestOrThrow({
      name: 't',
      geometry: ['gear.json'],
      parts: [{ name: 'gear' }],
    });
    const diags = validateProject({
      manifest,
      geometries: [{ path: 'gear.json', geometry: bareCvox }],
    });
    expect(
      diags.some((d) => d.code === 'missing' && d.message.includes('no palette')),
    ).toBe(true);
  });

  it('accepts an all-air file with no palette anywhere', () => {
    const manifest = manifestOrThrow({
      name: 't',
      geometry: ['ghost.json'],
      parts: [{ name: 'ghost' }],
    });
    expect(
      validateProject({
        manifest,
        geometries: [{ path: 'ghost.json', geometry: airCvox }],
      }),
    ).toEqual([]);
  });

  it('a resolved palette reference satisfies the file that points at it', () => {
    const manifest = manifestOrThrow({
      name: 't',
      geometry: ['gear.json'],
      parts: [{ name: 'gear' }],
    });
    const diags = validateProject({
      manifest,
      geometries: [{ path: 'gear.json', geometry: resolved('gear', '0', 1) }],
    });
    expect(diags).toEqual([]);
  });

  it('reports a reference that did not resolve, naming it', () => {
    const manifest = manifestOrThrow({
      name: 't',
      geometry: ['gear.json'],
      parts: [{ name: 'gear' }],
    });
    const diags = validateProject({
      manifest,
      geometries: [
        // paletteRef set but palette still empty = the project layer could
        // not read it, and already said so; this names the consequence.
        { path: 'gear.json', geometry: oneVoxel('gear', '0', 'palette.json') },
      ],
    });
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('missing');
    expect(diags[0]?.message).toContain('palette.json');
  });

  it('errors when a referenced palette is shorter than the used indices', () => {
    const manifest = manifestOrThrow({
      name: 't',
      geometry: ['body.json'],
      parts: [{ name: 'body' }],
    });
    // The file uses index 1; the palette it points at holds one color. Only
    // cross-file validation can catch this — parse time never saw the file.
    const diags = validateProject({
      manifest,
      geometries: [{ path: 'body.json', geometry: resolved('body', '1', 1) }],
    });
    expect(
      diags.some(
        (d) => d.code === 'invalid-value' && d.severity === 'error' && d.message.includes('index 1'),
      ),
    ).toBe(true);
  });


  it('W07: warns on a package geometry file not referenced by the geometry list', () => {
    const manifest = manifestOrThrow({
      name: 't',
      geometry: ['body.json'],
      parts: [{ name: 'body' }],
    });
    const diags = validateProject({
      manifest,
      geometries: [{ path: 'body.json', geometry: bodyCvox }],
      packageGeometryPaths: ['body.json', 'scratch.json'],
    });
    expect(diags.map((d) => d.ruleId)).toEqual(['W07']);
    expect(diags[0]?.message).toContain('scratch.json');
  });
});

// SPEC §6.12 / §11.6 — the geometry half of a published socket's contract.
// The manifest half (the host part is in `parts` at all) is a parse-time
// error and is covered in manifest.test.ts.
describe('validateProject — published sockets (§6.12)', () => {
  function geometryOrThrow(text: string) {
    const r = parseGeometryText(text);
    if (!r.ok) throw new Error(`geometry parse failed: ${r.message}`);
    return r.value;
  }
  // A one-voxel `hand-r` declaring a single `grip` socket.
  const hand = geometryOrThrow(
    geo([
      {
        name: 'hand-r',
        size: [1, 1, 1],
        voxels: [['0']],
        sockets: [{ name: 'grip', pos: [0.5, 0.5, 0.5] }],
      },
    ], ['#F00']),
  );
  const publish = (socket: string, part = 'hand-r') =>
    validateProject({
      manifest: manifestOrThrow({
        name: 't',
        parts: [{ name: 'hand-r' }],
        sockets: { weapon: { part, socket } },
      }),
      geometries: [{ path: 'voxels.json', geometry: hand }],
    });

  it('accepts a publication whose socket the host part declares', () => {
    expect(publish('grip')).toEqual([]);
  });

  it('rigged corpus model publishes cleanly', async () => {
    const { manifest, voxelDef } = await loadModel(RIGGED);
    expect(manifest.sockets?.['headwear']).toEqual({
      part: 'head',
      socket: 'hat',
    });
    expect(validateProject({
      manifest: manifest,
      geometries: [{ path: 'voxels.json', geometry: voxelDef }],
    })).toEqual([]);
  });

  it('errors when the host part declares no socket by that name', () => {
    const diags = publish('hold');
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('missing');
    expect(diags[0]?.severity).toBe('error');
    expect(diags[0]?.message).toContain("published socket 'weapon'");
    expect(diags[0]?.message).toContain("socket 'hold'");
    expect(diags[0]?.message).toContain("part 'hand-r'");
  });

  it('a socket name declared on a DIFFERENT part does not satisfy the publication', () => {
    // §7.8 uniqueness is per-part, so `grip` existing somewhere in the model
    // says nothing about whether `head` has one.
    const twoParts = geometryOrThrow(
      geo([
        {
          name: 'hand-r',
          size: [1, 1, 1],
          voxels: [['0']],
          sockets: [{ name: 'grip', pos: [0, 0, 0] }],
        },
        { name: 'head', size: [1, 1, 1], voxels: [['0']] },
      ], ['#F00']),
    );
    const diags = validateProject({
      manifest: manifestOrThrow({
        name: 't',
        parts: [{ name: 'hand-r' }, { name: 'head' }],
        sockets: { weapon: { part: 'head', socket: 'grip' } },
      }),
      geometries: [{ path: 'voxels.json', geometry: twoParts }],
    });
    expect(diags.map((d) => d.code)).toEqual(['missing']);
  });

  it('stays quiet when the host part is in the manifest but in no geometry file', () => {
    // That part already has its own `missing` error; a second diagnostic
    // about its sockets would just be noise pointing at the same cause.
    const diags = validateProject({
      manifest: manifestOrThrow({
        name: 't',
        parts: [{ name: 'hand-r' }, { name: 'ghost' }],
        sockets: { weapon: { part: 'ghost', socket: 'grip' } },
      }),
      geometries: [{ path: 'voxels.json', geometry: hand }],
    });
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toContain("part 'ghost'");
    expect(diags[0]?.message).toContain('not defined in any geometry file');
  });
});

// SPEC §6.13 / §11.6 — the cross-file rules that only exist because a part
// can now live in the manifest rather than a file.
describe('validateProject — inline geometry (§6.13)', () => {
  const inlineManifest = (extra: object, geometry: object) =>
    manifestOrThrow({ name: 'm', parts: [{ name: 'body', geometry }], ...extra });

  const run = (m: Manifest, files = new Map<string, string>()) => {
    const p = resolveProject(m, files);
    return validateProject({
      manifest: m,
      geometries: p.geometries,
      parts: p.parts,
      unresolved: p.unresolved,
    });
  };

  it('an all-inline model with a manifest palette is clean', () => {
    const m = inlineManifest(
      { palette: ['#FF0000'] },
      { size: [1, 1, 1], voxels: [['0']] },
    );
    expect(run(m)).toEqual([]);
  });

  it('errors when an inline part uses indices and no palette resolved', () => {
    const m = inlineManifest({}, { size: [1, 1, 1], voxels: [['0']] });
    const diags = run(m);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('missing');
    expect(diags[0]?.message).toMatch(/inline part 'body'/);
  });

  it('all-air inline geometry needs no palette', () => {
    const m = inlineManifest({}, { size: [1, 1, 1], voxels: [['.']] });
    expect(run(m)).toEqual([]);
  });

  it('W08: a manifest palette no inline part falls back to', () => {
    // Exactly the shape of a leftover v0.7 manifest, where the same field
    // overrode geometry files instead — the one case that would otherwise
    // change meaning in silence.
    const m = manifestOrThrow({
      name: 'm',
      palette: '../shared/palette.json',
      parts: [{ name: 'body' }],
    });
    const diags = run(m, new Map([['voxels.json', oneVoxelText()]]));
    const w08 = diags.find((d) => d.ruleId === 'W08');
    expect(w08?.severity).toBe('warning');
  });

  it('W08 stays quiet when an inline part does fall back to it', () => {
    const m = inlineManifest(
      { palette: ['#FF0000'] },
      { size: [1, 1, 1], voxels: [['0']] },
    );
    expect(run(m).find((d) => d.ruleId === 'W08')).toBeUndefined();
  });

  it('W08 fires when every inline part declares its own palette', () => {
    const m = inlineManifest(
      { palette: ['#FF0000'] },
      { palette: ['#00FF00'], size: [1, 1, 1], voxels: [['0']] },
    );
    expect(run(m).find((d) => d.ruleId === 'W08')).toBeDefined();
  });

  it('an inline part takes part in W06 and in socket publication', () => {
    // Both used to read the geometry files only, so a part living in the
    // manifest would have been skipped by each without a word.
    const m = manifestOrThrow({
      name: 'm',
      palette: ['#FF0000'],
      parts: [
        {
          name: 'hand-r',
          geometry: {
            size: [1, 1, 1],
            voxels: [['0']],
            sockets: [{ name: 'grip', pos: [0, 0, 0] }],
          },
        },
      ],
      sockets: { weapon: { part: 'hand-r', socket: 'hold' } },
    });
    const diags = run(m);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toMatch(/declares no such socket/);
  });
});

function oneVoxelText(): string {
  return geo([{ name: 'body', size: [1, 1, 1], voxels: [['0']] }], ['#FF0000']);
}

// §11.8 defers an inline part's palette index range to phase 4 whenever the
// palette is anything but colors the part spells out itself — so this is the
// only place that range is ever checked. It used to skip the check the
// moment a palette resolved, leaving both deferred routes unguarded.
describe('validateProject — inline part palette range (§6.13 / §11.6)', () => {
  const inlinePart = (cell: string) => ({
    name: 'body',
    size: { w: 1, h: 1, d: 1 },
    pivot: { pos: { x: 0.5, y: 0, z: 0.5 } },
    sockets: [],
    voxels: [[[cell === '.' ? -1 : Number(cell)]]],
  });
  const twoColors = [
    rgba(0, 0, 0, 255),
    rgba(255, 255, 255, 255),
  ];
  const run = (palette: typeof twoColors, cell: string) =>
    validateProject({
      manifest: manifestOrThrow({
        name: 't',
        palette: ['#000000', '#FFFFFF'],
        parts: [{ name: 'body', geometry: { size: [1, 1, 1], voxels: [['0']] } }],
      }),
      geometries: [],
      parts: new Map([
        ['body', { part: inlinePart(cell), palette, source: null }],
      ]),
      unresolved: [],
    });

  it('errors when an index is past the resolved palette', () => {
    const d = run(twoColors, '5').find((x) => x.code === 'invalid-value');
    expect(d?.severity).toBe('error');
    expect(d?.message).toContain('index 5');
    expect(d?.message).toContain('2 color');
  });

  it('accepts an index inside it', () => {
    expect(run(twoColors, '1').some((x) => x.code === 'invalid-value')).toBe(
      false,
    );
  });

  it('still reports a part that resolved to no palette at all', () => {
    const d = run([], '1').find((x) => x.code === 'missing');
    expect(d?.severity).toBe('error');
  });

  it('says nothing about an all-air part', () => {
    expect(run([], '.')).toEqual([]);
  });
});

// §11.6's name-uniqueness rule. Resolution refuses to bind the name (see
// project.test.ts); the REPORT is here, beside the other cross-file
// findings, so that one ambiguous name does not hide them. It briefly lived
// in `resolveProject`'s diagnostics, which set `complete: false` and gated
// this whole function off.
describe('validateProject — an ambiguous part name (§11.6)', () => {
  const geometryOrThrow = (text: string) => {
    const r = parseGeometryText(text);
    if (!r.ok) throw new Error(`geometry parse failed: ${r.message}`);
    return r.value;
  };
  const one = (name: string, cell: string, palette?: string[]) =>
    geometryOrThrow(geo([{ name, size: [1, 1, 1], voxels: [[cell]] }], palette));

  it('reports the duplicate AND everything else wrong with the model', () => {
    const dupPart = one('body', '0', ['#FF0000']);
    const diags = validateProject({
      manifest: manifestOrThrow({
        name: 't',
        geometry: ['a.json', 'b.json', 'orphan.json'],
        parts: [{ name: 'body' }],
      }),
      geometries: [
        { path: 'a.json', geometry: dupPart },
        { path: 'b.json', geometry: dupPart },
        { path: 'orphan.json', geometry: one('spare', '0', ['#00FF00']) },
      ],
      parts: new Map(),
      unresolved: [{ name: 'body', message: "part 'body' has no shape" }],
      duplicates: [{ name: 'body', files: ['a.json', 'b.json'] }],
    });
    const dup = diags.find((d) => d.code === 'duplicate');
    expect(dup?.severity).toBe('error');
    expect(dup?.message).toContain('a.json');
    expect(dup?.message).toContain('b.json');
    // The findings that used to vanish with it.
    expect(diags.some((d) => d.message.includes("'spare'"))).toBe(true);
    expect(diags.some((d) => d.message.includes('has no shape'))).toBe(true);
  });

  it('says nothing when no name is ambiguous', () => {
    const diags = validateProject({
      manifest: manifestOrThrow({
        name: 't',
        geometry: ['a.json'],
        parts: [{ name: 'body' }],
      }),
      geometries: [{ path: 'a.json', geometry: one('body', '0', ['#FF0000']) }],
      parts: new Map(),
      unresolved: [],
      duplicates: [],
    });
    expect(diags.some((d) => d.code === 'duplicate')).toBe(false);
  });
});
