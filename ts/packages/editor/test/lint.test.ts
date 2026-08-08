import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGeometryText, parseManifest, type Geometry, type Manifest } from '@cuboidy/core';
import { resolveProjectRefs } from '../src/lib/load-model.js';
import { CROSS_FILE, lintSource } from '../src/lib/lint.js';
import type { LoadedSource } from '../src/lib/types.js';

// The editor now runs core's lint over whatever is on screen. What these
// tests are really guarding is that it agrees with `cuboidy-lint` — the
// editor skipping a rule, or inventing one, would put the authoring
// surface and the CI gate at odds about whether a package is valid.

const MANIFEST = 'cuboidy.json';

function geom(text: string): Geometry {
  const r = parseGeometryText(text);
  if (!r.ok) throw new Error(`fixture geometry: ${r.message}`);
  return r.value;
}

function manifestOf(text: string): Manifest {
  const r = parseManifest(JSON.parse(text));
  if (!r.ok) throw new Error(`fixture manifest: ${r.message}`);
  return r.value;
}

/** One 2x1x1 part, optionally with an explicit pivot. */
const GEO = (
  parts: Array<{ name: string; pivot?: number[]; voxels?: string }>,
  palette: string[] | string = ['#FF0000'],
): string =>
  JSON.stringify({
    version: '0.9',
    palette,
    parts: parts.map((p) => ({
      name: p.name,
      size: [(p.voxels ?? '00').length, 1, 1],
      ...(p.pivot !== undefined && { pivot: { pos: p.pivot } }),
      voxels: [[p.voxels ?? '00']],
    })),
  });

function pkg(files: Record<string, string>, primary = 'voxels.json'): LoadedSource {
  const manifestText = files[MANIFEST];
  const manifest = manifestText !== undefined ? manifestOf(manifestText) : undefined;
  const primaryText = files[primary];
  if (primaryText === undefined) throw new Error(`fixture has no ${primary}`);
  const refs = resolveProjectRefs(manifest, new Map(Object.entries(files)), {
    path: primary,
    geometry: geom(primaryText),
  });
  const geometries = new Map(refs.geometries);
  if (!geometries.has(primary)) geometries.set(primary, geom(primaryText));
  return {
    folderName: 'pkg',
    files: new Map(Object.entries(files)),
    primaryPath: primary,
    manifestPath: MANIFEST,
    ...(manifest !== undefined && { manifest }),
    geometries,
    parts: refs.parts,
    ...(refs.externalAnims !== undefined && { externalAnims: refs.externalAnims }),
    // The real loader carries these, and lintSource gates cross-file rules
    // on them being empty. A helper that dropped them would test a state
    // the editor never actually reaches.
    ...(refs.projectErrors.length > 0 && { projectErrors: refs.projectErrors }),
  };
}

const ids = (src: LoadedSource) =>
  lintSource(src).map((d) => d.diag.ruleId ?? d.diag.code);

describe('lintSource', () => {
  it('reports nothing for a clean package', () => {
    const src = pkg({
      [MANIFEST]: JSON.stringify({ name: 'm', parts: [{ name: 'body' }] }),
      'voxels.json': GEO([{ name: 'body' }]),
    });
    expect(lintSource(src)).toEqual([]);
  });

  it('reports per-file voxel rules against the file they came from', () => {
    // Pivot far outside the 2x1x1 grid → W01, and a second palette entry
    // nothing uses → W03.
    const src = pkg({
      [MANIFEST]: JSON.stringify({ name: 'm', parts: [{ name: 'body' }] }),
      'voxels.json': GEO([{ name: 'body', pivot: [9, 0, 0] }], ['#FF0000', '#00FF00']),
    });
    const found = lintSource(src);
    expect(found.map((f) => f.diag.ruleId).sort()).toEqual(['W01', 'W03']);
    // Attributed to the file, not to the project.
    expect(new Set(found.map((f) => f.file))).toEqual(new Set(['voxels.json']));
  });

  it('reports cross-file findings against the project', () => {
    // The manifest names a part no geometry file defines.
    const src = pkg({
      [MANIFEST]: JSON.stringify({
        name: 'm',
        parts: [{ name: 'body' }, { name: 'ghost' }],
      }),
      'voxels.json': GEO([{ name: 'body' }]),
    });
    const found = lintSource(src);
    expect(found).toHaveLength(1);
    expect(found[0]!.file).toBe(CROSS_FILE);
    expect(found[0]!.diag.code).toBe('missing');
    expect(found[0]!.diag.message).toMatch(/ghost/);
  });

  // SPEC §6.12 — the editor is where a publication gets typed, so a
  // publication pointing at a socket that isn't there has to show up in the
  // Console rather than waiting for the CLI to reject the package.
  describe('published sockets', () => {
    const withSocket = (socketName: string) =>
      JSON.stringify({
        version: '0.9',
        palette: ['#FF0000'],
        parts: [
          {
            name: 'hand-r',
            size: [2, 1, 1],
            sockets: [{ name: socketName, pos: [1, 0, 0] }],
            voxels: [['00']],
          },
        ],
      });
    const manifest = JSON.stringify({
      name: 'm',
      parts: [{ name: 'hand-r' }],
      sockets: { weapon: { part: 'hand-r', socket: 'grip' } },
    });

    it('reports nothing when the host part declares the socket', () => {
      expect(
        lintSource(pkg({ [MANIFEST]: manifest, 'voxels.json': withSocket('grip') })),
      ).toEqual([]);
    });

    it('reports a publication whose socket the host part does not declare', () => {
      const found = lintSource(
        pkg({ [MANIFEST]: manifest, 'voxels.json': withSocket('hold') }),
      );
      expect(found).toHaveLength(1);
      expect(found[0]!.file).toBe(CROSS_FILE);
      expect(found[0]!.diag.code).toBe('missing');
      expect(found[0]!.diag.severity).toBe('error');
      expect(found[0]!.diag.message).toMatch(/weapon/);
    });
  });

  it('surfaces hints as well as warnings, since --strict ignores only hints', () => {
    // A fractional pivot that is not the geometric default → H02, a hint.
    const src = pkg({
      [MANIFEST]: JSON.stringify({ name: 'm', parts: [{ name: 'body' }] }),
      'voxels.json': GEO([{ name: 'body', pivot: [0.5, 0.5, 0] }]),
    });
    const found = lintSource(src);
    expect(found.map((f) => f.diag.ruleId)).toContain('H02');
    expect(found.find((f) => f.diag.ruleId === 'H02')!.diag.severity).toBe('hint');
  });

  // W07 is the rule most easily got wrong, because since v0.9 EVERY file in
  // a package is `.json`. Deciding by extension would flag the palette and
  // the animation clip; skipping the rule would let the editor disagree with
  // the CLI about a forgotten `geometry` entry.
  describe('W07 — unreferenced geometry, decided by content', () => {
    const base = {
      [MANIFEST]: JSON.stringify({
        name: 'm',
        geometry: ['voxels.json'],
        parts: [{ name: 'body' }],
        animations: { walk: 'anims/walk.json' },
      }),
      'voxels.json': GEO([{ name: 'body' }], 'palette.json'),
      'palette.json': '{"colors":["#FF0000"]}',
      'anims/walk.json': '{"duration":1,"loop":true,"parts":{}}',
    };

    it('does not flag the palette file or the animation clip', () => {
      expect(ids(pkg(base))).toEqual([]);
    });

    it('flags a geometry file the manifest forgot to list', () => {
      const src = pkg({ ...base, 'gear.json': GEO([{ name: 'hat' }], ['#0000FF']) });
      const found = lintSource(src);
      expect(found.map((f) => f.diag.ruleId)).toContain('W07');
      expect(found.find((f) => f.diag.ruleId === 'W07')!.diag.message).toMatch(
        /gear\.json/,
      );
    });

    it('ignores a .json file that is not geometry at all', () => {
      const src = pkg({ ...base, 'notes.json': '{"hello":"world"}' });
      expect(ids(src)).toEqual([]);
    });
  });

  it('runs the per-file rules with an UNPARSEABLE manifest, and no cross-file ones', () => {
    // Since SPEC §3 the manifest is required, so "no manifest" now only
    // arises while its text is mid-edit broken — the AST is absent, the
    // document is still open, and the per-file rules must keep working
    // instead of throwing on the way to a project that cannot be built.
    const src = pkg({
      [MANIFEST]: JSON.stringify({ name: 'm', parts: [{ name: 'body' }] }),
      'voxels.json': GEO([{ name: 'body', pivot: [9, 0, 0] }]),
    });
    const { manifest: _dropped, ...broken } = src;
    const found = lintSource(broken);
    expect(found.map((f) => f.diag.ruleId)).toEqual(['W01']);
    expect(found[0]!.file).toBe('voxels.json');
  });
});

// Against the real shipped models, on disk. The core suite already walks
// `models/` and requires `cuboidy-lint --strict` to exit 0 on every one, so
// the editor agreeing here means the two lint paths agree about real
// packages — and if the editor ever starts inventing a finding the CLI does
// not report, this is what catches it.
describe('lintSource — the shipped models', () => {
  const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const MODELS = resolve(REPO_ROOT, 'models');

  const fromDisk = (dir: string): LoadedSource => {
    const files = new Map<string, string>();
    const walk = (rel: string) => {
      for (const e of readdirSync(resolve(dir, rel), { withFileTypes: true })) {
        const child = rel === '' ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) walk(child);
        else if (child.endsWith('.json')) {
          files.set(child, readFileSync(resolve(dir, child), 'utf8'));
        }
      }
    };
    walk('');
    const manifestText = files.get(MANIFEST);
    const manifest = manifestText === undefined ? undefined : manifestOf(manifestText);
    // The primary is the manifest's first geometry entry, as the loader picks it.
    const primaryPath = manifest?.geometry?.[0] ?? 'voxels.json';
    const refs = resolveProjectRefs(manifest, files, {
      path: primaryPath,
      geometry: geom(files.get(primaryPath)!),
    });
    const geometries = new Map(refs.geometries);
    if (!geometries.has(primaryPath)) {
      geometries.set(primaryPath, geom(files.get(primaryPath)!));
    }
    return {
      folderName: 'm',
      files,
      primaryPath,
      manifestPath: MANIFEST,
      ...(manifest !== undefined && { manifest }),
      geometries,
    parts: refs.parts,
      ...(refs.externalAnims !== undefined && { externalAnims: refs.externalAnims }),
    };
  };

  const dirs = readdirSync(MODELS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  it('finds at least one model to check', () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it.each(dirs)('models/%s reports no warnings or errors', (name) => {
    const src = fromDisk(resolve(MODELS, name));
    // Guard against a vacuous pass: an empty resolve would lint clean too.
    expect([...src.geometries.values()].flatMap((g) => g.parts).length,
      `${name} resolved no parts`).toBeGreaterThan(0);
    const found = lintSource(src);
    const notHints = found.filter((f) => f.diag.severity !== 'hint');
    expect(
      notHints.map((f) => `${f.file}: ${f.diag.ruleId ?? f.diag.code} ${f.diag.message}`),
    ).toEqual([]);
  });
});

// `cuboidy-lint` runs the cross-file rules only when resolution came back
// clean; the editor used to run them unconditionally, because its loader
// never surfaced the flag. One missing geometry file then produced a wall of
// findings ABOUT the failure — W07 on files the missing one references, and
// a missing-part report for every part it was supposed to define — with the
// actual cause somewhere in the middle.
describe('lintSource — cross-file rules wait for a resolvable project', () => {
  const broken = () =>
    pkg({
      [MANIFEST]: JSON.stringify({
        name: 'm',
        geometry: ['voxels.json', 'gone.json'],
        parts: [{ name: 'body' }, { name: 'arm' }],
      }),
      'voxels.json': GEO([{ name: 'body' }]),
      // `gone.json` is listed and absent: resolution reports it, and `arm`
      // never finds a shape.
    });

  it('the fixture really is unresolvable', () => {
    expect(broken().projectErrors ?? []).not.toHaveLength(0);
  });

  it('says nothing about the project while a referenced file is missing', () => {
    const found = lintSource(broken()).filter((d) => d.file === CROSS_FILE);
    expect(found).toHaveLength(0);
  });

  it('still runs the PER-FILE rules on what did load', () => {
    // Per-file lint does not depend on the project resolving, so a broken
    // reference must not silence the file you are editing.
    const src = pkg({
      [MANIFEST]: JSON.stringify({
        name: 'm',
        geometry: ['voxels.json', 'gone.json'],
        parts: [{ name: 'body' }],
      }),
      // Pivot far outside the grid — a per-file rule.
      'voxels.json': GEO([{ name: 'body', pivot: [99, 0, 0] }]),
    });
    const perFile = lintSource(src).filter((d) => d.file !== CROSS_FILE);
    expect(perFile.length).toBeGreaterThan(0);
  });

  it('reports cross-file findings again once the file is there', () => {
    const src = pkg({
      [MANIFEST]: JSON.stringify({
        name: 'm',
        geometry: ['voxels.json'],
        parts: [{ name: 'body' }],
      }),
      'voxels.json': GEO([{ name: 'body' }]),
      // Present, parses as geometry, referenced by nothing: W07.
      'orphan.json': GEO([{ name: 'stray' }]),
    });
    expect(src.projectErrors ?? []).toHaveLength(0);
    const cross = lintSource(src).filter((d) => d.file === CROSS_FILE);
    expect(cross.map((d) => d.diag.ruleId)).toContain('W07');
  });
});
