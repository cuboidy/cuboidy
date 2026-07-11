import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { formatDiagnostic, runLint } from '../src/cli/lint-runner.js';

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

// Build a throw-away model dir under the OS temp directory. Each test
// gets its own dir so concurrent test runs don't collide.
async function makeModel(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-lint-test-'));
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }
  return dir;
}

describe('runLint — fixture parity (exit 0)', () => {
  it('wolf model lints clean', async () => {
    const r = await runLint(resolve(REPO_ROOT, 'models/wolf'));
    expect(r.diagnostics).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  it('crown model lints clean', async () => {
    const r = await runLint(resolve(REPO_ROOT, 'models/crown'));
    expect(r.diagnostics).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  it('robo-mini model (geometry list + palette binding + cross-file mirror) lints clean', async () => {
    const r = await runLint(resolve(REPO_ROOT, 'models/robo-mini'), {
      strict: true,
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  // The audit's D-2 false positives: mirrored pivots make the matching
  // positions non-sign-opposite, but the GEOMETRY is symmetric — the
  // recommended `--strict` workflow must pass (W06 is geometric now).
  it.each(['boy-mini', 'girl-mini'])(
    '%s passes --strict (W06 checks geometry, not raw positions)',
    async (model) => {
      const r = await runLint(resolve(REPO_ROOT, `models/${model}`), {
        strict: true,
      });
      expect(
        r.diagnostics.filter((d) => d.diag.severity !== 'hint'),
      ).toEqual([]);
      expect(r.exitCode).toBe(0);
    },
  );
});

describe('runLint — W06 mirror symmetry (geometric)', () => {
  const manifest = (positions: Record<string, [number, number, number]>) =>
    JSON.stringify({
      name: 'm',
      parts: [
        { name: 'body' },
        { name: 'arm-l', parent: 'body', position: positions['arm-l'] },
        { name: 'arm-r', parent: 'body', position: positions['arm-r'] },
      ],
    });
  const BODY = 'part body\nsize 1 1 1\npivot 0 0 0\nvoxels { 0 }';

  it('warns when an l/r pair is geometrically asymmetric', async () => {
    // Same voxels, same pivot, positions NOT mirrored → truly lopsided.
    const dir = await makeModel({
      'voxels.cvox': [
        'palette #F00',
        BODY,
        'part arm-l\nsize 2 1 1\npivot 0 0 0\nvoxels { 00 }',
        'part arm-r\nsize 2 1 1\npivot 0 0 0\nvoxels { 00 }',
      ].join('\n'),
      'cuboidy.json': manifest({
        'arm-l': [-2, 0, 0],
        'arm-r': [1, 0, 0], // mirrored would be [0, 0, 0] here
      }),
    });
    const r = await runLint(dir, { strict: true });
    const w06 = r.diagnostics.find((d) => d.diag.ruleId === 'W06');
    expect(w06?.diag.message).toMatch(/mirror-symmetric/);
    expect(r.exitCode).toBe(1);
  });

  it('stays quiet for a symmetric pair whose positions are not sign-opposite', async () => {
    // The audit's boy-mini/girl-mini shape: 1-wide legs straddling the
    // parent plane at x = −1 and x = 0. The old positions-only rule
    // (−1 ≠ −0) flagged this even though the geometry is symmetric.
    const dir = await makeModel({
      'voxels.cvox': [
        'palette #F00',
        BODY,
        'part arm-l\nsize 1 2 1\npivot 0 0 0\nvoxels { 0 , 0 }',
        'part arm-r clone arm-l',
      ].join('\n'),
      'cuboidy.json': manifest({
        'arm-l': [-1, 0, 0],
        'arm-r': [0, 0, 0],
      }),
    });
    const r = await runLint(dir, { strict: true });
    expect(r.diagnostics.filter((d) => d.diag.ruleId === 'W06')).toEqual([]);
  });

  it('warns when positions are sign-opposite but the voxels are not mirrored', async () => {
    // Asymmetric voxel pattern cloned (not mirrored): the old
    // positions-only rule was blind to this.
    const dir = await makeModel({
      'voxels.cvox': [
        'palette #F00',
        BODY,
        'part arm-l\nsize 2 1 1\npivot 1 0 0\nvoxels { 0. }',
        'part arm-r clone arm-l',
      ].join('\n'),
      'cuboidy.json': manifest({
        'arm-l': [-2, 0, 0],
        'arm-r': [2, 0, 0],
      }),
    });
    const r = await runLint(dir, { strict: true });
    const w06 = r.diagnostics.find((d) => d.diag.ruleId === 'W06');
    expect(w06).toBeDefined();
  });
});

describe('runLint — IO failures', () => {
  it('returns exit 2 when voxels.cvox is missing', async () => {
    const dir = await makeModel({}); // empty dir
    const r = await runLint(dir);
    expect(r.exitCode).toBe(2);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]?.diag.severity).toBe('error');
    expect(r.diagnostics[0]?.diag.message).toMatch(/voxels\.cvox/);
  });
});

describe('runLint — parse errors propagate as exit 1', () => {
  it('voxels.cvox parse error → error diag + exit 1', async () => {
    const dir = await makeModel({
      'voxels.cvox': 'palette\n', // palette needs at least one color
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    expect(r.diagnostics.some((d) => d.diag.severity === 'error')).toBe(true);
  });

  it('cuboidy.json with broken JSON → error + exit 1', async () => {
    const dir = await makeModel({
      'voxels.cvox': 'palette #F00\npart p\nsize 1 1 1\nvoxels { 0 }',
      'cuboidy.json': '{ broken',
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    const jsonErr = r.diagnostics.find((d) =>
      d.diag.message.startsWith('JSON parse:'),
    );
    expect(jsonErr).toBeDefined();
  });
});

describe('runLint — voxel lint diagnostics', () => {
  it('emits W01 warning for out-of-bounds pivot, exit 0 by default', async () => {
    const dir = await makeModel({
      'voxels.cvox':
        'palette #F00\npart p\nsize 1 1 1\npivot 9 0 0\nvoxels { 0 }',
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(0); // warnings don't fail by default
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]?.diag.ruleId).toBe('W01');
    expect(r.diagnostics[0]?.diag.severity).toBe('warning');
  });

  it('--strict promotes warnings to exit 1', async () => {
    const dir = await makeModel({
      'voxels.cvox':
        'palette #F00\npart p\nsize 1 1 1\npivot 9 0 0\nvoxels { 0 }',
    });
    const r = await runLint(dir, { strict: true });
    expect(r.exitCode).toBe(1);
  });

  it('--strict does not escalate when only hints are present', async () => {
    // H01 (CamelCase name) is a hint, never an error even under --strict.
    const dir = await makeModel({
      'voxels.cvox': 'palette #F00\npart Bad\nsize 1 1 1\nvoxels { 0 }',
    });
    const r = await runLint(dir, { strict: true });
    expect(r.exitCode).toBe(0);
    expect(r.diagnostics[0]?.diag.ruleId).toBe('H01');
    expect(r.diagnostics[0]?.diag.severity).toBe('hint');
  });
});

describe('runLint — cross-file diagnostics', () => {
  it('reports cross-file missing part as error + exit 1', async () => {
    const dir = await makeModel({
      'voxels.cvox': 'palette #F00\npart body\nsize 1 1 1\nvoxels { 0 }',
      'cuboidy.json': JSON.stringify({
        name: 'm',
        parts: [{ name: 'body' }, { name: 'ghost' }],
      }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    const xfile = r.diagnostics.find((d) => d.file === '<cross-file>');
    expect(xfile?.diag.code).toBe('missing');
  });
});

describe('runLint — v0.7 project shape (geometry list + palette binding)', () => {
  const paletteJson = JSON.stringify({ colors: ['#F00', '#0F0'] });

  it('multi-cvox model with a bound palette lints clean', async () => {
    const dir = await makeModel({
      'body.cvox': 'part body\nsize 1 1 1\nvoxels { 0 }',
      'gear/hat.cvox': 'part hat\nsize 1 1 1\nvoxels { 1 }',
      'palette.json': paletteJson,
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.cvox', 'gear/hat.cvox'],
        palette: 'palette.json',
        parts: [{ name: 'body' }, { name: 'hat', parent: 'body' }],
      }),
    });
    const r = await runLint(dir);
    expect(r.diagnostics).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  it('a geometry ref that cannot be read is a model error (exit 1)', async () => {
    const dir = await makeModel({
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['nope.cvox'],
        parts: [{ name: 'body' }],
      }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    expect(
      r.diagnostics.some((d) => d.diag.message.includes('nope.cvox')),
    ).toBe(true);
  });

  it('W07: an unreferenced .cvox in the package warns', async () => {
    const dir = await makeModel({
      'voxels.cvox': 'palette #F00\npart body\nsize 1 1 1\nvoxels { 0 }',
      'scratch.cvox': 'palette #F00\npart junk\nsize 1 1 1\nvoxels { 0 }',
      'cuboidy.json': JSON.stringify({
        name: 'm',
        parts: [{ name: 'body' }],
      }),
    });
    const r = await runLint(dir);
    const w07 = r.diagnostics.find((d) => d.diag.ruleId === 'W07');
    expect(w07?.diag.message).toContain('scratch.cvox');
    expect(r.exitCode).toBe(0); // warning only
  });

  it('a broken palette file is an error and suppresses cross-file noise', async () => {
    const dir = await makeModel({
      'body.cvox': 'part body\nsize 1 1 1\nvoxels { 0 }',
      'palette.json': JSON.stringify({ colors: [] }),
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.cvox'],
        palette: 'palette.json',
        parts: [{ name: 'body' }],
      }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]?.diag.code).toBe('wrong-arity');
  });

  it('palette-less geometry without a binding errors cross-file', async () => {
    const dir = await makeModel({
      'voxels.cvox': 'part body\nsize 1 1 1\nvoxels { 0 }',
      'cuboidy.json': JSON.stringify({
        name: 'm',
        parts: [{ name: 'body' }],
      }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    const xfile = r.diagnostics.find((d) => d.file === '<cross-file>');
    expect(xfile?.diag.code).toBe('missing');
    expect(xfile?.diag.message).toContain('no palette');
  });
});

describe('runLint — cross-file clone/mirror (SPEC §6.9)', () => {
  const paletteJson = JSON.stringify({ colors: ['#F00', '#0F0'] });

  it('a clone whose referent lives in another geometry file lints clean', async () => {
    const dir = await makeModel({
      'body.cvox': 'part arm\nsize 2 1 1\nvoxels { 01 }',
      'arms.cvox': 'part arm_l clone arm',
      'palette.json': paletteJson,
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.cvox', 'arms.cvox'],
        palette: 'palette.json',
        parts: [{ name: 'arm' }, { name: 'arm_l', parent: 'arm' }],
      }),
    });
    const r = await runLint(dir);
    expect(r.diagnostics).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  it('a referent missing model-wide is an error (exit 1)', async () => {
    const dir = await makeModel({
      'body.cvox': 'part arm\nsize 2 1 1\nvoxels { 01 }',
      'arms.cvox': 'part arm_l clone nope',
      'palette.json': paletteJson,
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.cvox', 'arms.cvox'],
        palette: 'palette.json',
        parts: [{ name: 'arm' }, { name: 'arm_l', parent: 'arm' }],
      }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    const diag = r.diagnostics.find((d) => d.diag.code === 'missing');
    expect(diag?.diag.message).toMatch(/unknown part "nope"/);
    expect(diag?.file).toMatch(/arms\.cvox$/);
  });

  it('a cross-file chain is invalid-value (exit 1)', async () => {
    const dir = await makeModel({
      'body.cvox': 'part arm\nsize 2 1 1\nvoxels { 01 }\npart arm2 clone arm',
      'arms.cvox': 'part arm_l clone arm2',
      'palette.json': paletteJson,
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.cvox', 'arms.cvox'],
        palette: 'palette.json',
        parts: [
          { name: 'arm' },
          { name: 'arm2', parent: 'arm' },
          { name: 'arm_l', parent: 'arm' },
        ],
      }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    const diag = r.diagnostics.find((d) => d.diag.code === 'invalid-value');
    expect(diag?.diag.message).toMatch(/reuse chains/);
  });
});

describe('runLint — external animations (SPEC §6.3 / §11.5)', () => {
  const GEO = 'palette #F00\npart body\nsize 1 1 1\nvoxels { 0 }';
  const manifestWith = (animations: unknown) =>
    JSON.stringify({ name: 'm', parts: [{ name: 'body' }], animations });

  it('a missing external animation file is an error (exit 1)', async () => {
    const dir = await makeModel({
      'voxels.cvox': GEO,
      'cuboidy.json': manifestWith({ walk: 'anims/missing.json' }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    const diag = r.diagnostics.find((d) => d.diag.code === 'missing');
    expect(diag?.diag.message).toMatch(/anims\/missing\.json/);
  });

  it('an unparsable external animation file is an error', async () => {
    const dir = await makeModel({
      'voxels.cvox': GEO,
      'anims/walk.json': '{ broken',
      'cuboidy.json': manifestWith({ walk: 'anims/walk.json' }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
  });

  it('a schema-invalid external animation file is an error', async () => {
    const dir = await makeModel({
      'voxels.cvox': GEO,
      'anims/walk.json': JSON.stringify({
        duration: 1,
        loop: true,
        parts: { body: { '0.5': { rot: [0, 0, 0] } } }, // not starting at 0.0
      }),
      'cuboidy.json': manifestWith({ walk: 'anims/walk.json' }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    expect(
      r.diagnostics.some((d) => d.diag.message.includes('first time key')),
    ).toBe(true);
  });

  it('a valid external animation lints clean', async () => {
    const dir = await makeModel({
      'voxels.cvox': GEO,
      'anims/walk.json': JSON.stringify({
        duration: 1,
        loop: true,
        parts: { body: { '0.0': { rot: [0, 0, 0] }, '1.0': { rot: [0, 5, 0] } } },
      }),
      'cuboidy.json': manifestWith({ walk: 'anims/walk.json' }),
    });
    const r = await runLint(dir);
    expect(r.diagnostics).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  it('warns when an animation targets a part missing from the manifest', async () => {
    const dir = await makeModel({
      'voxels.cvox': GEO,
      'cuboidy.json': manifestWith({
        walk: {
          duration: 1,
          loop: true,
          parts: { ghost: { '0.0': { rot: [0, 0, 0] } } },
        },
      }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(0); // warning only
    const warn = r.diagnostics.find(
      (d) => d.diag.severity === 'warning' && d.diag.code === 'unknown',
    );
    expect(warn?.diag.message).toMatch(/animation 'walk' targets part 'ghost'/);
  });
});

describe('formatDiagnostic — SPEC §11.7 format', () => {
  it('uses ruleId in brackets when present', () => {
    const line = formatDiagnostic({
      file: 'voxels.cvox',
      diag: {
        code: 'invalid-value',
        severity: 'warning',
        message: 'pivot [9, 0, 0] outside grid bounds',
        ruleId: 'W01',
      },
    });
    expect(line).toBe(
      'voxels.cvox: warning: pivot [9, 0, 0] outside grid bounds [W01]',
    );
  });

  it('falls back to structural code when no ruleId', () => {
    const line = formatDiagnostic({
      file: 'voxels.cvox',
      diag: {
        code: 'missing',
        severity: 'error',
        message: 'part p missing size',
      },
    });
    expect(line).toBe('voxels.cvox: error: part p missing size [missing]');
  });
});
