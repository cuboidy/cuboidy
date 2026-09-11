import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { parseManifest, type Manifest } from '../src/manifest.js';
import { resolveProject } from '../src/project.js';
import { validateProject } from '../src/lint/cross-file.js';
import { runLint } from '../src/cli/lint-runner.js';

// The flipbook rules (§11.6 W09-W11, H04). The shape under test is the one
// two shipped Tropalm packages use — `Tropalm.Godot/Models/tropalm/campfire`
// and `.../furnace`, eight `flame_f0..flame_f7` parts driven by
// `anims/burn.json` at dt 0.2 s over a 1.6 s loop — reproduced here rather
// than referenced, since those live in another repository. Every failing case
// below is that same clip with one thing broken.

function manifestOrThrow(json: unknown): Manifest {
  const r = parseManifest(json);
  if (!r.ok) throw new Error(`manifest parse failed: ${r.message}`);
  return r.value;
}

const CELL = { size: [1, 1, 1], voxels: [['0']] };

/**
 * A clip that shows one frame at a time, in order.
 *
 * Keys run 0 .. n inclusive — the trailing key AT `duration` is what the
 * shipped packages write, and it is not redundant: §6.7 interpolates the tail
 * interval toward `"0.0"`, so an author who wants the last frame held for its
 * full dt says so there. A looping clip samples that instant as `"0.0"`
 * anyway, which is why the wrap-around `i % n` below keeps the set exclusive
 * at the join.
 *
 * Times are written with `toFixed(1)` so the keys are the literal decimal
 * strings §6.6 asks for ("0.2", not "0.2000000000000000111"). `keys` overrides
 * them for the uneven-interval case: §6.6 wants the keys strictly increasing
 * in DOCUMENT order, so an irregular clip has to be built with its keys in
 * order rather than by editing an even one.
 */
function burnClip(
  frames: readonly string[],
  dt = 0.2,
  keys?: readonly string[],
): object {
  const n = frames.length;
  const times = keys ?? Array.from({ length: n + 1 }, (_, i) => (i * dt).toFixed(1));
  const parts: Record<string, Record<string, { visible: boolean }>> = {};
  frames.forEach((name, j) => {
    const track: Record<string, { visible: boolean }> = {};
    times.forEach((key, i) => {
      track[key] = { visible: i % n === j };
    });
    parts[name] = track;
  });
  return {
    duration: Number(times[times.length - 1]!),
    loop: true,
    parts,
  };
}

function frameNames(n: number, prefix = 'flame'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}_f${i}`);
}

/** A hearth plus `frames`, all inline, all taking the manifest's one colour. */
function model(frames: readonly string[], animations?: object): Manifest {
  return manifestOrThrow({
    name: 'campfire',
    palette: ['#FF7700'],
    parts: [
      { name: 'hearth', geometry: CELL },
      ...frames.map((name) => ({ name, parent: 'hearth', geometry: CELL })),
    ],
    ...(animations === undefined ? {} : { animations }),
  });
}

function lint(m: Manifest) {
  const p = resolveProject(m, new Map<string, string>());
  return validateProject({
    manifest: m,
    geometries: p.geometries,
    parts: p.parts,
    unresolved: p.unresolved,
    externalAnims: p.externalAnims,
  });
}

describe('flipbook lint — the shape that passes', () => {
  it('says nothing about the shipped eight-frame burn clip', () => {
    const frames = frameNames(8);
    expect(lint(model(frames, { burn: burnClip(frames) }))).toEqual([]);
  });

  it('says nothing about a set no clip drives', () => {
    // `_f<n>` is a naming convention, not a reserved word. Two fixed panels
    // that happen to be spelled that way are not a broken animation, and a
    // lint that told them they were would be unanswerable.
    expect(lint(model(['panel_f1', 'panel_f2']))).toEqual([]);
  });

  it('says nothing about a set a clip animates without keying visible', () => {
    const frames = frameNames(8);
    const wobble = {
      duration: 1,
      loop: true,
      parts: { flame_f0: { '0.0': { rot: [0, 0, 0] }, '1.0': { rot: [0, 10, 0] } } },
    };
    expect(lint(model(frames, { wobble }))).toEqual([]);
  });
});

describe('W10 — exactly one frame visible at every instant', () => {
  it('reports two frames visible at one key, naming both and the key', () => {
    const frames = frameNames(8);
    const clip = burnClip(frames) as {
      parts: Record<string, Record<string, { visible: boolean }>>;
    };
    clip.parts['flame_f1']!['0.0'] = { visible: true };
    const diags = lint(model(frames, { burn: clip }));
    expect(diags).toHaveLength(1);
    expect(diags[0]?.ruleId).toBe('W10');
    expect(diags[0]?.severity).toBe('warning');
    expect(diags[0]?.message).toContain('"0.0"');
    expect(diags[0]?.message).toContain('2 frames are visible');
    expect(diags[0]?.message).toContain('flame_f0, flame_f1');
    // One mistake, one instant. The clip's trailing key at `duration` samples
    // as "0.0" on a loop, so counting it too would send the reader looking for
    // a second fault that is the first one wearing another key's name.
    expect(diags[0]?.message).not.toContain('more time key');
  });

  it('reports no frame visible, which a still never catches', () => {
    const frames = frameNames(8);
    const clip = burnClip(frames) as {
      parts: Record<string, Record<string, { visible: boolean }>>;
    };
    // Blank the instant entirely: `"1.6"` too, because a looping clip samples
    // its `duration` as `"0.0"` and leaving it set would hide half the hole.
    clip.parts['flame_f0']!['0.0'] = { visible: false };
    clip.parts['flame_f0']!['1.6'] = { visible: false };
    const diags = lint(model(frames, { burn: clip }));
    expect(diags).toHaveLength(1);
    expect(diags[0]?.ruleId).toBe('W10');
    expect(diags[0]?.message).toContain('no frame is visible');
    expect(diags[0]?.message).toContain('"0.0"');
  });

  it('counts the other bad instants without printing one line each', () => {
    // Every frame on at every key: one mistake, eight instants (the ninth key
    // is `duration`, which a loop samples as "0.0"). The sentence that names
    // it has to be findable, so the rest are a count.
    const frames = frameNames(8);
    const clip = burnClip(frames) as {
      parts: Record<string, Record<string, { visible: boolean }>>;
    };
    for (const track of Object.values(clip.parts)) {
      for (const key of Object.keys(track)) track[key] = { visible: true };
    }
    const diags = lint(model(frames, { burn: clip }));
    expect(diags).toHaveLength(1);
    expect(diags[0]?.message).toContain('and at 7 more time keys');
  });
});

describe('W09 — a clip that keys visible on some members and not others', () => {
  it('names the unkeyed frame and does not also report W10', () => {
    // The unkeyed member holds the §6.5 default `true` for the whole clip, so
    // it is co-visible at every instant. Reporting that as nine W10s would
    // bury the one sentence that says what to fix.
    const frames = frameNames(8);
    const clip = burnClip(frames) as {
      parts: Record<string, Record<string, { visible: boolean }>>;
    };
    delete clip.parts['flame_f7'];
    const diags = lint(model(frames, { burn: clip }));
    expect(diags).toHaveLength(1);
    expect(diags[0]?.ruleId).toBe('W09');
    expect(diags[0]?.severity).toBe('warning');
    expect(diags[0]?.message).toContain("'flame_f7'");
  });

  it('a track that exists but keys only rot counts as unkeyed', () => {
    const frames = frameNames(8);
    const clip = burnClip(frames) as { parts: Record<string, object> };
    clip.parts['flame_f7'] = { '0.0': { rot: [0, 0, 0] } };
    const diags = lint(model(frames, { burn: clip }));
    expect(diags.map((d) => d.ruleId)).toEqual(['W09']);
  });
});

describe('W11 — frame indices contiguous from 0', () => {
  it('reports the gap a deleted drawing leaves', () => {
    const frames = [...frameNames(7), 'flame_f8'];
    const diags = lint(model(frames, { burn: burnClip(frames) }));
    const w11 = diags.filter((d) => d.ruleId === 'W11');
    expect(w11).toHaveLength(1);
    expect(w11[0]?.severity).toBe('warning');
    expect(w11[0]?.message).toContain("'flame_f7'");
  });

  it('reports two names spelling one index', () => {
    // `_f0` and `_f00` are eight names and seven frames. Both parse, both
    // animate, and the set is one drawing short of what it looks like.
    const frames = ['flame_f0', 'flame_f00', ...frameNames(7).slice(1)];
    const diags = lint(model(frames, { burn: burnClip(frames) }));
    const w11 = diags.find((d) => d.ruleId === 'W11');
    expect(w11?.message).toContain('index 0 spelled by');
  });
});

describe('H04 — the band and the interval, as guidance', () => {
  it('hints below four frames, and a hint does not fail --strict', () => {
    const frames = frameNames(3);
    const diags = lint(model(frames, { burn: burnClip(frames) }));
    expect(diags).toHaveLength(1);
    expect(diags[0]?.ruleId).toBe('H04');
    expect(diags[0]?.severity).toBe('hint');
    expect(diags[0]?.message).toContain('3 frames');
  });

  it('hints above eight frames', () => {
    const frames = frameNames(10);
    const diags = lint(model(frames, { burn: burnClip(frames) }));
    expect(diags.map((d) => d.ruleId)).toEqual(['H04']);
  });

  it('hints at an uneven interval, quoting the keys as the file spells them', () => {
    const frames = frameNames(4);
    // The third key sits at "0.5" where an even clip puts "0.4": still
    // exclusive, still contiguous, and the loop now stumbles once per cycle.
    const clip = burnClip(frames, 0.2, ['0.0', '0.2', '0.5', '0.6', '0.8']);
    const diags = lint(model(frames, { burn: clip }));
    const h04 = diags.filter((d) => d.ruleId === 'H04');
    expect(h04).toHaveLength(1);
    expect(h04[0]?.severity).toBe('hint');
    expect(h04[0]?.message).toContain('"0.2" to "0.5"');
  });

  it('does not call the shipped clip uneven over floating-point subtraction', () => {
    // 0.6 − 0.4 is 0.19999999999999998 and 0.8 − 0.6 is 0.20000000000000007.
    // An exact comparison hints on every clip in the corpus.
    const frames = frameNames(8);
    expect(lint(model(frames, { burn: burnClip(frames) }))).toEqual([]);
  });
});

describe('flipbook lint through cuboidy-lint, with an external clip', () => {
  // The shipped packages keep the clip in `anims/burn.json` rather than
  // inline, which is a different resolution path — the clip only has a body
  // once the project layer has read the file. The rules run on the resolved
  // whole, so they see it, and this is the test that says so.
  async function pkg(clip: object): Promise<string> {
    const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-flipbook-test-'));
    const frames = frameNames(8);
    const files: Record<string, string> = {
      'cuboidy.json': JSON.stringify({
        name: 'campfire',
        version: '0.9',
        palette: ['#FF7700'],
        parts: [
          { name: 'hearth', geometry: CELL },
          ...frames.map((name) => ({ name, parent: 'hearth', geometry: CELL })),
        ],
        animations: { burn: 'anims/burn.json' },
      }),
      'anims/burn.json': JSON.stringify(clip),
    };
    for (const [name, content] of Object.entries(files)) {
      const path = resolve(dir, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf-8');
    }
    return dir;
  }

  it('a well-formed external flipbook lints clean under --strict', async () => {
    const result = await runLint(await pkg(burnClip(frameNames(8))), {
      strict: true,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('a two-visible external flipbook fails --strict', async () => {
    const clip = burnClip(frameNames(8)) as {
      parts: Record<string, Record<string, { visible: boolean }>>;
    };
    clip.parts['flame_f3']!['0.0'] = { visible: true };
    const result = await runLint(await pkg(clip), { strict: true });
    expect(result.diagnostics.map((d) => d.diag.ruleId)).toEqual(['W10']);
    expect(result.exitCode).toBe(1);
  });
});
