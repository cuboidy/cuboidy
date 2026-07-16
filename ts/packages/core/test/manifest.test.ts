import { describe, expect, it } from 'vitest';
import { manifestGeometry, parseManifest } from '../src/manifest.js';
import { readFixtureJson } from './helpers/fixtures.js';

describe('parseManifest', () => {
  it('parses models/wolf/cuboidy.json', async () => {
    const json = await readFixtureJson('models/wolf/cuboidy.json');
    const r = parseManifest(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const m = r.value;
    expect(m.name).toBe('wolf');
    expect(m.parts).toHaveLength(7);
    expect(m.parts[0]?.name).toBe('body');
    expect(m.parts[1]?.name).toBe('head');
    expect(m.parts[1]?.parent).toBe('body');
    expect(m.parts[1]?.position).toEqual([0, 3, -3]);
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

  it('parses models/crown/cuboidy.json', async () => {
    const json = await readFixtureJson('models/crown/cuboidy.json');
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

// SPEC §6.2 (v0.9): per-part rest rotation.
describe('parseManifest — part rotation (v0.9)', () => {
  it('accepts a part with a rotation triple', () => {
    const r = parseManifest({
      name: 'test',
      parts: [{ name: 'body', rotation: [0, 45, 0] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.parts[0]?.rotation).toEqual([0, 45, 0]);
  });

  it('leaves rotation absent when omitted (identity rest rotation)', () => {
    const r = parseManifest({ name: 'test', parts: [{ name: 'body' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.parts[0]?.rotation).toBeUndefined();
  });

  it('rejects a rotation with the wrong arity', () => {
    const r = parseManifest({
      name: 'test',
      parts: [{ name: 'body', rotation: [0, 45] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects a non-numeric rotation component', () => {
    const r = parseManifest({
      name: 'test',
      parts: [{ name: 'body', rotation: [0, '45', 0] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});

// SPEC §6.9 / §6.10 (v0.7): geometry list + external palette binding.
describe('parseManifest — geometry & palette (v0.7)', () => {
  const base = { name: 'test', parts: [{ name: 'body' }] };

  it('accepts a geometry list and a palette binding', () => {
    const r = parseManifest({
      ...base,
      geometry: ['body.cvox', 'gear/hat.cvox', '../shared/tail.cvox'],
      palette: 'palette.json',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.geometry).toEqual([
      'body.cvox',
      'gear/hat.cvox',
      '../shared/tail.cvox',
    ]);
    expect(r.value.palette).toBe('palette.json');
  });

  it('manifestGeometry applies the ["voxels.cvox"] default', () => {
    const r = parseManifest(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.geometry).toBeUndefined();
    expect(manifestGeometry(r.value)).toEqual(['voxels.cvox']);
  });

  it('rejects a geometry entry with the wrong extension', () => {
    const r = parseManifest({ ...base, geometry: ['body.json'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects an absolute geometry path', () => {
    const r = parseManifest({ ...base, geometry: ['/etc/body.cvox'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects backslashes in a reference path', () => {
    const r = parseManifest({ ...base, geometry: ['gear\\hat.cvox'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects URL and namespace:key forms', () => {
    for (const bad of ['https://x.com/a.cvox', 'pack:body.cvox']) {
      const r = parseManifest({ ...base, geometry: [bad] });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-value');
    }
  });

  it('rejects duplicate geometry entries', () => {
    const r = parseManifest({ ...base, geometry: ['a.cvox', 'a.cvox'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects an empty geometry list', () => {
    const r = parseManifest({ ...base, geometry: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects a bare extension as a path', () => {
    const r = parseManifest({ ...base, palette: '.json' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects a palette binding that is not .json', () => {
    const r = parseManifest({ ...base, palette: 'palette.cvox' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});

describe('parseManifest - hierarchy rules (SPEC ss11.5)', () => {
  const base = { name: 'm' };

  it('rejects a duplicate part name (duplicate)', () => {
    const r = parseManifest({
      ...base,
      parts: [{ name: 'body' }, { name: 'body' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('duplicate');
      expect(r.message).toMatch(/duplicate part name "body"/);
    }
  });

  it('rejects a parent that names no part (invalid-value)', () => {
    const r = parseManifest({
      ...base,
      parts: [{ name: 'body', parent: 'ghost' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-value');
      expect(r.message).toMatch(/parent "ghost"/);
    }
  });

  it('rejects a parent cycle (invalid-value)', () => {
    const r = parseManifest({
      ...base,
      parts: [
        { name: 'a', parent: 'b' },
        { name: 'b', parent: 'a' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-value');
      expect(r.message).toMatch(/cycle/);
    }
  });

  it('accepts a self-rooted valid hierarchy', () => {
    const r = parseManifest({
      ...base,
      parts: [{ name: 'body' }, { name: 'head', parent: 'body' }],
    });
    expect(r.ok).toBe(true);
  });
});

describe('parseManifest - animation validation (SPEC ss6.4/ss6.6/ss11.5)', () => {
  const withAnim = (anim: unknown) => ({
    name: 'm',
    parts: [{ name: 'body' }],
    animations: { walk: anim },
  });

  it('rejects an animation reference path violating ss8', () => {
    for (const bad of ['/abs.json', 'walk.txt', 'a\\b.json', 'http://x/a.json']) {
      const r = parseManifest(withAnim(bad));
      expect(r.ok).toBe(false);
    }
  });

  it('accepts a valid relative .json animation reference', () => {
    const r = parseManifest(withAnim('anims/walk.json'));
    expect(r.ok).toBe(true);
  });

  it('rejects a non-positive duration', () => {
    for (const d of [0, -1]) {
      const r = parseManifest(
        withAnim({ duration: d, loop: true, parts: {} }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/positive/);
    }
  });

  it('rejects a track not starting at "0.0"', () => {
    const r = parseManifest(
      withAnim({
        duration: 1,
        loop: true,
        parts: { body: { '0.5': { rot: [0, 0, 0] } } },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/first time key/);
  });

  it('rejects non-increasing time keys', () => {
    const r = parseManifest(
      withAnim({
        duration: 1,
        loop: true,
        parts: {
          body: {
            '0.0': { rot: [0, 0, 0] },
            '0.5': { rot: [0, 1, 0] },
            '0.25': { rot: [0, 2, 0] },
          },
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/strictly increasing/);
  });

  it('rejects a time key beyond duration', () => {
    const r = parseManifest(
      withAnim({
        duration: 1,
        loop: true,
        parts: {
          body: { '0.0': { rot: [0, 0, 0] }, '1.5': { rot: [0, 1, 0] } },
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/exceeds duration/);
  });

  it('rejects a non-numeric time key', () => {
    const r = parseManifest(
      withAnim({
        duration: 1,
        loop: true,
        parts: { body: { fast: { rot: [0, 0, 0] } } },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/decimal number/);
  });

  it('still accepts the wolf idle animation shape', () => {
    const r = parseManifest({
      name: 'm',
      parts: [{ name: 'tail' }],
      animations: {
        idle: {
          duration: 2,
          loop: true,
          parts: {
            tail: {
              '0.0': { rot: [0, 0, 0] },
              '1.0': { rot: [0, 25, 0] },
              '2.0': { rot: [0, 0, 0] },
            },
          },
        },
      },
    });
    expect(r.ok).toBe(true);
  });
});
