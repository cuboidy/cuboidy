import { describe, expect, it } from 'vitest';
import { parseManifest, type Manifest } from '../src/manifest.js';
import { geometryPaths, resolveProject } from '../src/project.js';
import { validateProject } from '../src/lint/cross-file.js';
import { INLINE } from './helpers/corpus.js';
import { readFixtureJson } from './helpers/fixtures.js';
import { geo } from './helpers/geometry.js';

// SPEC §6.13 — the three ways a part finds its shape, and what each does
// about colors. This is the join every consumer used to do for itself by
// matching part names across geometry files.

function manifest(json: object): Manifest {
  const r = parseManifest(json);
  if (!r.ok) throw new Error(`manifest failed: ${r.message}`);
  return r.value;
}

const RED = '#FF0000';
const GREEN = '#00FF00';
const cell = (name: string, palette?: string[] | string) =>
  geo([{ name, size: [1, 1, 1], voxels: [['0']] }], palette);

describe('resolvePartGeometry — binding (§6.13)', () => {
  it('binds a part with no `geometry` by name, the pre-§6.13 rule', () => {
    const m = manifest({ name: 'm', parts: [{ name: 'body' }] });
    const r = resolveProject(m, new Map([['voxels.json', cell('body', [RED])]]));
    expect(r.diagnostics).toEqual([]);
    expect(r.parts.get('body')?.source).toEqual({ file: 'voxels.json', part: 'body' });
    expect(r.parts.get('body')?.palette).toHaveLength(1);
  });

  it('binds `geometry.path`, defaulting `part` to the enclosing name', () => {
    const m = manifest({
      name: 'm',
      parts: [{ name: 'body', geometry: { path: 'shapes.json' } }],
    });
    const r = resolveProject(m, new Map([['shapes.json', cell('body', [RED])]]));
    expect(r.unresolved).toEqual([]);
    expect(r.parts.get('body')?.source).toEqual({ file: 'shapes.json', part: 'body' });
  });

  it('an explicit `part` binds one shape under a different rig name', () => {
    const m = manifest({
      name: 'm',
      parts: [{ name: 'cap', geometry: { path: 'caps.json', part: 'beret' } }],
    });
    const r = resolveProject(m, new Map([['caps.json', cell('beret', [RED])]]));
    expect(r.unresolved).toEqual([]);
    // The rig knows it as `cap`, so everything downstream — animation
    // binding (§6.8), the transform tree — sees the MANIFEST's name…
    expect(r.parts.get('cap')?.part.name).toBe('cap');
    // …while `source` keeps the name it has in the file, which is how a
    // consumer says WHICH definition this came from.
    expect(r.parts.get('cap')?.source).toEqual({ file: 'caps.json', part: 'beret' });
  });

  it('one file part can back two rig parts', () => {
    const m = manifest({
      name: 'm',
      parts: [
        { name: 'wheel-l', geometry: { path: 'w.json', part: 'wheel' } },
        { name: 'wheel-r', geometry: { path: 'w.json', part: 'wheel' } },
      ],
    });
    const r = resolveProject(m, new Map([['w.json', cell('wheel', [RED])]]));
    expect(r.unresolved).toEqual([]);
    expect([...r.parts.keys()]).toEqual(['wheel-l', 'wheel-r']);
  });

  it('a shape used by TWO rig parts is not reported as unused', () => {
    // The consumed-definition check keyed itself by the RIG's name, so a
    // shape reached through `geometry.part` looked untouched — and this
    // model, where one shape backs two parts, was told the shape nothing
    // uses is the one used twice.
    const m = manifest({
      name: 'cart',
      geometry: ['w.json'],
      parts: [
        { name: 'wheel-l', geometry: { path: 'w.json', part: 'wheel' } },
        { name: 'wheel-r', geometry: { path: 'w.json', part: 'wheel' } },
      ],
    });
    const r = resolveProject(m, new Map([['w.json', cell('wheel', [RED])]]));
    expect(
      validateProject({
        manifest: m,
        geometries: r.geometries,
        parts: r.parts,
        unresolved: r.unresolved,
      }),
    ).toEqual([]);
  });

  it('binds inline geometry, with the §7.7 default pivot applied', () => {
    const m = manifest({
      name: 'm',
      palette: [RED, GREEN],
      parts: [{ name: 'body', geometry: { size: [1, 1, 1], voxels: [['1']] } }],
    });
    const r = resolveProject(m, new Map());
    expect(r.diagnostics).toEqual([]);
    const body = r.parts.get('body');
    expect(body?.source).toBeNull();
    expect(body?.part.name).toBe('body');
    // The same doc→AST mapping a file's part goes through, so nothing
    // downstream can tell where the shape was written.
    expect(body?.part.pivot.pos).toEqual({ x: 0.5, y: 0, z: 0.5 });
  });
});

describe('resolvePartGeometry — palette scoping (§6.13)', () => {
  it('an inline part with no palette of its own takes the manifest one', () => {
    const m = manifest({
      name: 'm',
      palette: [RED, GREEN],
      parts: [{ name: 'body', geometry: { size: [1, 1, 1], voxels: [['1']] } }],
    });
    expect(resolveProject(m, new Map()).parts.get('body')?.palette).toHaveLength(2);
  });

  it("an inline part's own palette wins", () => {
    const m = manifest({
      name: 'm',
      palette: [RED, GREEN],
      parts: [
        {
          name: 'body',
          geometry: { palette: [RED], size: [1, 1, 1], voxels: [['0']] },
        },
      ],
    });
    expect(resolveProject(m, new Map()).parts.get('body')?.palette).toHaveLength(1);
  });

  it('the manifest palette does NOT reach a part that lives in a file', () => {
    // The v0.7 mistake, and the rule that keeps it from returning: a
    // geometry file means the same thing to whoever loads it (§7.4).
    const m = manifest({
      name: 'm',
      palette: [RED, RED],
      parts: [{ name: 'body', geometry: { path: 'shapes.json' } }],
    });
    const r = resolveProject(m, new Map([['shapes.json', cell('body', [GREEN])]]));
    expect(r.parts.get('body')?.palette).toHaveLength(1);
    expect(r.parts.get('body')?.palette[0]?.color).toMatchObject({ r: 0, g: 255, b: 0 });
  });

  it('resolves a manifest palette written as a §8 reference', () => {
    const m = manifest({
      name: 'm',
      palette: 'shared.json',
      parts: [{ name: 'body', geometry: { size: [1, 1, 1], voxels: [['1']] } }],
    });
    const r = resolveProject(
      m,
      new Map([['shared.json', '{"colors":["#FF0000","#00FF00"]}']]),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.parts.get('body')?.palette).toHaveLength(2);
  });
});

describe('resolvePartGeometry — failures (§11.6)', () => {
  it('distinguishes the by-name miss from the explicit-ref miss', () => {
    const m = manifest({
      name: 'm',
      geometry: ['shapes.json'],
      parts: [
        { name: 'ghost' },
        { name: 'cap', geometry: { path: 'shapes.json', part: 'beret' } },
      ],
    });
    const r = resolveProject(m, new Map([['shapes.json', cell('body', [RED])]]));
    expect(r.parts.size).toBe(0);
    expect(r.unresolved.map((u) => u.name)).toEqual(['ghost', 'cap']);
    expect(r.unresolved[0]!.message).toMatch(/defined in no geometry file/);
    // The explicit form can name the file the author actually pointed at,
    // which the name search never could.
    expect(r.unresolved[1]!.message).toMatch(/'beret' in shapes\.json/);
  });

  it('an unreadable `geometry.path` is reported once, not twice', () => {
    const m = manifest({
      name: 'm',
      parts: [{ name: 'body', geometry: { path: 'gone.json' } }],
    });
    const r = resolveProject(m, new Map());
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]!.diag.message).toMatch(/cannot read gone\.json/);
    // No second complaint about the part: the missing file is the whole
    // story, and resolveProject's diagnostics gate cross-file validation.
    expect(r.unresolved).toEqual([]);
  });

  it('an unresolved part does NOT make the project incomplete', () => {
    // If it did, one misnamed part would switch off every §11.6 rule for
    // the model — lint only runs cross-file validation on a complete
    // project. A part that cannot be found is a fault in the model, not
    // in loading it.
    const m = manifest({ name: 'm', parts: [{ name: 'ghost' }] });
    const r = resolveProject(m, new Map([['voxels.json', cell('body', [RED])]]));
    expect(r.complete).toBe(true);
    expect(r.unresolved).toHaveLength(1);
  });
});

describe('the single-file corpus model (§3, §6.13)', () => {
  it('resolves completely from cuboidy.json alone, with NO other file', () => {
    // The literal claim §3 makes about the one-text-file form. The empty
    // file map is the assertion: nothing beside the manifest is consulted,
    // so anything this model needs it carries.
    return readFixtureJson(`${INLINE}/cuboidy.json`).then((json) => {
      const m = manifest(json as object);
      const r = resolveProject(m, new Map());
      expect(r.diagnostics).toEqual([]);
      expect(r.unresolved).toEqual([]);
      expect(r.geometries).toEqual([]);
      expect([...r.parts.keys()]).toEqual(['body', 'head']);
      expect(r.parts.get('head')?.source).toBeNull();
      expect(
        validateProject({
          manifest: m,
          geometries: r.geometries,
          parts: r.parts,
          unresolved: r.unresolved,
        }),
      ).toEqual([]);
    });
  });
});

describe('geometryPaths (§6.9 + §6.13)', () => {
  it('does not demand voxels.json from an all-inline model', () => {
    // The single-file form (§3) depends entirely on this: the default
    // would otherwise make every one-file model report a missing file.
    const m = manifest({
      name: 'm',
      parts: [{ name: 'body', geometry: { size: [1, 1, 1], voxels: [['.']] } }],
    });
    expect(geometryPaths(m)).toEqual([]);
    expect(resolveProject(m, new Map()).diagnostics).toEqual([]);
  });

  it('still applies the default when some part needs the name lookup', () => {
    const m = manifest({
      name: 'm',
      parts: [
        { name: 'body', geometry: { size: [1, 1, 1], voxels: [['.']] } },
        { name: 'head' },
      ],
    });
    expect(geometryPaths(m)).toEqual(['voxels.json']);
  });

  it('collects part-level paths, normalized and deduped, beside the list', () => {
    const m = manifest({
      name: 'm',
      geometry: ['a.json'],
      parts: [
        { name: 'p1', geometry: { path: 'b.json' } },
        { name: 'p2', geometry: { path: './b.json' } },
      ],
    });
    expect(geometryPaths(m)).toEqual(['a.json', 'b.json']);
  });

  it('reads an explicitly written list even when nothing resolves to it', () => {
    // Deliberate: a stale entry then surfaces as the §11.6 `unknown`
    // warning instead of being dropped in silence.
    const m = manifest({
      name: 'm',
      geometry: ['stale.json'],
      parts: [{ name: 'body', geometry: { size: [1, 1, 1], voxels: [['.']] } }],
    });
    expect(geometryPaths(m)).toEqual(['stale.json']);
  });
});
