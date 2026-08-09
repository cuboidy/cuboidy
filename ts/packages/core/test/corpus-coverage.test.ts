import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { EASING_NAMES } from '../src/easing.js';
import { loadAndAssemble } from '../src/cli/assemble.js';
import { buildMesh } from '../src/mesh.js';
import { resolveRefFrom } from '../src/project.js';

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const MODELS = join(REPO_ROOT, 'models');

// `models/` is the positive half of the cross-implementation contract: a
// second implementation is done when every shipped model loads clean. That
// only means something for the features the models actually use, and an
// audit found several that none of them did — §6.13 inline geometry (the
// majority of `project.ts`), a manifest-level palette, a §8 reference that
// resolves relative to a file in a subdirectory, a `pivot.rot` on a part
// with CHILDREN (windmill's five bearers are childless leaves, so dropping
// the field moved nothing), seven easing presets, and three of the four hex
// forms.
//
// These assertions are about the corpus, not about any one model. They fail
// if a gap reopens — including by someone deleting the model that closed it.

async function modelDirs(): Promise<string[]> {
  const entries = await readdir(MODELS, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function allJsonText(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.json')) out.push(await readFile(p, 'utf8'));
    }
  };
  await walk(dir);
  return out;
}

describe('models/ — corpus coverage', () => {
  it('every model still loads and assembles', async () => {
    for (const name of await modelDirs()) {
      const r = await loadAndAssemble(join(MODELS, name));
      expect(r.ok, `${name}: ${r.ok ? '' : r.message}`).toBe(true);
    }
  });

  // `docs/csharp-implementation.md` is the one document that says when a
  // second implementation is DONE, and both halves of its corpus statement
  // went stale within a day of being written — it named eight models on the
  // day the ninth landed, and 38 fixtures against 45 on disk. A porter
  // reading it would have believed the missing model (the only one with §7.4
  // materials) was not part of the contract. So the numbers are asserted
  // rather than maintained.
  it('the acceptance document still describes the corpus on disk', async () => {
    const doc = await readFile(
      join(REPO_ROOT, 'docs', 'csharp-implementation.md'),
      'utf8',
    );
    const models = await modelDirs();
    const sentence = /every shipped model —([\s\S]+?)— *\s*loads clean/.exec(doc);
    expect(sentence, 'the "every shipped model — … — loads clean" sentence').not.toBeNull();
    const named = sentence![1]!
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .sort();
    expect(named, 'the model list in the acceptance document').toEqual(models);

    const fixtures: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith('.json')) fixtures.push(p);
      }
    };
    await walk(join(REPO_ROOT, 'fixtures'));
    const claimed = /(\d+) files\s+today across/.exec(doc)?.[1];
    expect(
      Number(claimed),
      `acceptance document claims ${claimed} fixtures, ${fixtures.length} on disk`,
    ).toBe(fixtures.length);
  });

  it('some model writes a part inline in the manifest (§6.13)', async () => {
    const found: string[] = [];
    for (const name of await modelDirs()) {
      const r = await loadAndAssemble(join(MODELS, name));
      if (!r.ok) continue;
      if (r.assembly.manifest.parts.some((p) => p.geometry?.path === undefined && p.geometry !== undefined)) {
        found.push(name);
      }
    }
    expect(found.length, 'no model uses §6.13 inline geometry').toBeGreaterThan(0);
  });

  it('some model declares a manifest-level palette (§6.1)', async () => {
    const found: string[] = [];
    for (const name of await modelDirs()) {
      const r = await loadAndAssemble(join(MODELS, name));
      if (r.ok && r.assembly.manifest.palette !== undefined) found.push(name);
    }
    expect(found.length).toBeGreaterThan(0);
  });

  it('some model resolves a §8 reference from a subdirectory', async () => {
    // Every geometry file in every other model sits at the package root, so
    // `resolveRefFrom` always resolved to the identity — the whole reason
    // that function exists went unexercised.
    const found: string[] = [];
    for (const name of await modelDirs()) {
      const r = await loadAndAssemble(join(MODELS, name));
      if (!r.ok) continue;
      for (const g of r.assembly.geometries) {
        if (g.path.includes('/') && g.geometry.paletteRef !== undefined) {
          found.push(`${name}:${g.path}`);
        }
      }
    }
    expect(found.length, 'no geometry file outside a package root references a palette').toBeGreaterThan(0);
  });

  it('some model rotates a pivot on a part that has children (§7.7)', async () => {
    const found: string[] = [];
    for (const name of await modelDirs()) {
      const r = await loadAndAssemble(join(MODELS, name));
      if (!r.ok) continue;
      const parents = new Set(
        r.assembly.manifest.parts.map((p) => p.parent).filter(Boolean),
      );
      for (const rp of r.assembly.resolvedParts) {
        if (rp.part.pivot.rot !== undefined && parents.has(rp.name)) {
          found.push(`${name}:${rp.name}`);
        }
      }
    }
    // A childless part's pivot rotation is unobservable in any output that
    // does not print the transform itself, which is what made the §7.7
    // composition order untestable across the whole gallery.
    expect(found.length, 'every pivot.rot in the corpus is on a leaf').toBeGreaterThan(0);
  });

  it('some model merges two palettes into one draw call', async () => {
    const found: string[] = [];
    for (const name of await modelDirs()) {
      const r = await loadAndAssemble(join(MODELS, name));
      if (!r.ok) continue;
      // Distinct palette SOURCES, not distinct files — knight's geometry
      // files all point at one `palette.json`, which is one palette shared,
      // not two merged. Only a second source exercises the index remap.
      const sources = new Set<string>();
      if (r.assembly.manifest.palette !== undefined) sources.add('<manifest>');
      for (const g of r.assembly.geometries) {
        if (g.geometry.palette.length === 0) continue;
        sources.add(
          g.geometry.paletteRef === undefined
            ? `inline:${g.path}`
            : resolveRefFrom(g.path, g.geometry.paletteRef),
        );
      }
      if (sources.size > 1) found.push(name);
    }
    expect(found.length).toBeGreaterThan(0);
  });

  it('every easing preset is used by some model', async () => {
    const used = new Set<string>();
    for (const name of await modelDirs()) {
      for (const text of await allJsonText(join(MODELS, name))) {
        for (const m of text.matchAll(/"(?:rot|pos|scale)"\s*:\s*"([a-z-]+)"/g)) {
          used.add(m[1]!);
        }
      }
    }
    const missing = EASING_NAMES.filter((n) => n !== 'linear' && !used.has(n));
    expect(missing, `easing presets no model exercises: ${missing.join(', ')}`).toEqual([]);
  });

  it('every §7.4 hex form appears somewhere in the corpus', async () => {
    const forms = new Set<number>();
    for (const name of await modelDirs()) {
      for (const text of await allJsonText(join(MODELS, name))) {
        for (const m of text.matchAll(/"#([0-9a-fA-F]{3,8})"/g)) {
          forms.add(m[1]!.length);
        }
      }
    }
    // #RGB, #RGBA, #RRGGBB, #RRGGBBAA — all four are legal and a port has
    // to expand all four; 78 of the corpus's colors used to be #RRGGBB and
    // nothing else, leaving the alpha channel untouched entirely.
    expect([...forms].sort((a, b) => a - b)).toEqual([3, 4, 6, 8]);
  });

  // SPEC §7.4 materials. Until `submersible` there was no shipped model with
  // one, so an implementation that read the object form and threw the
  // material away — or skipped the form entirely — passed every criterion
  // this file states. That is the same hole that let a palette writer drop
  // every material silently until a slider exposed it.
  it('some model declares a §7.4 material object', async () => {
    const found: string[] = [];
    for (const name of await modelDirs()) {
      for (const text of await allJsonText(join(MODELS, name))) {
        if (/"(metallic|roughness|emissive)"\s*:/.test(text)) found.push(name);
      }
    }
    expect(found, 'no shipped model carries a material').not.toHaveLength(0);
  });

  // The three fields are independent branches — metalness, a highlight, and
  // an added emission term — and a port can implement one and drop another.
  it('every §7.4 material field is exercised at a non-default value', async () => {
    const seen = new Set<string>();
    for (const name of await modelDirs()) {
      for (const text of await allJsonText(join(MODELS, name))) {
        for (const m of text.matchAll(
          /"(metallic|roughness|emissive)"\s*:\s*([0-9.]+)/g,
        )) {
          const field = m[1]!;
          const value = Number(m[2]);
          const isDefault =
            (field === 'metallic' && value === 0) ||
            (field === 'roughness' && value === 1) ||
            (field === 'emissive' && value === 0);
          if (!isDefault) seen.add(field);
        }
      }
    }
    expect([...seen].sort()).toEqual(['emissive', 'metallic', 'roughness']);
  });

  // Two entries with the SAME colour and different finishes. Every tool that
  // identifies an entry by colour alone — a legend, a palette merge, a
  // remap — collapses them, and the collapse repaints part of a model.
  it('some model has two entries of one colour with different materials', async () => {
    for (const name of await modelDirs()) {
      const r = await loadAndAssemble(join(MODELS, name));
      if (!r.ok) continue;
      const byColour = new Map<string, Set<string>>();
      for (const e of r.assembly.palette) {
        const c = `${e.color.r},${e.color.g},${e.color.b},${e.color.a}`;
        const m = `${e.material.metallic},${e.material.roughness},${e.material.emissive}`;
        (byColour.get(c) ?? byColour.set(c, new Set()).get(c)!).add(m);
      }
      if ([...byColour.values()].some((set) => set.size > 1)) return;
    }
    throw new Error(
      'no model pairs one colour with two materials — the case where a ' +
        'colour-keyed tool silently merges two palette slots',
    );
  });

  // One part carrying more than one material is what makes `MeshData.groups`
  // do anything. With one material everywhere, a port that ignores grouping
  // entirely still draws the right pixels.
  it('some part resolves to more than one mesh material', async () => {
    for (const name of await modelDirs()) {
      const r = await loadAndAssemble(join(MODELS, name));
      if (!r.ok) continue;
      for (const rp of r.assembly.resolvedParts) {
        // The part's OWN palette — its raw indices address that, not the
        // merged table, and `buildMesh(part, palette)` is the ported pair.
        const mesh = buildMesh(rp.part, rp.palette);
        if (mesh.materials.length > 1) return;
      }
    }
    throw new Error('no shipped part has two materials — groups untested');
  });

  // SPEC §6.5 carryover: a keyframe that omits a field inherits the previous
  // keyframe's value, not the default. Measured across the whole gallery,
  // every omission carried a value that HAPPENED to equal the §6.5 default —
  // all of them, across every clip — so replacing `kf.scale ?? prev.scale`
  // with `kf.scale ?? [1,1,1]` throughout changed nothing anywhere. Most of
  // `resolveTrack` was unfalsifiable. (An earlier version of this comment
  // said "821 of them", a number no counting of the corpus reproduces.)
  it('some keyframe carries a NON-default value from the one before it', async () => {
    const DEFAULTS: Record<string, string> = {
      rot: '[0,0,0]',
      pos: '[0,0,0]',
      scale: '[1,1,1]',
      visible: 'true',
    };
    const found: string[] = [];
    for (const name of await modelDirs()) {
      const r = await loadAndAssemble(join(MODELS, name));
      if (!r.ok) continue;
      for (const [clip, anim] of r.assembly.animations) {
        for (const [part, track] of Object.entries(anim.parts)) {
          const carried: Record<string, string> = { ...DEFAULTS };
          const keys = Object.keys(track)
            .map((k) => ({ k, t: Number(k) }))
            .sort((a, b) => a.t - b.t);
          for (const { k } of keys) {
            const kf = track[k] as Record<string, unknown>;
            for (const field of Object.keys(DEFAULTS)) {
              if (kf[field] === undefined) {
                if (carried[field] !== DEFAULTS[field]) {
                  found.push(`${name}/${clip}/${part}@${k}:${field}`);
                }
              } else {
                carried[field] = JSON.stringify(kf[field]);
              }
            }
          }
        }
      }
    }
    expect(
      found,
      'every omitted keyframe field in the corpus carries a value equal to ' +
        'its §6.5 default, so carryover itself is never observed',
    ).not.toHaveLength(0);
  });

  // §6.5 `scale` reaches printed output through two routes and both were
  // blind to the axis frame: uniform scale COMMUTES with rotation, and the
  // one part in the gallery whose socket moved under scale was scaled
  // uniformly. A port scaling in world axes after the rotation, instead of
  // about the pivot before it, matched every number.
  it('some animated part is scaled NON-uniformly, and publishes a socket', async () => {
    const found: string[] = [];
    for (const name of await modelDirs()) {
      const r = await loadAndAssemble(join(MODELS, name));
      if (!r.ok) continue;
      const socketed = new Set(
        Object.values(r.assembly.manifest.sockets ?? {}).map((s) => s.part),
      );
      for (const [clip, anim] of r.assembly.animations) {
        for (const [part, track] of Object.entries(anim.parts)) {
          if (!socketed.has(part)) continue;
          for (const kf of Object.values(track)) {
            const s = kf.scale;
            if (s !== undefined && new Set(s).size > 1) {
              found.push(`${name}/${clip}/${part}`);
            }
          }
        }
      }
    }
    expect(
      found,
      'no socket-bearing part is scaled non-uniformly — scale order is ' +
        'unobservable, since a uniform scale commutes with the rotation',
    ).not.toHaveLength(0);
  });

  // §7.4 alpha. A translucent colour changes which faces exist, so it is the
  // one palette field that a port cannot treat as a rendering detail.
  it('some model uses a translucent colour', async () => {
    for (const name of await modelDirs()) {
      const r = await loadAndAssemble(join(MODELS, name));
      if (!r.ok) continue;
      if (r.assembly.palette.some((e) => e.color.a < 255)) return;
    }
    throw new Error('no shipped model is see-through anywhere');
  });
});
