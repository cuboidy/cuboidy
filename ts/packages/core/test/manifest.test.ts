import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest.js';
import { readFixtureJson } from './helpers/fixtures.js';

describe('parseManifest', () => {
  it('parses wolf/cuboidy.json', async () => {
    const json = await readFixtureJson('wolf/cuboidy.json');
    const r = parseManifest(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const m = r.value;
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
    const r = parseManifest(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.name).toBe('crown');
    expect(r.value.parts).toHaveLength(1);
    expect(r.value.parts[0]?.name).toBe('crown');
  });

  it('C01: rejects manifest without name', async () => {
    const json = await readFixtureJson('fixtures/json/C01-missing-name.json');
    const r = parseManifest(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('C01');
  });

  it('C02: rejects manifest with empty parts', async () => {
    const json = await readFixtureJson('fixtures/json/C02-empty-parts.json');
    const r = parseManifest(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('C02');
  });

  it('C13: rejects manifest with unknown top-level field', () => {
    const json = {
      name: 'test',
      parts: [{ name: 'body' }],
      mystery: 'unexpected',
    };
    const r = parseManifest(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('C13');
  });

  it('C13: rejects manifest with unknown field on a part', () => {
    const json = {
      name: 'test',
      parts: [{ name: 'body', mystery: true }],
    };
    const r = parseManifest(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('C13');
  });
});
