import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest.js';
import { parseGeometryText } from '../src/geometry/parse.js';
import { geo } from './helpers/geometry.js';
import { validateCrossFile, validateProject } from '../src/lint/cross-file.js';
import { readFixtureJson, readFixtureText } from './helpers/fixtures.js';

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

describe('validateCrossFile', () => {
  it('reports no diagnostics for wolf', async () => {
    const { manifest, voxelDef } = await loadModel('models/wolf');
    expect(validateCrossFile(manifest, voxelDef)).toEqual([]);
  });

  it('reports no diagnostics for crown', async () => {
    const { manifest, voxelDef } = await loadModel('models/crown');
    expect(validateCrossFile(manifest, voxelDef)).toEqual([]);
  });

  it('X01: error when manifest references a part missing from voxels', async () => {
    const { voxelDef } = await loadModel('models/wolf');
    // Include every wolf part so the only cross-file delta is the extra
    // `tongue` — keeps this test focused on the X01 code path.
    const manifest = manifestOrThrow({
      name: 'wolf',
      parts: [
        { name: 'body' },
        { name: 'head', parent: 'body' },
        { name: 'tail', parent: 'body' },
        { name: 'leg-fl', parent: 'body' },
        { name: 'leg-fr', parent: 'body' },
        { name: 'leg-bl', parent: 'body' },
        { name: 'leg-br', parent: 'body' },
        { name: 'tongue', parent: 'head' },
      ],
    });
    const diags = validateCrossFile(manifest, voxelDef);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('missing');
    expect(diags[0]?.severity).toBe('error');
    expect(diags[0]?.message).toMatch(/tongue/);
  });

  it('X02: warning when voxels define a part not in manifest', async () => {
    const { voxelDef } = await loadModel('models/wolf');
    // Manifest omits only `tail`; every other wolf part is present so the
    // diagnostic set narrows to the single X02 we want to assert on.
    const manifest = manifestOrThrow({
      name: 'wolf',
      parts: [
        { name: 'body' },
        { name: 'head', parent: 'body' },
        { name: 'leg-fl', parent: 'body' },
        { name: 'leg-fr', parent: 'body' },
        { name: 'leg-bl', parent: 'body' },
        { name: 'leg-br', parent: 'body' },
      ],
    });
    const diags = validateCrossFile(manifest, voxelDef);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('unknown');
    expect(diags[0]?.severity).toBe('warning');
    expect(diags[0]?.message).toMatch(/tail/);
  });

  it('reports both X01 and X02 when present', async () => {
    const { voxelDef } = await loadModel('models/wolf');
    // Manifest is missing two wolf parts (head, tail) AND introduces an
    // unknown `wing` — so we expect 1 X01 (`missing`) + 2 X02 (`unknown`).
    const manifest = manifestOrThrow({
      name: 'wolf',
      parts: [
        { name: 'body' },
        { name: 'leg-fl', parent: 'body' },
        { name: 'leg-fr', parent: 'body' },
        { name: 'leg-bl', parent: 'body' },
        { name: 'leg-br', parent: 'body' },
        { name: 'wing' },
      ],
    });
    const diags = validateCrossFile(manifest, voxelDef);
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
  const oneVoxel = (name: string, cell: string, palette?: string[]) =>
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
    palette: Array.from({ length: colors }, (_, i) => ({ r: i, g: 0, b: 0, a: 255 })),
  });

  it('errors on a part name defined in two geometry files', () => {
    const manifest = manifestOrThrow({
      name: 't',
      geometry: ['a.json', 'b.json'],
      parts: [{ name: 'body' }],
    });
    const diags = validateProject({
      manifest,
      geometries: [
        { path: 'a.json', geometry: bodyCvox },
        { path: 'b.json', geometry: bodyCvox },
      ],
    });
    const dup = diags.find((d) => d.code === 'duplicate');
    expect(dup?.severity).toBe('error');
    expect(dup?.message).toContain('a.json');
    expect(dup?.message).toContain('b.json');
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
      packageCvoxPaths: ['body.json', 'scratch.json'],
    });
    expect(diags.map((d) => d.ruleId)).toEqual(['W07']);
    expect(diags[0]?.message).toContain('scratch.json');
  });
});
