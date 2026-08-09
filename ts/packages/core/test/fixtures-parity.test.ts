import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseGeometry } from '../src/geometry/parse.js';
import { parseManifest } from '../src/manifest.js';
import { parsePaletteFile } from '../src/palette-file.js';
import type { Result } from '../src/result.js';
import { readFixtureJson } from './helpers/fixtures.js';

// This file lives at cuboidy/ts/packages/core/test/fixtures-parity.test.ts,
// so the repo root is 4 levels up.
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

/**
 * Fixtures are organised as `fixtures/<kind>/<code>/<name>.json`, where
 * `<code>` is the structural error code the reader must emit for every file
 * in that subdirectory. This is the cross-implementation parity contract.
 *
 * The kinds are DISCOVERED from the directory rather than listed here. A new
 * kind with no reader below is a failure, not a silent skip — the previous
 * version hardcoded `geometry` and `manifest`, so a `fixtures/palette/`
 * directory would have been carried in the corpus, implemented against by a
 * second implementation, and never checked here.
 */
const READERS: Record<string, (json: unknown) => Result<unknown>> = {
  geometry: parseGeometry,
  manifest: parseManifest,
  palette: parsePaletteFile,
};

async function kinds(): Promise<string[]> {
  const entries = await readdir(join(REPO_ROOT, 'fixtures'), {
    withFileTypes: true,
  });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

describe('fixtures parity', () => {
  it('every fixture kind has a reader', async () => {
    const found = await kinds();
    expect(found.length).toBeGreaterThan(0);
    for (const kind of found) {
      expect(
        READERS[kind],
        `fixtures/${kind}/ has no reader in fixtures-parity.test.ts`,
      ).toBeDefined();
    }
  });

  it('every fixtures/<kind>/<code>/ file reports that code', async () => {
    let checked = 0;
    for (const kind of await kinds()) {
      const parse = READERS[kind];
      if (parse === undefined) continue; // reported by the test above
      const root = join(REPO_ROOT, 'fixtures', kind);
      const codeDirs = await readdir(root);
      expect(codeDirs.length, `fixtures/${kind} is empty`).toBeGreaterThan(0);

      for (const code of codeDirs) {
        const files = await readdir(join(root, code));
        expect(
          files.length,
          `fixtures/${kind}/${code} is empty`,
        ).toBeGreaterThan(0);
        for (const file of files) {
          const json = await readFixtureJson(
            `fixtures/${kind}/${code}/${file}`,
          );
          const r = parse(json);
          expect(
            r.ok,
            `${kind}/${code}/${file} should fail but parsed OK`,
          ).toBe(false);
          if (!r.ok) {
            expect(
              r.code,
              `${kind}/${code}/${file}: expected ${code}, got ${r.code} (${r.message})`,
            ).toBe(code);
          }
          checked += 1;
        }
      }
    }
    // A guard against the whole corpus silently disappearing behind a bad
    // path — the loop above would pass vacuously.
    expect(checked).toBeGreaterThan(30);
  });

  // `fixtures/README.md`'s tree is the only place a fixture says what it is
  // FOR — JSON has no comments, and a second implementation reading
  // `manifest/invalid-value/geometry-list-empty.json` cannot tell from the
  // filename which of §11.5's rules it pins. One file was already missing
  // from that tree.
  it('every fixture appears in fixtures/README.md', async () => {
    const readme = await readFile(
      join(REPO_ROOT, 'fixtures', 'README.md'),
      'utf8',
    );
    const missing: string[] = [];
    for (const kind of await kinds()) {
      const root = join(REPO_ROOT, 'fixtures', kind);
      for (const code of await readdir(root)) {
        for (const file of await readdir(join(root, code))) {
          if (!readme.includes(file)) missing.push(`${kind}/${code}/${file}`);
        }
      }
    }
    expect(missing, 'fixtures with no line in fixtures/README.md').toEqual([]);
  });
});
