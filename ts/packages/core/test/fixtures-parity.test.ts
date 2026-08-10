import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseGeometry } from '../src/geometry/parse.js';
import { parseManifest } from '../src/manifest.js';
import { parsePaletteFile } from '../src/palette-file.js';
import { resolveProject } from '../src/project.js';
import { lintProject } from '../src/lint/project-lint.js';
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
 *
 * `project` is the one kind whose fixtures are PACKAGES rather than
 * documents: §11.6 is about a manifest and the files it references together,
 * so a single document cannot express it. Each is a directory holding a
 * `cuboidy.json` and whatever it names. §11.6 was the only part of the port
 * scope with no shared fixture at all, which is how the two implementations
 * came to be pointed at different answers for it in prose.
 */
type KindCheck =
  | { shape: 'document'; parse: (json: unknown) => Result<unknown> }
  | { shape: 'package' };

const KINDS: Record<string, KindCheck> = {
  geometry: { shape: 'document', parse: parseGeometry },
  manifest: { shape: 'document', parse: parseManifest },
  palette: { shape: 'document', parse: parsePaletteFile },
  project: { shape: 'package' },
};

async function kinds(): Promise<string[]> {
  const entries = await readdir(join(REPO_ROOT, 'fixtures'), {
    withFileTypes: true,
  });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// A package fixture is checked TWICE, because §11.6 splits in two and the
// halves land on different sides of the port's scope line.
//
//   resolution — `resolved` must be false. This is the half a runtime has,
//   the half `docs/csharp-implementation.md` puts in scope, and the half a
//   C# port must reproduce.
//
//   reporting — some cross-file finding must carry the code the directory
//   names. This is `lint/`, which the port drops; a C# library with no lint
//   is conforming without it.
//
// Checking only the second would have let a port pass §11.6 by doing nothing,
// since it is not required to lint. Checking only the first would not pin the
// code, and §11.2 is compared by code.
async function checkPackageFixture(
  kind: string,
  code: string,
  name: string,
): Promise<void> {
  const dir = join(REPO_ROOT, 'fixtures', kind, code, name);
  const where = `${kind}/${code}/${name}`;
  const files = new Map<string, string>();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    files.set(entry.name, await readFile(join(dir, entry.name), 'utf8'));
  }
  const manifestText = files.get('cuboidy.json');
  expect(manifestText, `${where} has no cuboidy.json`).toBeDefined();

  const m = parseManifest(JSON.parse(manifestText!));
  expect(m.ok, `${where}: the manifest itself must parse`).toBe(true);
  if (!m.ok) return;

  const project = resolveProject(m.value, files);
  expect(project.resolved, `${where} should NOT resolve, but did`).toBe(false);

  const findings = lintProject({
    manifest: m.value,
    geometries: project.geometries,
    parts: project.parts,
    unresolved: project.unresolved,
    duplicates: project.duplicates,
    externalAnims: project.externalAnims,
    packageGeometryPaths: [...files.keys()].filter((f) => f !== 'cuboidy.json'),
    complete: project.complete,
  });
  const codes = findings.map((f) => f.diag.code);
  expect(
    codes,
    `${where}: expected a ${code} finding, got ${codes.join(', ') || '(none)'}`,
  ).toContain(code);
}

describe('fixtures parity', () => {
  it('every fixture kind has a reader', async () => {
    const found = await kinds();
    expect(found.length).toBeGreaterThan(0);
    for (const kind of found) {
      expect(
        KINDS[kind],
        `fixtures/${kind}/ has no reader in fixtures-parity.test.ts`,
      ).toBeDefined();
    }
  });

  it('every fixtures/<kind>/<code>/ file reports that code', async () => {
    let checked = 0;
    for (const kind of await kinds()) {
      const check = KINDS[kind];
      if (check === undefined) continue; // reported by the test above
      const root = join(REPO_ROOT, 'fixtures', kind);
      const codeDirs = await readdir(root);
      expect(codeDirs.length, `fixtures/${kind} is empty`).toBeGreaterThan(0);

      for (const code of codeDirs) {
        const entries = await readdir(join(root, code));
        expect(
          entries.length,
          `fixtures/${kind}/${code} is empty`,
        ).toBeGreaterThan(0);
        for (const entry of entries) {
          if (check.shape === 'package') {
            await checkPackageFixture(kind, code, entry);
          } else {
            const json = await readFixtureJson(
              `fixtures/${kind}/${code}/${entry}`,
            );
            const r = check.parse(json);
            expect(
              r.ok,
              `${kind}/${code}/${entry} should fail but parsed OK`,
            ).toBe(false);
            if (!r.ok) {
              expect(
                r.code,
                `${kind}/${code}/${entry}: expected ${code}, got ${r.code} (${r.message})`,
              ).toBe(code);
            }
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
