import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/manifest.js';
import type { Manifest } from '../src/manifest.js';
import {
  normalizeRefPath,
  projectFilePaths,
  resolveProject,
} from '../src/project.js';
import { geo } from './helpers/geometry.js';

// SPEC §6.9 / §7.4: the shared project-resolution layer — geometry list
// and per-file palette references.

function manifest(json: object): Manifest {
  const r = parseManifest(json);
  if (!r.ok) throw new Error(`manifest failed: ${r.message}`);
  return r.value;
}

describe('projectFilePaths', () => {
  it('applies the voxels.json default without a manifest', () => {
    expect(projectFilePaths(null)).toEqual({
      geometry: ['voxels.json'],
      animations: [],
    });
  });

  it('normalizes geometry and animation refs', () => {
    const m = manifest({
      name: 'm',
      geometry: ['./body.json', 'gear/./hat.json'],
      parts: [{ name: 'body' }],
      animations: { walk: './anims/walk.json' },
    });
    expect(projectFilePaths(m)).toEqual({
      geometry: ['body.json', 'gear/hat.json'],
      animations: ['anims/walk.json'],
    });
  });
});

describe('resolveProject', () => {
  const MANIFEST = manifest({
    name: 'm',
    geometry: ['body.json', 'arms.json'],
    parts: [{ name: 'arm' }, { name: 'arm_l', parent: 'arm' }],
  });
  // resolveProject is handed file *contents*, so these must be the JSON the
  // loader will actually read.
  // Both files point at ONE shared palette file (§7.4 reference form).
  const BODY = geo([{ name: 'arm', size: [2, 1, 1], voxels: [['01']] }], 'palette.json');
  const ARMS = geo([{ name: 'arm_l', size: [2, 1, 1], voxels: [['10']] }], 'palette.json');

  it('loads geometry files in list order and resolves their palette', () => {
    const r = resolveProject(
      MANIFEST,
      new Map([
        ['body.json', BODY],
        ['arms.json', ARMS],
        ['palette.json', '{ "colors": ["#FF0000", "#00FF00"] }'],
      ]),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.geometries.map((g) => g.path)).toEqual(['body.json', 'arms.json']);
    expect(r.geometries[1]!.geometry.parts[0]!.name).toBe('arm_l');
    // The reference is resolved IN PLACE, once per file, and the ref is kept
    // so a re-serialize keeps pointing at the shared file.
    for (const g of r.geometries) {
      expect(g.geometry.palette).toHaveLength(2);
      expect(g.geometry.paletteRef).toBe('palette.json');
    }
  });

  it('reports a missing geometry file and marks the project incomplete', () => {
    const r = resolveProject(MANIFEST, new Map([['body.json', BODY]]));
    expect(r.complete).toBe(false);
    const missing = r.diagnostics.filter((d) => d.diag.code === 'missing');
    expect(missing.map((d) => d.file)).toEqual(['arms.json', 'palette.json']);
  });

  it('reports a palette JSON error', () => {
    const r = resolveProject(
      MANIFEST,
      new Map([
        ['body.json', BODY],
        ['arms.json', ARMS],
        ['palette.json', '{ broken'],
      ]),
    );
    expect(r.complete).toBe(false);
    const pal = r.diagnostics.find((d) => d.file === 'palette.json');
    expect(pal?.diag.message).toMatch(/^JSON parse:/);
  });
});

describe('normalizeRefPath', () => {
  it('resolves ./ and // segments', () => {
    expect(normalizeRefPath('./a.json')).toBe('a.json');
    expect(normalizeRefPath('a//b.json')).toBe('a/b.json');
    expect(normalizeRefPath('a/./b.json')).toBe('a/b.json');
    expect(normalizeRefPath('a/../b.json')).toBe('b.json');
  });

  it('preserves leading .. (outside the package)', () => {
    expect(normalizeRefPath('../shared/p.json')).toBe('../shared/p.json');
  });
});

// SPEC §11.6 / §11.8 phase 4: "the same part name defined in more than one
// file of the `geometry` list". Reported here rather than by lint, because
// what it breaks is the by-`name` lookup — a runtime with no lint (the C#
// port) would otherwise bind the name to whichever file it saw first, which
// is a choice about collection ordering rather than about the model.
describe('resolveProject — ambiguous part names (§11.6)', () => {
  const twoFiles = (extra: object = {}) => ({
    name: 't',
    geometry: ['a.json', 'b.json'],
    parts: [{ name: 'body' }],
    ...extra,
  });
  const one = (name: string) => geo([{ name, size: [1, 1, 1], voxels: [['0']] }]);
  const body = one('body');

  it('hands the ambiguity to §11.6 rather than gating it off', () => {
    const p = resolveProject(
      manifest(twoFiles()),
      new Map([
        ['a.json', body],
        ['b.json', body],
      ]),
    );
    expect(p.duplicates).toEqual([
      { name: 'body', files: ['a.json', 'b.json'] },
    ]);
    // Deliberately NOT a resolution diagnostic. Setting `complete: false`
    // would gate cross-file validation off, so one ambiguous name would
    // hide every other §11.6 finding for the model — including ones about
    // unrelated files. Resolution's part is the refusal to bind, below.
    expect(p.diagnostics).toEqual([]);
    expect(p.complete).toBe(true);
  });

  it('binds the ambiguous name to nothing at all', () => {
    // Reporting the ambiguity while still returning the first file's part
    // would leave exactly the non-determinism the refusal exists to remove:
    // "first" is a fact about the loader's collections, and JS Maps preserve
    // insertion order where C#'s Dictionary does not.
    const p = resolveProject(
      manifest(twoFiles()),
      new Map([
        ['a.json', body],
        ['b.json', body],
      ]),
    );
    expect(p.parts.has('body')).toBe(false);
    expect(p.unresolved.map((u) => u.name)).toEqual(['body']);
    expect(p.unresolved[0]?.message).toContain('more than one geometry file');
  });

  it('does not depend on which file is listed first', () => {
    const flipped = resolveProject(
      manifest({
        name: 't',
        geometry: ['b.json', 'a.json'],
        parts: [{ name: 'body' }],
      }),
      new Map([
        ['a.json', body],
        ['b.json', body],
      ]),
    );
    expect(flipped.parts.has('body')).toBe(false);
  });

  it('resolves cleanly when the name is defined once', () => {
    const p = resolveProject(
      manifest(twoFiles()),
      new Map([
        ['a.json', body],
        ['b.json', one('tail')],
      ]),
    );
    expect(p.complete).toBe(true);
    expect(p.parts.get('body')?.source?.file).toBe('a.json');
  });

  it('a file reached only by geometry.path does not take part', () => {
    // §11.6 says so explicitly, and the by-name lookup must agree: the
    // `path` form binds by path, so its own part names are its business.
    const p = resolveProject(
      manifest({
        name: 't',
        geometry: ['a.json'],
        parts: [
          { name: 'body' },
          { name: 'clone', geometry: { path: 'b.json', part: 'body' } },
        ],
      }),
      new Map([
        ['a.json', body],
        ['b.json', body],
      ]),
    );
    expect(p.complete).toBe(true);
    expect(p.parts.get('body')?.source?.file).toBe('a.json');
    expect(p.parts.get('clone')?.source?.file).toBe('b.json');
  });
});

// SPEC §6.3: an animation written as a string is a reference to a file, and
// `resolveProject` reads it. Every branch of that — the file missing, its
// JSON unparseable, its contents failing §6.4 — was reachable only through
// `cli/lint-runner.ts`, `cli/assemble.ts` or the editor, all of which a
// second implementation drops. The diagnostic-code convergence in particular
// (an absent `loop` reports `missing`, not `invalid-value`) was pinned by
// nothing the port can run.
describe('resolveProject — external animations (§6.3)', () => {
  const BODY = geo(
    [{ name: 'body', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] }],
    ['#FF0000'],
  );
  const withClip = (ref: string) =>
    manifest({
      name: 'm',
      geometry: ['a.json'],
      parts: [{ name: 'body' }],
      animations: { walk: ref },
    });
  const files = (extra: Record<string, string>) =>
    new Map([['a.json', BODY], ...Object.entries(extra)]);

  it('loads a clip written in its own file', () => {
    const p = resolveProject(
      withClip('anims/walk.json'),
      files({
        'anims/walk.json': JSON.stringify({
          duration: 1,
          loop: true,
          parts: { body: { '0.0': { rot: [0, 0, 0] } } },
        }),
      }),
    );
    expect(p.diagnostics).toEqual([]);
    expect(p.complete).toBe(true);
    expect(p.externalAnims.get('walk')?.path).toBe('anims/walk.json');
    expect(p.externalAnims.get('walk')?.anim.duration).toBe(1);
  });

  it('reports a clip whose file is not there', () => {
    const p = resolveProject(withClip('anims/walk.json'), files({}));
    expect(p.complete).toBe(false);
    expect(p.diagnostics[0]?.file).toBe('anims/walk.json');
    expect(p.diagnostics[0]?.diag.code).toBe('missing');
  });

  it('reports a clip whose file is not JSON', () => {
    const p = resolveProject(
      withClip('anims/walk.json'),
      files({ 'anims/walk.json': '{ nope }' }),
    );
    expect(p.complete).toBe(false);
    expect(p.diagnostics[0]?.file).toBe('anims/walk.json');
    expect(p.diagnostics[0]?.diag.message).toMatch(/JSON/i);
  });

  // The convergence: the same mistake in the same clip must report the same
  // code whether the author wrote it inline or in a file. It reported
  // `invalid-value` for everything from a file until the readers were unified.
  it('gives an external clip the same codes an inline one gets', () => {
    const cases: [string, object, string][] = [
      ['no loop', { duration: 1, parts: {} }, 'missing'],
      [
        'bad ease preset',
        {
          duration: 1,
          loop: true,
          parts: { body: { '0.0': { rot: [0, 0, 0], ease: { rot: 'nope' } } } },
        },
        'unknown',
      ],
      [
        'unknown keyframe field',
        { duration: 1, loop: true, parts: { body: { '0.0': { spin: 1 } } } },
        'unknown',
      ],
      [
        'time key without its point',
        { duration: 1, loop: true, parts: { body: { '0': { rot: [0, 0, 0] } } } },
        'invalid-value',
      ],
      [
        'track keyed by a non-identifier',
        { duration: 1, loop: true, parts: { '1bad': { '0.0': {} } } },
        'invalid-value',
      ],
    ];
    for (const [label, clip, code] of cases) {
      const external = resolveProject(
        withClip('anims/walk.json'),
        files({ 'anims/walk.json': JSON.stringify(clip) }),
      );
      expect(external.complete, label).toBe(false);
      expect(external.diagnostics[0]?.diag.code, `external: ${label}`).toBe(code);

      const inline = parseManifest({
        name: 'm',
        geometry: ['a.json'],
        parts: [{ name: 'body' }],
        animations: { walk: clip },
      });
      expect(inline.ok, `inline: ${label}`).toBe(false);
      if (!inline.ok) expect(inline.code, `inline: ${label}`).toBe(code);
    }
  });
});

// The flag a runtime reads. `complete` answers "did reading the package go
// fine"; `resolved` answers "is the model whole" — and only the second is
// what §11.6 requires an implementation without lint to refuse without.
describe('resolveProject — resolved vs complete', () => {
  const BODY = geo(
    [{ name: 'body', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] }],
    ['#FF0000'],
  );

  it('is true for a model that loads and binds every part', () => {
    const p = resolveProject(
      manifest({ name: 'm', geometry: ['a.json'], parts: [{ name: 'body' }] }),
      new Map([['a.json', BODY]]),
    );
    expect(p.complete).toBe(true);
    expect(p.resolved).toBe(true);
  });

  it('is false for a part no listed file defines, where complete stays true', () => {
    const p = resolveProject(
      manifest({
        name: 'm',
        geometry: ['a.json'],
        parts: [{ name: 'body' }, { name: 'ghost' }],
      }),
      new Map([['a.json', BODY]]),
    );
    // Reading went fine — cross-file lint must still run and report it.
    expect(p.complete).toBe(true);
    expect(p.resolved).toBe(false);
    expect(p.unresolved.map((u) => u.name)).toEqual(['ghost']);
  });

  it('is false for a name two listed files define (§11.6)', () => {
    const other = geo(
      [{ name: 'body', size: [2, 1, 1], pivot: [0, 0, 0], voxels: [['00']] }],
      ['#00FF00'],
    );
    const p = resolveProject(
      manifest({
        name: 'm',
        geometry: ['a.json', 'b.json'],
        parts: [{ name: 'body' }],
      }),
      new Map([
        ['a.json', BODY],
        ['b.json', other],
      ]),
    );
    expect(p.complete).toBe(true);
    expect(p.resolved).toBe(false);
    // And the part binds to NEITHER shape, which is the rule itself.
    expect(p.parts.has('body')).toBe(false);
    expect(p.duplicates.map((d) => d.name)).toEqual(['body']);
  });

  it('is false whenever complete is', () => {
    const p = resolveProject(
      manifest({ name: 'm', geometry: ['a.json'], parts: [{ name: 'body' }] }),
      new Map(),
    );
    expect(p.complete).toBe(false);
    expect(p.resolved).toBe(false);
  });
});
