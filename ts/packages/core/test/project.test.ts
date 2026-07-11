import { describe, expect, it } from 'vitest';
import { parseCvox } from '../src/cvox/parse.js';
import { serializeCvox } from '../src/cvox/serialize.js';
import { parseManifest } from '../src/manifest.js';
import type { Manifest } from '../src/manifest.js';
import {
  normalizeRefPath,
  projectFilePaths,
  refreshProjectReuse,
  resolveCrossFileReuse,
  resolveProject,
  type GeometryFile,
} from '../src/project.js';
import type { Cvox } from '../src/cvox/types.js';

// SPEC §6.9 / §6.10: the shared project-resolution layer — geometry list,
// palette binding, and model-wide clone/mirror resolution.

const PAL = 'palette #FF0000 #00FF00 #0000FF';

function parseOk(text: string, defer = false): Cvox {
  const r = parseCvox(text, { deferUnresolvedReuse: defer });
  if (!r.ok) throw new Error(`parse failed: ${r.code}: ${r.message}`);
  return r.value;
}

function geo(path: string, text: string): GeometryFile {
  return { path, cvox: parseOk(text, true) };
}

function manifest(json: object): Manifest {
  const r = parseManifest(json);
  if (!r.ok) throw new Error(`manifest failed: ${r.message}`);
  return r.value;
}

describe('parseCvox — deferUnresolvedReuse', () => {
  it('records an unresolved referent as pending instead of erroring', () => {
    const cvox = parseOk(
      `${PAL}\npart a\n    size 1 1 1\n    voxels { 0 }\npart b clone ext`,
      true,
    );
    expect(cvox.parts.map((p) => p.name)).toEqual(['a']);
    expect(cvox.pending).toEqual([
      { name: 'b', from: { part: 'ext' }, index: 1 },
    ]);
  });

  it('still resolves same-file referents (no pending)', () => {
    const cvox = parseOk(
      `${PAL}\npart a\n    size 1 1 1\n    voxels { 0 }\npart b clone a`,
      true,
    );
    expect(cvox.parts.map((p) => p.name)).toEqual(['a', 'b']);
    expect(cvox.pending).toBeUndefined();
  });

  it('still rejects same-file chains', () => {
    const r = parseCvox(
      `${PAL}\npart a\n    size 1 1 1\n    voxels { 0 }\npart b clone a\npart c clone b`,
      { deferUnresolvedReuse: true },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('default mode still errors on an unknown referent', () => {
    const r = parseCvox(
      `${PAL}\npart a\n    size 1 1 1\n    voxels { 0 }\npart b clone ext`,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('missing');
  });

  it('records declaration positions counting pendings and concrete parts', () => {
    const cvox = parseOk(
      `${PAL}\npart r1 clone ext1\npart a\n    size 1 1 1\n    voxels { 0 }\npart r2 clone ext2`,
      true,
    );
    expect(cvox.parts.map((p) => p.name)).toEqual(['a']);
    expect(cvox.pending?.map((p) => [p.name, p.index])).toEqual([
      ['r1', 0],
      ['r2', 2],
    ]);
  });
});

describe('serializeCvox — pending round-trip', () => {
  it('re-emits pending reuse parts at their declaration positions', () => {
    const src = `${PAL}

part r1 clone ext1

part a
    size 1 1 1
    voxels {
        0
    }

part r2 mirror ext2 z
`;
    const cvox = parseOk(src, true);
    expect(serializeCvox(cvox)).toBe(src);
  });
});

describe('resolveCrossFileReuse', () => {
  const BODY = `${PAL}\npart arm\n    size 2 1 1\n    pivot 0 0 0\n    voxels { 01 }`;

  it('resolves a clone whose referent lives in another file', () => {
    const r = resolveCrossFileReuse([
      geo('body.cvox', BODY),
      geo('arms.cvox', 'part arm_l clone arm'),
    ]);
    expect(r.diagnostics).toEqual([]);
    const arms = r.geometries[1]!.cvox;
    expect(arms.pending).toBeUndefined();
    const armL = arms.parts.find((p) => p.name === 'arm_l')!;
    expect(armL.from).toEqual({ part: 'arm' });
    expect(armL.voxels).toEqual(r.geometries[0]!.cvox.parts[0]!.voxels);
    expect(r.reuseOrigins.get('arm_l')).toBe('body.cvox');
  });

  it('resolves a mirror across files (reflection applied)', () => {
    const r = resolveCrossFileReuse([
      geo('body.cvox', BODY),
      geo('arms.cvox', 'part arm_r mirror arm'),
    ]);
    expect(r.diagnostics).toEqual([]);
    const armR = r.geometries[1]!.cvox.parts[0]!;
    expect(armR.voxels[0]![0]).toEqual([1, 0]);
    expect(armR.pivot.pos).toEqual({ x: 2, y: 0, z: 0 });
  });

  it('splices resolved parts back at their declaration positions', () => {
    const r = resolveCrossFileReuse([
      geo('body.cvox', BODY),
      geo(
        'more.cvox',
        `part r1 clone arm\npart own\n    size 1 1 1\n    voxels { . }\npart r2 clone arm`,
      ),
    ]);
    expect(r.diagnostics).toEqual([]);
    expect(r.geometries[1]!.cvox.parts.map((p) => p.name)).toEqual([
      'r1',
      'own',
      'r2',
    ]);
  });

  it('unknown referent → missing, file passed through unchanged', () => {
    const input = [
      geo('body.cvox', BODY),
      geo('arms.cvox', 'part arm_l clone nope'),
    ];
    const r = resolveCrossFileReuse(input);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]!.file).toBe('arms.cvox');
    expect(r.diagnostics[0]!.diag.code).toBe('missing');
    expect(r.diagnostics[0]!.diag.message).toMatch(/unknown part "nope"/);
    // Unchanged: pending intact so the file still serializes.
    expect(r.geometries[1]!.cvox.pending).toHaveLength(1);
  });

  it('referent that is itself a (resolved) reuse part → invalid-value', () => {
    const r = resolveCrossFileReuse([
      geo('body.cvox', `${BODY}\npart arm2 clone arm`),
      geo('arms.cvox', 'part arm_l clone arm2'),
    ]);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]!.diag.code).toBe('invalid-value');
    expect(r.diagnostics[0]!.diag.message).toMatch(/reuse chains/);
  });

  it('referent that is itself pending → invalid-value (chain)', () => {
    const r = resolveCrossFileReuse([
      geo('body.cvox', BODY),
      geo('a.cvox', 'part x clone y'),
      geo('b.cvox', 'part y clone arm'),
    ]);
    const chain = r.diagnostics.find((d) => d.file === 'a.cvox');
    expect(chain?.diag.code).toBe('invalid-value');
  });

  it('referent defined in more than one file → duplicate', () => {
    const r = resolveCrossFileReuse([
      geo('one.cvox', BODY),
      geo('two.cvox', BODY),
      geo('arms.cvox', 'part arm_l clone arm'),
    ]);
    const dup = r.diagnostics.find((d) => d.file === 'arms.cvox');
    expect(dup?.diag.code).toBe('duplicate');
    expect(dup?.diag.message).toMatch(/one\.cvox, two\.cvox/);
  });
});

describe('refreshProjectReuse', () => {
  const BODY = `${PAL}\npart arm\n    size 2 1 1\n    pivot 0 0 0\n    voxels { 01 }`;

  it('re-derives a cross-file mirror when the referent changed', () => {
    const first = resolveCrossFileReuse([
      geo('body.cvox', BODY),
      geo('arms.cvox', 'part arm_r mirror arm'),
    ]);
    // Simulate editing arm's voxels in body.cvox (reparse of that file).
    const editedBody = geo(
      'body.cvox',
      `${PAL}\npart arm\n    size 2 1 1\n    pivot 0 0 0\n    voxels { 21 }`,
    );
    const r = refreshProjectReuse([editedBody, first.geometries[1]!]);
    expect(r.diagnostics).toEqual([]);
    const armR = r.geometries[1]!.cvox.parts[0]!;
    expect(armR.voxels[0]![0]).toEqual([1, 2]); // mirrored fresh data
  });

  it('keeps object identity for files whose derivations are unchanged', () => {
    const first = resolveCrossFileReuse([
      geo('body.cvox', BODY),
      geo('arms.cvox', 'part arm_r mirror arm'),
    ]);
    const r = refreshProjectReuse(first.geometries);
    expect(r.geometries[1]).toBe(first.geometries[1]);
  });

  it('keeps the last derived geometry when the referent disappears', () => {
    const first = resolveCrossFileReuse([
      geo('body.cvox', BODY),
      geo('arms.cvox', 'part arm_r mirror arm'),
    ]);
    // body.cvox re-parsed without the arm part.
    const gutted = geo(
      'body.cvox',
      `${PAL}\npart torso\n    size 1 1 1\n    voxels { 0 }`,
    );
    const r = refreshProjectReuse([gutted, first.geometries[1]!]);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]!.diag.code).toBe('missing');
    const armR = r.geometries[1]!.cvox.parts[0]!;
    expect(armR.name).toBe('arm_r'); // still present, stale geometry
    expect(armR.voxels[0]![0]).toEqual([1, 0]);
  });

  it('resolves a pending once its referent appears', () => {
    const broken = resolveCrossFileReuse([
      geo('arms.cvox', 'part arm_r mirror arm'),
    ]);
    expect(broken.diagnostics).toHaveLength(1);
    const r = refreshProjectReuse([
      geo('body.cvox', BODY),
      broken.geometries[0]!,
    ]);
    expect(r.diagnostics).toEqual([]);
    expect(r.geometries[1]!.cvox.parts.map((p) => p.name)).toEqual(['arm_r']);
    expect(r.geometries[1]!.cvox.pending).toBeUndefined();
  });
});

describe('projectFilePaths', () => {
  it('applies the voxels.cvox default without a manifest', () => {
    expect(projectFilePaths(null)).toEqual({ geometry: ['voxels.cvox'] });
  });

  it('normalizes geometry and palette refs', () => {
    const m = manifest({
      name: 'm',
      geometry: ['./body.cvox', 'gear/./hat.cvox'],
      palette: './palette.json',
      parts: [{ name: 'body' }],
    });
    expect(projectFilePaths(m)).toEqual({
      geometry: ['body.cvox', 'gear/hat.cvox'],
      palette: 'palette.json',
    });
  });
});

describe('resolveProject', () => {
  const MANIFEST = manifest({
    name: 'm',
    geometry: ['body.cvox', 'arms.cvox'],
    palette: 'palette.json',
    parts: [{ name: 'arm' }, { name: 'arm_l', parent: 'arm' }],
  });
  const BODY = 'part arm\n    size 2 1 1\n    voxels { 01 }';

  it('loads geometry + palette and resolves cross-file reuse', () => {
    const r = resolveProject(
      MANIFEST,
      new Map([
        ['body.cvox', BODY],
        ['arms.cvox', 'part arm_l clone arm'],
        ['palette.json', '{ "colors": ["#FF0000", "#00FF00"] }'],
      ]),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.complete).toBe(true);
    expect(r.geometries.map((g) => g.path)).toEqual(['body.cvox', 'arms.cvox']);
    expect(r.geometries[1]!.cvox.parts[0]!.name).toBe('arm_l');
    expect(r.externalPalette).toHaveLength(2);
  });

  it('reports a missing geometry file and marks the project incomplete', () => {
    const r = resolveProject(MANIFEST, new Map([['body.cvox', BODY]]));
    expect(r.complete).toBe(false);
    const missing = r.diagnostics.filter((d) => d.diag.code === 'missing');
    expect(missing.map((d) => d.file)).toEqual(['arms.cvox', 'palette.json']);
  });

  it('reports a palette JSON error', () => {
    const r = resolveProject(
      MANIFEST,
      new Map([
        ['body.cvox', BODY],
        ['arms.cvox', 'part arm_l clone arm'],
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
    expect(normalizeRefPath('./a.cvox')).toBe('a.cvox');
    expect(normalizeRefPath('a//b.cvox')).toBe('a/b.cvox');
    expect(normalizeRefPath('a/./b.cvox')).toBe('a/b.cvox');
    expect(normalizeRefPath('a/../b.cvox')).toBe('b.cvox');
  });

  it('preserves leading .. (outside the package)', () => {
    expect(normalizeRefPath('../shared/p.json')).toBe('../shared/p.json');
  });
});
