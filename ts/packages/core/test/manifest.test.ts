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
    expect(m.parts).toHaveLength(7);
    expect(m.parts[0]?.name).toBe('body');
    expect(m.parts[1]?.name).toBe('head');
    expect(m.parts[1]?.parent).toBe('body');
    expect(m.parts[1]?.position).toEqual([0, 3, -5]);
    expect(m.parts.map((p) => p.name)).toEqual([
      'body',
      'head',
      'tail',
      'leg-fl',
      'leg-fr',
      'leg-bl',
      'leg-br',
    ]);
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

  it('rejects manifest without name (missing)', async () => {
    const json = await readFixtureJson('fixtures/json/missing/name.json');
    const r = parseManifest(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing');
  });

  it('rejects manifest with empty parts (missing)', async () => {
    const json = await readFixtureJson('fixtures/json/missing/parts.json');
    const r = parseManifest(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing');
  });

  it('C13: rejects manifest with unknown top-level field', () => {
    const json = {
      name: 'test',
      parts: [{ name: 'body' }],
      mystery: 'unexpected',
    };
    const r = parseManifest(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown');
  });

  it('C13: rejects manifest with unknown field on a part', () => {
    const json = {
      name: 'test',
      parts: [{ name: 'body', mystery: true }],
    };
    const r = parseManifest(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown');
  });

  it('invalid-value (not missing): wrong-type `name` falls through to invalid-value', () => {
    // The `missing` code is narrowed to genuinely absent fields. Wrong-type
    // cases fall through to invalid-value as a value-shape error.
    const json = { name: 123, parts: [{ name: 'body' }] };
    const r = parseManifest(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('invalid-value (not missing): wrong-type `parts` falls through to invalid-value', () => {
    const json = { name: 'test', parts: 'not an array' };
    const r = parseManifest(json);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});
