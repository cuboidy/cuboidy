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
    const r = await runLint(resolve(REPO_ROOT, 'wolf'));
    expect(r.diagnostics).toEqual([]);
    expect(r.exitCode).toBe(0);
  });

  it('crown model lints clean', async () => {
    const r = await runLint(resolve(REPO_ROOT, 'crown'));
    expect(r.diagnostics).toEqual([]);
    expect(r.exitCode).toBe(0);
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
