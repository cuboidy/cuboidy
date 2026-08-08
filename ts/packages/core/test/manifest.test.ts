import { describe, expect, it } from 'vitest';
import { manifestGeometry, parseManifest } from '../src/manifest.js';
import { readFixtureJson } from './helpers/fixtures.js';
import { RIGGED, RIGGED_PARTS, SINGLE } from './helpers/corpus.js';

describe('parseManifest', () => {
  it('parses a rigged corpus manifest', async () => {
    const json = await readFixtureJson(`${RIGGED}/cuboidy.json`);
    const r = parseManifest(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const m = r.value;
    expect(m.name).toBe('rigged');
    expect(m.parts[0]?.name).toBe('body');
    expect(m.parts[1]?.name).toBe('head');
    expect(m.parts[1]?.parent).toBe('body');
    expect(m.parts[1]?.position).toEqual([0, 4, -3]);
    expect(m.parts.map((p) => p.name)).toEqual(RIGGED_PARTS.map((p) => p.name));
    expect(m.animations?.['idle']).toBeDefined();
  });

  it('parses a single-part corpus manifest', async () => {
    const json = await readFixtureJson(`${SINGLE}/cuboidy.json`);
    const r = parseManifest(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.name).toBe('single');
    expect(r.value.parts).toHaveLength(1);
    expect(r.value.parts[0]?.name).toBe('cap');
  });

  it('rejects manifest without name (missing)', async () => {
    const json = await readFixtureJson('fixtures/manifest/missing/name.json');
    const r = parseManifest(json);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('missing');
      // Not Zod's "expected string, received undefined": an absent field is
      // described as absent, and the path is reported for positioning.
      expect(r.message).toBe('name: required field is missing');
      expect(r.path).toEqual(['name']);
    }
  });

  it('rejects manifest with empty parts (missing)', async () => {
    const json = await readFixtureJson('fixtures/manifest/missing/parts.json');
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
    // SPEC §11.2 lists "`size` or a coordinate that is not a triple" under
    // `wrong-arity`. The manifest reader used to report `invalid-value` here
    // while the geometry reader reported `wrong-arity` for `pivot.pos`.
    const r = parseManifest({
      name: 'test',
      parts: [{ name: 'body', rotation: [0, 45] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
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

// SPEC §6.9: the geometry list. A palette is NOT a manifest concern — it is
// declared by the geometry file that uses it (§7.4).
describe('parseManifest — geometry list', () => {
  const base = { name: 'test', parts: [{ name: 'body' }] };

  it('accepts a geometry list', () => {
    const r = parseManifest({
      ...base,
      geometry: ['body.json', 'gear/hat.json', '../shared/tail.json'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.geometry).toEqual([
      'body.json',
      'gear/hat.json',
      '../shared/tail.json',
    ]);
  });

  // v0.7 had a top-level `palette` that OVERRODE geometry files; v0.9
  // removed it for that precedence; §6.13 brings the field back scoped to
  // inline geometry only. So it parses again — and a v0.7 manifest, which
  // looks exactly like this one, is caught by W08 rather than by the
  // schema. See cross-file.test.ts.
  it('accepts a top-level palette (§6.13: the default for inline geometry)', () => {
    const r = parseManifest({ ...base, palette: 'palette.json' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.palette).toBe('palette.json');
  });

  it('accepts a top-level palette written out as colors', () => {
    const r = parseManifest({ ...base, palette: ['#FF0000', '#00FF00'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.palette).toEqual(['#FF0000', '#00FF00']);
  });

  it('manifestGeometry applies the ["voxels.json"] default', () => {
    const r = parseManifest(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.geometry).toBeUndefined();
    expect(manifestGeometry(r.value)).toEqual(['voxels.json']);
  });

  it('rejects a geometry entry with the wrong extension', () => {
    // Including the retired text extension, which is no longer geometry.
    for (const bad of ['body.txt', 'body.geometry']) {
      const r = parseManifest({ ...base, geometry: [bad] });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-value');
    }
  });

  it('rejects an absolute geometry path', () => {
    const r = parseManifest({ ...base, geometry: ['/etc/body.json'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects backslashes in a reference path', () => {
    const r = parseManifest({ ...base, geometry: ['gear\\hat.geometry'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects URL and namespace:key forms', () => {
    for (const bad of ['https://x.com/a.json', 'pack:body.json']) {
      const r = parseManifest({ ...base, geometry: [bad] });
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-value');
    }
  });

  it('rejects duplicate geometry entries', () => {
    const r = parseManifest({ ...base, geometry: ['a.json', 'a.json'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects an empty geometry list', () => {
    // §11.5 files "duplicate or empty `geometry` list" under `invalid-value`
    // — the two halves of one row, so they must answer alike. (§11.2 puts a
    // palette's 0-or-over-62 under `wrong-arity`; two arrays spelled the
    // same way, coded differently, and the spec is explicit about both.)
    const r = parseManifest({ ...base, geometry: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');

    const dup = parseManifest({ ...base, geometry: ['a.json', 'a.json'] });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('invalid-value');
  });

  it('rejects a bare extension as a path', () => {
    const r = parseManifest({ ...base, geometry: ['.json'] });
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

  it('still accepts a two-clip idle animation shape', () => {
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

// SPEC §6.12 — the manifest half of a published socket's contract. The
// geometry half (the part actually declares that socket) needs the geometry
// files and lives in cross-file.test.ts.
describe('parseManifest — published sockets (§6.12)', () => {
  it('parses the rigged corpus publications, including an aliased name', async () => {
    const json = await readFixtureJson(`${RIGGED}/cuboidy.json`);
    const r = parseManifest(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // `headwear` is deliberately NOT the socket's own name: publication is
    // an alias, so nothing may assume key === socket.
    expect(r.value.sockets).toEqual({
      headwear: { part: 'head', socket: 'hat' },
      mouth: { part: 'head', socket: 'mouth' },
    });
  });

  it('absent `sockets` means the model publishes none', async () => {
    const json = await readFixtureJson(`${SINGLE}/cuboidy.json`);
    const r = parseManifest(json);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sockets).toBeUndefined();
  });

  it('accepts one declared socket published under two names', () => {
    const r = parseManifest({
      name: 'm',
      parts: [{ name: 'body' }],
      sockets: {
        top: { part: 'body', socket: 'peg' },
        crown: { part: 'body', socket: 'peg' },
      },
    });
    expect(r.ok).toBe(true);
  });

  it('invalid-value: `part` names no part in this manifest', () => {
    const r = parseManifest({
      name: 'm',
      parts: [{ name: 'body' }],
      sockets: { weapon: { part: 'hand-r', socket: 'grip' } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Same code a dangling `parent` gets (§11.5) — it is the same kind of
      // failure, and both are decidable without reading a geometry file.
      expect(r.code).toBe('invalid-value');
      expect(r.message).toMatch(/published socket "weapon" names part "hand-r"/);
      expect(r.path).toEqual(['sockets', 'weapon', 'part']);
    }
  });

  it('unknown: an extra field inside a published socket', () => {
    const r = parseManifest({
      name: 'm',
      parts: [{ name: 'body' }],
      // Offsets are reserved (§14) — publication is pure aliasing today.
      sockets: { top: { part: 'body', socket: 'peg', offset: [0, 1, 0] } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown');
  });

  it('invalid-value: `part` / `socket` absent, or the published name is not an identifier', () => {
    for (const sockets of [
      { top: { part: 'body' } },
      { top: { socket: 'peg' } },
      { '1bad': { part: 'body', socket: 'peg' } },
    ]) {
      const r = parseManifest({ name: 'm', parts: [{ name: 'body' }], sockets });
      expect(r.ok).toBe(false);
    }
  });
});

// The manifest reader used to carry its own Zod→code mapping, which
// disagreed with the geometry reader's about four classes of mistake and, in
// the `missing` case, with its own message. Both now go through
// `resultFromZodError`, so these pin the §11.2 answers rather than whichever
// mapping a given reader happened to hold.
describe('parseManifest — §11.2 codes', () => {
  it('missing: an absent required field on a part, not just at the top level', () => {
    const r = parseManifest({ name: 'm', parts: [{}] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('missing');
      // The code and the message used to be computed from different
      // predicates, so this returned `invalid-value` alongside a message
      // that said the field was missing.
      expect(r.message).toBe('parts.0.name: required field is missing');
    }
  });

  it('missing: a part naming inline geometry with no `size`', () => {
    const r = parseManifest({
      name: 'm',
      parts: [{ name: 'body', geometry: { voxels: [['0']] } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing');
  });

  it('wrong-arity: an inline palette with 0 colors or more than 62', () => {
    const empty = parseManifest({ name: 'm', parts: [{ name: 'b' }], palette: [] });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe('wrong-arity');

    const tooMany = parseManifest({
      name: 'm',
      parts: [{ name: 'b' }],
      palette: Array.from({ length: 63 }, () => '#000000'),
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.code).toBe('wrong-arity');
  });

  it('wrong-arity: a position that is not a triple', () => {
    const r = parseManifest({
      name: 'm',
      parts: [{ name: 'b', position: [0, 0] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong-arity');
  });

  it('invalid-value: a palette entry that is not a color', () => {
    // The union picks the branch that failed INSIDE the value, so the
    // diagnosis stays as specific as it was before `palette` grew a
    // reference form — path and all.
    const r = parseManifest({
      name: 'm',
      parts: [{ name: 'b' }],
      palette: ['#000000', 1],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-value');
      expect(r.message).toMatch(/^palette\.1: /);
    }
  });
});

// SPEC §6.7 keyframe rules reached through the manifest's `animations`
// union. Every one of these used to collapse into
// `invalid-value: animations.<name>: Invalid input`, because only the
// geometry reader unwrapped unions.
describe('parseManifest — §6.7 through the animations union', () => {
  const withClip = (clip: unknown) => ({
    name: 'm',
    parts: [{ name: 'body' }],
    animations: { walk: clip },
  });
  const track = { body: { '0.0': { rot: [0, 0, 0] } } };

  it('accepts a well-formed inline clip', () => {
    const r = parseManifest(withClip({ duration: 1, loop: true, parts: track }));
    expect(r.ok).toBe(true);
  });

  it('unknown: an unrecognized keyframe field', () => {
    const r = parseManifest(
      withClip({
        duration: 1,
        loop: true,
        parts: { body: { '0.0': { zzz: 1 } } },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('unknown');
      expect(r.message).toMatch(/animations\.walk\.parts\.body/);
    }
  });

  it('unknown: an ease preset that is not a preset', () => {
    const r = parseManifest(
      withClip({
        duration: 1,
        loop: true,
        parts: { body: { '0.0': { rot: [0, 0, 0], ease: { rot: 'nope' } } } },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown');
  });

  it('unknown: an attribute the ease map does not carry', () => {
    const r = parseManifest(
      withClip({
        duration: 1,
        loop: true,
        parts: { body: { '0.0': { ease: { visible: 'linear' } } } },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown');
  });

  it('missing: an absent `loop`', () => {
    const r = parseManifest(withClip({ duration: 1, parts: track }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('missing');
      expect(r.message).toBe(
        'animations.walk.loop: required field is missing',
      );
    }
  });

  it('invalid-value: a reference that is not a legal §8 path', () => {
    const r = parseManifest(withClip('/abs/walk.json'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});

// SPEC §11.8: "a phase runs only if every earlier phase passed… Reporting a
// violation from a LATER phase than one that is also present is
// non-conforming." Inline geometry (§6.13) used to break this, because its
// cross-field checks ran as a refinement on the field itself — during the
// document's own structural parse — so a phase-3 problem on one part beat a
// phase-2 problem on the next.
describe('parseManifest — §11.8 phase precedence for inline geometry', () => {
  const badRowWidth = {
    name: 'a',
    geometry: { size: [2, 1, 1], voxels: [['0']] },
  };

  it('reports the phase-3 row width when it is the only problem', () => {
    const r = parseManifest({ name: 'm', parts: [badRowWidth] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('wrong-arity');
      expect(r.message).toMatch(/^parts\.0\.geometry\.voxels\.0\.0: /);
    }
  });

  it('phase 2 wins: a later part with no `name` outranks it', () => {
    const r = parseManifest({
      name: 'm',
      parts: [badRowWidth, { position: [0, 0, 0] }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing');
  });

  it('phase 2 wins: a later part with an unknown field outranks it', () => {
    const r = parseManifest({
      name: 'm',
      parts: [badRowWidth, { name: 'b', mystery: true }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown');
  });

  it('phase 2 wins: an inline part missing `size` outranks it', () => {
    const r = parseManifest({
      name: 'm',
      parts: [badRowWidth, { name: 'b', geometry: { voxels: [['0']] } }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing');
  });

  it('still reaches phase 3 for sockets and palette indices', () => {
    const dupSocket = parseManifest({
      name: 'm',
      parts: [
        {
          name: 'a',
          geometry: {
            size: [1, 1, 1],
            voxels: [['0']],
            sockets: [
              { name: 'g', pos: [0, 0, 0] },
              { name: 'g', pos: [1, 0, 0] },
            ],
          },
        },
      ],
    });
    expect(dupSocket.ok).toBe(false);
    if (!dupSocket.ok) expect(dupSocket.code).toBe('duplicate');

    const outOfRange = parseManifest({
      name: 'm',
      parts: [
        {
          name: 'a',
          geometry: {
            size: [1, 1, 1],
            voxels: [['5']],
            palette: ['#000000', '#FFFFFF'],
          },
        },
      ],
    });
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) expect(outOfRange.code).toBe('invalid-value');
  });

  it('an index against the manifest palette still defers to §11.6', () => {
    // §11.8 is explicit that this defers even though the colors are an
    // array in the same document.
    const r = parseManifest({
      name: 'm',
      palette: ['#000000', '#FFFFFF'],
      parts: [{ name: 'a', geometry: { size: [1, 1, 1], voxels: [['5']] } }],
    });
    expect(r.ok).toBe(true);
  });
});

// SPEC §6.6: the decimal point is required. Before it was, validity depended
// on the host language's object-key ordering — JavaScript hoists canonical
// integer keys, so a track written in order could be read back out of order.
describe('parseManifest — §6.6 time key grammar', () => {
  const withTrack = (track: unknown) => ({
    name: 'm',
    parts: [{ name: 'body' }],
    animations: {
      walk: { duration: 2, loop: true, parts: { body: track } },
    },
  });
  const key = { pos: [0, 0, 0] };

  it('accepts decimal keys in order', () => {
    const r = parseManifest(
      withTrack({ '0.0': key, '0.5': key, '1.0': key, '2.0': key }),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects the bare integer form', () => {
    const r = parseManifest(withTrack({ '0.0': key, '1': key }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-value');
      expect(r.message).toMatch(/the point is required/);
    }
  });

  it('rejects a track whose validity used to depend on key ordering', () => {
    // `JSON.parse` of this object yields ["1","0.0","0.5"] in JavaScript, so
    // the reference used to reject it as `first time key must be "0.0"`
    // while an order-preserving reader accepted it. Now both reject it, and
    // for the reason that is actually true of the document.
    const r = parseManifest(
      withTrack({ '0.0': key, '0.5': key, '1': key }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/the point is required/);
  });

  it('rejects an all-integer track that used to parse', () => {
    // Integer keys happened to sort correctly, so this was accepted.
    const r = parseManifest(withTrack({ '0': key, '1': key }));
    expect(r.ok).toBe(false);
  });

  it('rejects the spellings a number parser might otherwise take', () => {
    for (const bad of ['0x10', '0b11', '0o17', '1e3', '5.', '.5', '+1.0', ' 1.0', '-1.0']) {
      const r = parseManifest(withTrack({ '0.0': key, [bad]: key }));
      expect(r.ok, bad).toBe(false);
    }
  });
});

// A second review found four ways the unified mapping still disagreed with
// §11.2/§11.5, all of them in shapes no fixture reached.
describe('parseManifest — §11.2 corners the first pass missed', () => {
  const clip = (body: unknown) => ({
    name: 'm',
    parts: [{ name: 'a' }],
    animations: { walk: body },
  });
  const track = { a: { '0.0': { rot: [0, 0, 0] } } };

  it('invalid-value: a wrong-TYPE value in an enum slot, not unknown', () => {
    // Zod reports any enum miss as `invalid_value`. Only a STRING outside
    // the twenty is an unrecognized NAME (§11.2 `unknown`); a number is "a
    // value of the wrong JSON type for its field" (§11.2 `invalid-value`).
    for (const bad of [123, null, true, ['in-sine'], {}]) {
      const r = parseManifest(
        clip({
          duration: 1,
          loop: true,
          parts: { a: { '0.0': { rot: [0, 0, 0], ease: { rot: bad } } } },
        }),
      );
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.code, JSON.stringify(bad)).toBe('invalid-value');
    }
  });

  it('unknown: an extra key on an otherwise-complete inline clip', () => {
    // Every required field present, so the inline branch's only complaint
    // was `unrecognized_keys` at its own root — which the branch picker read
    // as "this branch rejected the value" and answered with the reference
    // branch's "expected string, received object".
    const r = parseManifest(
      clip({ duration: 1, loop: true, parts: track, speed: 2 }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('unknown');
      expect(r.message).toMatch(/speed/);
    }
  });

  it('still reports the reference form when the value is neither', () => {
    const r = parseManifest(clip(42));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });
});
