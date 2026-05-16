import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest.js';
import { parseCvox } from '../src/cvox/parse.js';
import { validateCrossFile } from '../src/lint/cross-file.js';
import { readFixtureJson, readFixtureText } from './helpers/fixtures.js';

async function loadModel(folder: string) {
  const manifestR = parseManifest(
    await readFixtureJson(`${folder}/cuboidy.json`),
  );
  if (!manifestR.ok) throw new Error(`manifest parse failed: ${manifestR.message}`);
  const voxelDef = parseCvox(await readFixtureText(`${folder}/voxels.cvox`));
  if (!voxelDef.ok) throw new Error(`cvox parse failed: ${voxelDef.message}`);
  return { manifest: manifestR.value, voxelDef: voxelDef.value };
}

function manifestOrThrow(json: unknown) {
  const r = parseManifest(json);
  if (!r.ok) throw new Error(`manifest parse failed: ${r.message}`);
  return r.value;
}

describe('validateCrossFile', () => {
  it('reports no diagnostics for wolf', async () => {
    const { manifest, voxelDef } = await loadModel('wolf');
    expect(validateCrossFile(manifest, voxelDef)).toEqual([]);
  });

  it('reports no diagnostics for crown', async () => {
    const { manifest, voxelDef } = await loadModel('crown');
    expect(validateCrossFile(manifest, voxelDef)).toEqual([]);
  });

  it('X01: error when manifest references a part missing from voxels', async () => {
    const { voxelDef } = await loadModel('wolf');
    const manifest = manifestOrThrow({
      name: 'wolf',
      parts: [
        { name: 'body' },
        { name: 'head', parent: 'body' },
        { name: 'tail', parent: 'body' },
        { name: 'tongue', parent: 'head' },
      ],
    });
    const diags = validateCrossFile(manifest, voxelDef);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('X01');
    expect(diags[0]?.severity).toBe('error');
    expect(diags[0]?.message).toMatch(/tongue/);
  });

  it('X02: warning when voxels define a part not in manifest', async () => {
    const { voxelDef } = await loadModel('wolf');
    const manifest = manifestOrThrow({
      name: 'wolf',
      parts: [
        { name: 'body' },
        { name: 'head', parent: 'body' },
      ],
    });
    const diags = validateCrossFile(manifest, voxelDef);
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('X02');
    expect(diags[0]?.severity).toBe('warning');
    expect(diags[0]?.message).toMatch(/tail/);
  });

  it('reports both X01 and X02 when present', async () => {
    const { voxelDef } = await loadModel('wolf');
    const manifest = manifestOrThrow({
      name: 'wolf',
      parts: [
        { name: 'body' },
        { name: 'wing' },
      ],
    });
    const diags = validateCrossFile(manifest, voxelDef);
    const codes = diags.map((d) => d.code).sort();
    expect(codes).toEqual(['X01', 'X02', 'X02']);
  });
});
