import type { Diagnostic } from '../diagnostic.js';
import { clampToClip, samplePart, type InlineAnimation } from '../animation.js';
import type { Manifest } from '../manifest.js';

// A FLIPBOOK: a volume that changes shape over time, drawn as a set of
// complete parts `<name>_f<n>` of which a clip makes exactly one visible at
// any instant (docs/authoring.md, "Flipbook volumes").
//
// The format has no flipbook construct and does not need one — the set is
// ordinary parts and `visible` is an ordinary §6.5 field. What it lacks is
// any way to be WRONG loudly. Two frames visible at one instant reads as one
// thicker flame rather than as a bug; none visible is a hole for a fifth of a
// second that a still never catches and a gif shows as a flicker you assume
// was intended. Both parse, both lint clean everywhere else, and both survive
// every render check in the toolchain. So the rules below are the only thing
// that sees them.
//
// Warning, not error, and §11.1 settles that: an exclusivity failure is
// spec-valid and suspicious, which is exactly what a `W` says — and `W` is
// also what `--strict` fails on, so a package that gates on strict gets the
// finding as a stop. The frame-count band and the constant-`dt` rule are `H`
// instead: they are guidance about how a flipbook reads, not a claim that the
// model is wrong, and a clip with a deliberate hold on one frame is a
// legitimate thing to author past them.

const FRAME_NAME = /^(.+)_f(\d+)$/;

// docs/authoring.md's band. Below four the loop is a strobe; above eight the
// drawing cost stops buying anything the eye can follow at these rates.
const MIN_FRAMES = 4;
const MAX_FRAMES = 8;

interface Member {
  name: string;
  index: number;
}

interface FrameSet {
  prefix: string;
  members: Member[];
}

// Parts whose names spell `<prefix>_f<n>`, grouped by prefix, in manifest
// order. A prefix with one member is not a set: `torch_f0` alone is a part
// that happens to end in `_f0`, and calling it a one-frame flipbook would
// hand every such name a finding it cannot act on.
function frameSets(manifest: Manifest): FrameSet[] {
  const byPrefix = new Map<string, Member[]>();
  for (const p of manifest.parts) {
    const m = FRAME_NAME.exec(p.name);
    if (m === null) continue;
    const prefix = m[1]!;
    const members = byPrefix.get(prefix);
    // `Number`, not `parseInt`: both read "007" as 7, and the duplicate that
    // makes visible below is the point — `_f0` and `_f00` are two parts with
    // one index, which is a set with a hole in it however it is spelled.
    const member: Member = { name: p.name, index: Number(m[2]!) };
    if (members === undefined) byPrefix.set(prefix, [member]);
    else members.push(member);
  }
  const out: FrameSet[] = [];
  for (const [prefix, members] of byPrefix) {
    if (members.length < 2) continue;
    out.push({ prefix, members });
  }
  return out;
}

// Does this clip drive this part's visibility? A track that exists but keys
// only `rot` does not: `visible` carries over from the §6.5 default and the
// part is simply always on, which is what an ordinary animated part is.
function keysVisible(anim: InlineAnimation, part: string): boolean {
  const track = anim.parts[part];
  if (track === undefined) return false;
  return Object.values(track).some((kf) => kf.visible !== undefined);
}

// Every time key any keyed member of the set carries, deduplicated by VALUE
// and carrying the author's literal spelling.
//
// The spelling is kept because it is the only thing a reader can search the
// file for. Re-rendering 0.2 for a message prints `0.2`, and against a clip
// keyed at `"0.20"` — legal under §6.6, which asks only for a decimal point —
// that is a string the file does not contain. Dedupe is by the parsed number
// for the same reason in reverse: `"0.2"` and `"0.20"` are one instant, and
// sampling it twice would report the same failure twice.
function keyTimes(
  anim: InlineAnimation,
  members: readonly Member[],
): { key: string; t: number }[] {
  const seen = new Map<number, string>();
  for (const m of members) {
    const track = anim.parts[m.name];
    if (track === undefined) continue;
    for (const key of Object.keys(track)) {
      const t = Number(key);
      if (!Number.isFinite(t)) continue; // a malformed key is §11.5's finding
      if (!seen.has(t)) seen.set(t, key);
    }
  }
  return [...seen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, key]) => ({ key, t }));
}

/**
 * The flipbook rules over a whole project: W09, W10, W11 and H04.
 *
 * `anims` is every clip of the model with its body in hand — the manifest's
 * inline ones and the resolved external ones together — keyed by clip name.
 */
export function checkFlipbooks(
  manifest: Manifest,
  anims: ReadonlyMap<string, InlineAnimation>,
  out: Diagnostic[],
): void {
  for (const set of frameSets(manifest)) {
    // Which clips treat this set AS a flipbook. Nothing below fires on a set
    // no clip drives, and that is deliberate: `_f<n>` is a naming convention,
    // not a reserved word, and a model free to use it for something else —
    // `panel_f1`, `panel_f2` as two fixed panels — must not be told its parts
    // are a broken animation. A clip keying `visible` on one of them is the
    // author saying what the set is; until then the lint has no claim.
    const driving = [...anims].filter(([, anim]) =>
      set.members.some((m) => keysVisible(anim, m.name)),
    );
    if (driving.length === 0) continue;

    checkContiguous(set, out); // W11
    checkFrameCount(set, out); // H04

    for (const [clip, anim] of driving) {
      const unkeyed = set.members.filter((m) => !keysVisible(anim, m.name));
      if (unkeyed.length > 0) {
        // W09, and W10 is SKIPPED for this clip. An unkeyed member holds the
        // §6.5 default `true` for the whole clip, so it is co-visible at
        // every single instant and W10 would report the same one mistake once
        // per keyframe, burying the sentence that names it.
        out.push({
          code: 'invalid-value',
          severity: 'warning',
          ruleId: 'W09',
          message:
            `animation '${clip}' keys \`visible\` on some frames of the flipbook ` +
            `'${set.prefix}_f*' but not on ${namesOf(unkeyed)} — an unkeyed frame holds ` +
            'the §6.5 default `true` and is drawn over every other frame',
        });
        continue;
      }
      checkExclusive(set, clip, anim, out); // W10
      checkConstantSpacing(set, clip, anim, out); // H04
    }
  }
}

function namesOf(members: readonly Member[]): string {
  return members.map((m) => `'${m.name}'`).join(', ');
}

// W10 — exactly one frame visible at every instant of the clip.
//
// Sampled at the set's key times and nowhere else, which is exhaustive rather
// than a probe: `visible` steps (§6.7), so the set's visibility is constant on
// each interval between consecutive key times and one sample per interval sees
// every value it takes. A "just after" second sample at t + ε would land in the
// same interval and read the same answer — and picking an ε small enough not to
// step over the next key is a harder problem than it removes.
//
// Sampling goes through `samplePart`, not a hand-rolled step lookup, so the
// answer is the one the renderer gets — including the wrap: a looping clip
// keyed at `duration` samples there as its `"0.0"` keyframe, and lint agrees
// with the gif about which frame that instant shows.
function checkExclusive(
  set: FrameSet,
  clip: string,
  anim: InlineAnimation,
  out: Diagnostic[],
): void {
  let firstBad: { key: string; visible: string[] } | null = null;
  let badCount = 0;
  // A key that does not survive the wrap is not an instant of its own: a
  // looping clip keyed at `duration` — which is what the shipped packages
  // write — samples there as `"0.0"`, so counting it would report the SAME
  // failure twice and the tally would say there is a second one to find.
  const instants = keyTimes(anim, set.members).filter(
    ({ t }) => clampToClip(t, anim.duration, anim.loop) === t,
  );
  for (const { key, t } of instants) {
    const visible: string[] = [];
    for (const m of set.members) {
      const track = anim.parts[m.name]!;
      if (samplePart(track, t, anim.duration, anim.loop).visible) {
        visible.push(m.name);
      }
    }
    if (visible.length === 1) continue;
    badCount++;
    firstBad ??= { key, visible };
  }
  if (firstBad === null) return;
  const { key, visible } = firstBad;
  const what =
    visible.length === 0
      ? 'no frame is visible'
      : `${visible.length} frames are visible (${visible.join(', ')})`;
  const more = badCount - 1;
  const rest =
    more === 0 ? '' : ` (and at ${more} more time key${more === 1 ? '' : 's'})`;
  out.push({
    code: 'invalid-value',
    severity: 'warning',
    ruleId: 'W10',
    message:
      `animation '${clip}' at time key "${key}": ${what} of the flipbook ` +
      `'${set.prefix}_f*' — exactly one frame is the whole shape at an instant${rest}`,
  });
}

// W11 — frame indices run 0, 1, … n−1 with no gap and no repeat. A gap is a
// deleted drawing the clip still has a slot for; a repeat is two spellings of
// one index (`_f0` and `_f00`), where the set has n names and n−1 frames.
function checkContiguous(set: FrameSet, out: Diagnostic[]): void {
  const seen = new Map<number, string[]>();
  for (const m of set.members) {
    const names = seen.get(m.index);
    if (names === undefined) seen.set(m.index, [m.name]);
    else names.push(m.name);
  }
  const missing: number[] = [];
  for (let i = 0; i < set.members.length; i++) {
    if (!seen.has(i)) missing.push(i);
  }
  const repeated = [...seen.entries()].filter(([, names]) => names.length > 1);
  if (missing.length === 0 && repeated.length === 0) return;
  const said: string[] = [];
  if (missing.length > 0) {
    said.push(`no ${missing.map((i) => `'${set.prefix}_f${i}'`).join(', ')}`);
  }
  for (const [index, names] of repeated) {
    said.push(
      `index ${index} spelled by ${names.map((n) => `'${n}'`).join(' and ')}`,
    );
  }
  out.push({
    code: 'invalid-value',
    severity: 'warning',
    ruleId: 'W11',
    message:
      `flipbook '${set.prefix}_f*' has ${set.members.length} frame parts but its ` +
      `indices are not 0..${set.members.length - 1}: ${said.join('; ')}`,
  });
}

// H04 — the frame count band. Guidance, so a hint: it does not fail `--strict`
// and an author who wants ten drawings can have them.
function checkFrameCount(set: FrameSet, out: Diagnostic[]): void {
  const n = set.members.length;
  if (n >= MIN_FRAMES && n <= MAX_FRAMES) return;
  out.push({
    code: 'invalid-value',
    severity: 'hint',
    ruleId: 'H04',
    message:
      `flipbook '${set.prefix}_f*' has ${n} frames; ${MIN_FRAMES}-${MAX_FRAMES} is the ` +
      'band that reads as motion rather than as a strobe or as drawings nobody can tell apart',
  });
}

// H04 — constant `dt`. The loop is frames × one interval, and an uneven one
// reads as a stumble in a cycle that is supposed to be even. Compared with a
// relative tolerance because the gaps are double subtractions of decimals the
// author wrote: 0.6 − 0.4 is 0.19999999999999998 and 0.8 − 0.6 is
// 0.20000000000000007, and an exact comparison calls a perfectly even clip
// uneven. A real irregularity is orders of magnitude clear of this.
function checkConstantSpacing(
  set: FrameSet,
  clip: string,
  anim: InlineAnimation,
  out: Diagnostic[],
): void {
  const times = keyTimes(anim, set.members);
  if (times.length < 3) return; // fewer than two intervals: nothing to compare
  const first = times[1]!.t - times[0]!.t;
  const tol = Math.max(Math.abs(first), 1) * 1e-6;
  for (let i = 2; i < times.length; i++) {
    const gap = times[i]!.t - times[i - 1]!.t;
    if (Math.abs(gap - first) <= tol) continue;
    out.push({
      code: 'invalid-value',
      severity: 'hint',
      ruleId: 'H04',
      message:
        `animation '${clip}': the flipbook '${set.prefix}_f*' is keyed at uneven ` +
        `intervals — "${times[i - 1]!.key}" to "${times[i]!.key}" is not the ` +
        `${first} of "${times[0]!.key}" to "${times[1]!.key}"`,
    });
    return; // one sentence per clip; the first uneven gap names the problem
  }
}
