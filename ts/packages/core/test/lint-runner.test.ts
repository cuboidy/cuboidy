import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { formatDiagnostic, runLint } from '../src/cli/lint-runner.js';
import { geo } from './helpers/geometry.js';
import { readdirSync } from 'node:fs';
import { MIRRORED, MULTIFILE, RIGGED, SINGLE } from './helpers/corpus.js';

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

// The one-voxel geometry most of these cases just need something valid for.
// Omitting `colors` leaves the file palette-less, which is what the §6.10
// binding cases want.
const ONE_VOXEL = (name: string, colors?: string[]) =>
  geo([{ name, size: [1, 1, 1], voxels: [['0']] }], colors);

describe('runLint — corpus models lint clean', () => {
  it('a rigged model lints clean', async () => {
    const r = await runLint(resolve(REPO_ROOT, RIGGED));
    expect(r.diagnostics).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  it('a single-part model lints clean', async () => {
    const r = await runLint(resolve(REPO_ROOT, SINGLE));
    expect(r.diagnostics).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  it('a geometry list + shared palette lints clean under --strict', async () => {
    const r = await runLint(resolve(REPO_ROOT, MULTIFILE), { strict: true });
    expect(r.diagnostics).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  // The audit's D-2 false positive: both legs keep the same local pivot, so
  // the matching positions are -2 and 0 rather than sign-opposite, while the
  // assembled geometry IS symmetric. W06 is geometric precisely so the
  // recommended --strict workflow passes here. (Move leg-r to +2 and it
  // fires — the case is only interesting because it is sensitive.)
  it('a geometrically symmetric l/r pair passes --strict despite non-sign-opposite positions', async () => {
    const r = await runLint(resolve(REPO_ROOT, MIRRORED), { strict: true });
    expect(r.diagnostics.filter((d) => d.diag.severity !== 'hint')).toEqual([]);
    expect(r.exitCode).toBe(0);
  });
});

// The one thing still asserted about the shipped examples, and it is asserted
// by WALKING the directory rather than by naming models. The gallery exists to
// look good and is expected to be replaced wholesale; what must stay true is
// that whatever is in it is valid, since the README points readers at it and
// `cuboidy-lint --strict` is the workflow the docs recommend.
describe('runLint — every shipped example', () => {
  const modelDirs = readdirSync(resolve(REPO_ROOT, 'models'), {
    withFileTypes: true,
  })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it('the gallery is not empty', () => {
    expect(modelDirs.length).toBeGreaterThan(0);
  });

  it.each(modelDirs)('models/%s passes --strict', async (name) => {
    const r = await runLint(resolve(REPO_ROOT, 'models', name), {
      strict: true,
    });
    // Hints are advisory and allowed to differ per model; warnings and
    // errors are not.
    expect(
      r.diagnostics
        .filter((d) => d.diag.severity !== 'hint')
        .map((d) => formatDiagnostic(d)),
    ).toEqual([]);
    expect(r.exitCode).toBe(0);
  });
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
  const BODY = {
    name: 'body',
    size: [1, 1, 1] as [number, number, number],
    pivot: [0, 0, 0] as [number, number, number],
    voxels: [['0']],
  };
  // Both arms share a shape; only the pivot and the manifest positions vary
  // per case, which is exactly what W06 reasons about.
  const arms = (
    size: [number, number, number],
    pivot: [number, number, number],
    voxels: string[][],
  ) =>
    geo(
      [
        BODY,
        { name: 'arm-l', size, pivot, voxels },
        { name: 'arm-r', size, pivot, voxels },
      ],
      ['#F00'],
    );

  it('warns when an l/r pair is geometrically asymmetric', async () => {
    // Same voxels, same pivot, positions NOT mirrored → truly lopsided.
    const dir = await makeModel({
      'voxels.json': arms([2, 1, 1], [0, 0, 0], [['00']]),
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
      'voxels.json': arms([1, 2, 1], [0, 0, 0], [['0'], ['0']]),
      'cuboidy.json': manifest({
        'arm-l': [-1, 0, 0],
        'arm-r': [0, 0, 0],
      }),
    });
    const r = await runLint(dir, { strict: true });
    expect(r.diagnostics.filter((d) => d.diag.ruleId === 'W06')).toEqual([]);
  });

  it('warns when positions are sign-opposite but the voxels are not mirrored', async () => {
    // Asymmetric voxel pattern copied verbatim (not mirrored): the old
    // positions-only rule was blind to this.
    const dir = await makeModel({
      'voxels.json': arms([2, 1, 1], [1, 0, 0], [['0.']]),
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
  it('returns exit 2 when the geometry file is missing', async () => {
    const dir = await makeModel({}); // empty dir
    const r = await runLint(dir);
    expect(r.exitCode).toBe(2);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]?.diag.severity).toBe('error');
    expect(r.diagnostics[0]?.diag.message).toMatch(/voxels\.json/);
  });
});

describe('runLint — parse errors propagate as exit 1', () => {
  it('a malformed geometry file → error diag + exit 1', async () => {
    // Written verbatim rather than through geo(), which by construction can
    // only produce valid documents.
    const dir = await makeModel({
      'voxels.json': '{ "parts": [] }', // schema-invalid: needs at least one part
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    expect(r.diagnostics.some((d) => d.diag.severity === 'error')).toBe(true);
  });

  it('cuboidy.json with broken JSON → error + exit 1', async () => {
    const dir = await makeModel({
      'voxels.json': ONE_VOXEL('p', ['#F00']),
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
      'voxels.json': geo(
        [{ name: 'p', size: [1, 1, 1], pivot: [9, 0, 0], voxels: [['0']] }],
        ['#F00'],
      ),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(0); // warnings don't fail by default
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]?.diag.ruleId).toBe('W01');
    expect(r.diagnostics[0]?.diag.severity).toBe('warning');
  });

  it('--strict promotes warnings to exit 1', async () => {
    const dir = await makeModel({
      'voxels.json': geo(
        [{ name: 'p', size: [1, 1, 1], pivot: [9, 0, 0], voxels: [['0']] }],
        ['#F00'],
      ),
    });
    const r = await runLint(dir, { strict: true });
    expect(r.exitCode).toBe(1);
  });

  it('--strict does not escalate when only hints are present', async () => {
    // H01 (CamelCase name) is a hint, never an error even under --strict.
    const dir = await makeModel({
      'voxels.json': ONE_VOXEL('Bad', ['#F00']),
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
      'voxels.json': ONE_VOXEL('body', ['#F00']),
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

describe('runLint — project shape (geometry list + shared palette)', () => {
  const paletteJson = JSON.stringify({ colors: ['#F00', '#0F0'] });

  it('multi-file geometry sharing one palette file lints clean', async () => {
    const dir = await makeModel({
      // Both files point at the SAME palette and between them use both
      // colors. Neither is faulted for the one it does not use: W03 asks
      // about a declaration the file owns, and these files own neither.
      'body.json': geo(
        [{ name: 'body', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] }],
        'palette.json',
      ),
      'gear/hat.json': geo(
        [{ name: 'hat', size: [1, 1, 1], voxels: [['1']] }],
        'palette.json',
      ),
      'palette.json': paletteJson,
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.json', 'gear/hat.json'],
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
        geometry: ['nope.json'],
        parts: [{ name: 'body' }],
      }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    expect(
      r.diagnostics.some((d) => d.diag.message.includes('nope.json')),
    ).toBe(true);
  });

  it('W07: an unreferenced geometry file in the package warns', async () => {
    const dir = await makeModel({
      'voxels.json': ONE_VOXEL('body', ['#F00']),
      'scratch.json': ONE_VOXEL('junk', ['#F00']),
      'cuboidy.json': JSON.stringify({
        name: 'm',
        parts: [{ name: 'body' }],
      }),
    });
    const r = await runLint(dir);
    const w07 = r.diagnostics.find((d) => d.diag.ruleId === 'W07');
    expect(w07?.diag.message).toContain('scratch.json');
    expect(r.exitCode).toBe(0); // warning only
  });

  it('a broken palette file is an error and suppresses cross-file noise', async () => {
    const dir = await makeModel({
      'body.json': geo(
        [{ name: 'body', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] }],
        'palette.json',
      ),
      'palette.json': JSON.stringify({ colors: [] }),
      'cuboidy.json': JSON.stringify({
        name: 'm',
        geometry: ['body.json'],
        parts: [{ name: 'body' }],
      }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]?.diag.code).toBe('wrong-arity');
  });

  it('geometry using indices with no palette at all errors cross-file', async () => {
    const dir = await makeModel({
      'voxels.json': ONE_VOXEL('body'),
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

describe('runLint — external animations (SPEC §6.3 / §11.5)', () => {
  const GEO = ONE_VOXEL('body', ['#F00']);
  const manifestWith = (animations: unknown) =>
    JSON.stringify({ name: 'm', parts: [{ name: 'body' }], animations });

  it('a missing external animation file is an error (exit 1)', async () => {
    const dir = await makeModel({
      'voxels.json': GEO,
      'cuboidy.json': manifestWith({ walk: 'anims/missing.json' }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
    const diag = r.diagnostics.find((d) => d.diag.code === 'missing');
    expect(diag?.diag.message).toMatch(/anims\/missing\.json/);
  });

  it('an unparsable external animation file is an error', async () => {
    const dir = await makeModel({
      'voxels.json': GEO,
      'anims/walk.json': '{ broken',
      'cuboidy.json': manifestWith({ walk: 'anims/walk.json' }),
    });
    const r = await runLint(dir);
    expect(r.exitCode).toBe(1);
  });

  it('a schema-invalid external animation file is an error', async () => {
    const dir = await makeModel({
      'voxels.json': GEO,
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
      'voxels.json': GEO,
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
      'voxels.json': GEO,
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
      file: 'voxels.json',
      diag: {
        code: 'invalid-value',
        severity: 'warning',
        message: 'pivot [9, 0, 0] outside grid bounds',
        ruleId: 'W01',
      },
    });
    expect(line).toBe(
      'voxels.json: warning: pivot [9, 0, 0] outside grid bounds [W01]',
    );
  });

  it('falls back to structural code when no ruleId', () => {
    const line = formatDiagnostic({
      file: 'voxels.json',
      diag: {
        code: 'missing',
        severity: 'error',
        message: 'part p missing size',
      },
    });
    expect(line).toBe('voxels.json: error: part p missing size [missing]');
  });
});
