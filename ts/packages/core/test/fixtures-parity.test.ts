import { describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseGeometry } from '../src/geometry/parse.js';
import { parseManifest } from '../src/manifest.js';
import { readFixtureJson } from './helpers/fixtures.js';

// This file lives at cuboidy/ts/packages/core/test/fixtures-parity.test.ts,
// so the repo root is 4 levels up.
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

/**
 * Fixtures are organised as `fixtures/{geometry,manifest}/<code>/<name>.json`,
 * where `<code>` is the structural error code the reader must emit for every
 * file in that subdirectory. This is the cross-implementation parity contract.
 */
describe('fixtures parity', () => {
  it.each([
    ['geometry', parseGeometry],
    ['manifest', parseManifest],
  ])('every fixtures/%s/<code>/ file reports that code', async (kind, parse) => {
    const root = join(REPO_ROOT, `fixtures/${kind}`);
    const codeDirs = await readdir(root);
    expect(codeDirs.length).toBeGreaterThan(0);

    for (const code of codeDirs) {
      const files = await readdir(join(root, code));
      expect(files.length, `fixtures/${kind}/${code} is empty`).toBeGreaterThan(0);
      for (const file of files) {
        const json = await readFixtureJson(`fixtures/${kind}/${code}/${file}`);
        const r = parse(json);
        expect(r.ok, `${kind}/${code}/${file} should fail but parsed OK`).toBe(
          false,
        );
        if (!r.ok) {
          expect(
            r.code,
            `${kind}/${code}/${file}: expected ${code}, got ${r.code} (${r.message})`,
          ).toBe(code);
        }
      }
    }
  });
});
