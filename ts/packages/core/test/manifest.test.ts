import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '../src/manifest.js';
import { readFixtureJson } from './helpers/fixtures.js';

describe('ManifestSchema', () => {
  it('parses wolf/cuboidy.json', async () => {
    const json = await readFixtureJson('wolf/cuboidy.json');
    const m = ManifestSchema.parse(json);

    expect(m.name).toBe('wolf');
    expect(m.parts).toHaveLength(3);
    expect(m.parts[0]?.name).toBe('body');
    expect(m.parts[1]?.name).toBe('head');
    expect(m.parts[1]?.parent).toBe('body');
    expect(m.parts[1]?.position).toEqual([1, 2, 4]);
    expect(m.animations?.['idle']).toBeDefined();
  });

  it('parses crown/cuboidy.json', async () => {
    const json = await readFixtureJson('crown/cuboidy.json');
    const m = ManifestSchema.parse(json);

    expect(m.name).toBe('crown');
    expect(m.parts).toHaveLength(1);
    expect(m.parts[0]?.name).toBe('crown');
  });

  it('C01: rejects manifest without name', async () => {
    const json = await readFixtureJson('fixtures/json/C01-missing-name.json');
    expect(() => ManifestSchema.parse(json)).toThrow();
  });

  it('C02: rejects manifest with empty parts', async () => {
    const json = await readFixtureJson('fixtures/json/C02-empty-parts.json');
    expect(() => ManifestSchema.parse(json)).toThrow();
  });
});
