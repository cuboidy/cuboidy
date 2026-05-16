import { describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseCvox } from '../src/cvox/parse.js';
import { parseManifest } from '../src/manifest.js';
import { readFixtureJson, readFixtureText } from './helpers/fixtures.js';

// This file lives at cuboidy/ts/packages/core/test/fixtures-parity.test.ts,
// so the repo root is 4 levels up.
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

/**
 * For every fixture file under `fixtures/cvox/` and `fixtures/json/`, the
 * implementation must report the diagnostic code encoded in the filename
 * (e.g. `E08-row-width.cvox` must yield code `E08`). This is the parity
 * contract for cross-language implementations.
 */
describe('fixtures parity', () => {
  it('every cvox fixture reports the expected error code', async () => {
    const dir = join(REPO_ROOT, 'fixtures/cvox');
    const files = await readdir(dir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const expected = file.split('-')[0]!;
      const text = await readFixtureText(`fixtures/cvox/${file}`);
      const r = parseCvox(text);
      expect(r.ok, `${file} should fail but parsed OK`).toBe(false);
      if (!r.ok) {
        expect(
          r.code,
          `${file}: expected ${expected}, got ${r.code} (${r.message})`,
        ).toBe(expected);
      }
    }
  });

  it('every json fixture reports the expected error code', async () => {
    const dir = join(REPO_ROOT, 'fixtures/json');
    const files = await readdir(dir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const expected = file.split('-')[0]!;
      const json = await readFixtureJson(`fixtures/json/${file}`);
      const r = parseManifest(json);
      expect(r.ok, `${file} should fail but parsed OK`).toBe(false);
      if (!r.ok) {
        expect(
          r.code,
          `${file}: expected ${expected}, got ${r.code} (${r.message})`,
        ).toBe(expected);
      }
    }
  });
});
