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
 * Fixtures are organised as `fixtures/{cvox,json}/<code>/<descriptor>.<ext>`,
 * where `<code>` is the structural error code the parser must emit for every
 * file in that subdirectory. This is the cross-implementation parity contract.
 */
describe('fixtures parity', () => {
  it('every cvox fixture under fixtures/cvox/<code>/ reports that code', async () => {
    const root = join(REPO_ROOT, 'fixtures/cvox');
    const codeDirs = await readdir(root);
    expect(codeDirs.length).toBeGreaterThan(0);

    for (const code of codeDirs) {
      const files = await readdir(join(root, code));
      for (const file of files) {
        const text = await readFixtureText(`fixtures/cvox/${code}/${file}`);
        const r = parseCvox(text);
        expect(r.ok, `${code}/${file} should fail but parsed OK`).toBe(false);
        if (!r.ok) {
          expect(
            r.code,
            `${code}/${file}: expected ${code}, got ${r.code} (${r.message})`,
          ).toBe(code);
        }
      }
    }
  });

  it('every json fixture under fixtures/json/<code>/ reports that code', async () => {
    const root = join(REPO_ROOT, 'fixtures/json');
    const codeDirs = await readdir(root);
    expect(codeDirs.length).toBeGreaterThan(0);

    for (const code of codeDirs) {
      const files = await readdir(join(root, code));
      for (const file of files) {
        const json = await readFixtureJson(`fixtures/json/${code}/${file}`);
        const r = parseManifest(json);
        expect(r.ok, `${code}/${file} should fail but parsed OK`).toBe(false);
        if (!r.ok) {
          expect(
            r.code,
            `${code}/${file}: expected ${code}, got ${r.code} (${r.message})`,
          ).toBe(code);
        }
      }
    }
  });
});
