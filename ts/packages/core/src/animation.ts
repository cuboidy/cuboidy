// SPEC §6.3–6.9: animation schema + a renderer-agnostic sampler.
//
// The manifest's `animations` map (§6.3) is validated here and re-exported
// into ManifestSchema. The sampler (`sampleAnimation`) turns an inline
// animation + a time (seconds) into a per-part Pose — the public surface
// the editor's 3D view and any future CLI/snapshot animation consume.
//
// Poses are emitted in the SPEC's native units (rot = Euler degrees, ZXY
// intrinsic per §4; pos = voxel-unit delta; scale = per-axis multiplier).
// The sampler never touches matrices/quaternions — that conversion is the
// renderer's job (the editor uses three.js Euler 'ZXY'), keeping this
// module dependency-free and trivially testable.

import { z } from 'zod';
import type { Vec3Tuple } from './geometry/types.js';
import { Identifier } from './identifier-schema.js';
import { refPath } from './ref-path.js';
import {
  DEFAULT_EASING,
  EASING_NAMES,
  applyEasing,
  type EasingName,
} from './easing.js';

// The §4 coordinate triple as a schema. Named apart from the TYPE below
// because they are different things that C# cannot give one name: a
// validator and a shape.
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

// SPEC §6.5: the per-attribute easing map. Each entry names the
// interpolation curve of the OUTGOING segment (this keyframe → the next,
// §6.7) for that attribute alone; a missing attribute means linear.
// Deliberately NOT subject to carryover (unlike the value fields): easing
// never propagates to later keyframes, so a curve set on one key can't
// silently reshape other segments. `visible` steps and has no entry.
export const EaseMapSchema = z
  .object({
    rot: z.enum(EASING_NAMES).optional(),
    pos: z.enum(EASING_NAMES).optional(),
    scale: z.enum(EASING_NAMES).optional(),
  })
  .strict();

// SPEC §6.5: a single keyframe. Every value field is optional — an omitted
// field inherits from the previous keyframe (carryover, resolved in
// resolveTrack); `ease` is exempt (see EaseMapSchema).
// `.strict()` rejects typo'd field names (matches the manifest's strictness).
export const KeyframeSchema = z
  .object({
    rot: Vec3Schema.optional(),
    pos: Vec3Schema.optional(),
    scale: Vec3Schema.optional(),
    visible: z.boolean().optional(),
    ease: EaseMapSchema.optional(),
  })
  .strict();

// SPEC §6.6: a time key is a decimal number string and the point is
// REQUIRED — "1.0", never "1".
//
// That is not cosmetic. A JSON object key spelling a canonical non-negative
// integer is not an ordinary string key in every language's object model:
// JavaScript hoists it ahead of the others, so
// `JSON.parse('{"0.0":…,"0.5":…,"1":…}')` yields keys in the order
// ["1","0.0","0.5"] and the ordering rules below would reject a document
// that is written in order. C#'s System.Text.Json reads document order and
// would accept the same file. Requiring the point keeps every legal time key
// an ordinary string key, so document order and object order agree
// everywhere and the two implementations agree on what is valid.
//
// It also excludes the other spellings a number parser might take —
// "0x10", "0b11", "1e3", "5.", "+1" — which JavaScript's `Number` accepts
// and .NET's `double.Parse` does not.
export const TIME_KEY_RE = /^[0-9]+\.[0-9]+$/;

// SPEC §6.6: a part's keyframe sequence, keyed by decimal-string time keys
// ("0.0", "0.5", …). Key format / ordering / start-at-0 / ≤ duration are
// validated on the enclosing InlineAnimationSchema (they need `duration`);
// the sampler still tolerates unsorted input defensively.
export const AnimationTrackSchema = z.record(z.string(), KeyframeSchema);

// SPEC §6.4: the keys of `parts` are PART names, and §5 makes a part name an
// identifier. They were `z.string()`, so `""`, `"1bad"`, `"a b"`, `"has.dot"`
// and the reserved `"size"` all parsed — while the `animations` map key and
// the `sockets` map key beside them were both checked. §6.8 permits a track
// to target a part the model lacks; it does not permit the key to be
// something that could not be a part name at all. Keying the record also
// closes the last place JavaScript's integer-key hoisting can reorder a
// document, which is what §6.6's decimal point removed for time keys.
export const AnimationPartsSchema = z.record(Identifier, AnimationTrackSchema);

// SPEC §6.4 / §6.6: an inline animation object, including the semantic
// rules the schema shape alone can't express — duration must be a
// positive finite number covering every time key, and each track's keys
// must be decimal-number strings starting at 0 and strictly increasing.
export const InlineAnimationSchema = z
  .object({
    duration: z.number(),
    loop: z.boolean(),
    parts: AnimationPartsSchema,
  })
  .strict()
  .superRefine((anim, ctx) => {
    if (!Number.isFinite(anim.duration) || anim.duration <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['duration'],
        message: 'duration must be a positive number of seconds',
      });
      return; // the per-key ≤ duration checks would only add noise
    }
    for (const [part, track] of Object.entries(anim.parts)) {
      let prev = -Infinity;
      let first = true;
      // Every legal key matches TIME_KEY_RE, which no canonical integer
      // does, so this iteration order IS document order (see the regex).
      for (const key of Object.keys(track)) {
        if (!TIME_KEY_RE.test(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['parts', part, key],
            message: `time key "${key}" is not a decimal number string (the point is required: "1.0", not "1")`,
          });
          break;
        }
        const t = Number(key);
        if (first && t !== 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['parts', part, key],
            message: `first time key must be "0.0" (got "${key}")`,
          });
          break;
        }
        if (!first && t <= prev) {
          ctx.addIssue({
            code: 'custom',
            path: ['parts', part, key],
            message: `time keys must be strictly increasing ("${key}" after ${prev})`,
          });
          break;
        }
        if (t > anim.duration) {
          ctx.addIssue({
            code: 'custom',
            path: ['parts', part, key],
            message: `time key "${key}" exceeds duration ${anim.duration}`,
          });
          break;
        }
        first = false;
        prev = t;
      }
    }
  });

// SPEC §6.3: a value in the animation map is either an inline object or a
// string path to an external animation JSON file — a §8 reference path
// ending in .json, same rule as the palette binding.
export const AnimationSchema = z.union([
  InlineAnimationSchema,
  refPath('.json'),
]);

// SPEC §5 / §6.3: animation names obey the identifier rule (regex + no
// reserved keyword), like model / part names. Keys are validated at parse
// time; the JSON Schema's propertyNames carries the same pattern + not.enum.
export const AnimationsSchema = z.record(Identifier, AnimationSchema);

export type EaseMap = z.infer<typeof EaseMapSchema>;
export type Keyframe = z.infer<typeof KeyframeSchema>;
export type AnimationTrack = z.infer<typeof AnimationTrackSchema>;
export type InlineAnimation = z.infer<typeof InlineAnimationSchema>;
export type Animation = z.infer<typeof AnimationSchema>;

// A fully-resolved part pose at one instant. All fields concrete (carryover
// + interpolation already applied). Units per SPEC §6.5.
//
// This is the ONE pose type. `rig-transform.ts` used to declare two narrower
// views of it — `AnimPose` (`rot`/`pos`) and `PosedPart` (plus an optional
// `scale`) — which a `Map<string, Pose>` satisfied for free, twice over: by
// structural typing, and by the map being covariant in its value type. C#
// has neither. `IReadOnlyDictionary<K, V>` is invariant in `V`, so a
// `Dictionary<string, Pose>` is not passable where a `PosedPart` map is
// expected even with inheritance in place — and inheritance was blocked
// anyway, because `Pose.scale` is required where `PosedPart.scale` was
// optional. Every caller here already passes a full `Pose`.
export interface Pose {
  rot: Vec3Tuple; // Euler degrees, ZXY intrinsic
  pos: Vec3Tuple; // voxel-unit delta added to part.position
  scale: Vec3Tuple; // per-axis multiplier from [1,1,1]
  visible: boolean;
}

// SPEC §6.5 first-keyframe defaults.
function defaultPose(): Pose {
  return { rot: [0, 0, 0], pos: [0, 0, 0], scale: [1, 1, 1], visible: true };
}

// Narrows the §6.3 union: true for an inline object, false for a string ref.
export function isInlineAnimation(a: Animation): a is InlineAnimation {
  return typeof a !== 'string';
}

// The curves of the segment LEAVING a key, one per interpolating attribute,
// resolved to concrete names (absent map entries → linear). No carryover.
interface ResolvedEase {
  rot: EasingName;
  pos: EasingName;
  scale: EasingName;
}

interface ResolvedKey extends Pose {
  t: number; // time key parsed to seconds
  ease: ResolvedEase;
}

// SPEC §6.5 carryover + §6.6 ordering: parse the time keys to numbers, drop
// non-numeric keys defensively, sort ascending, then fill each keyframe's
// omitted VALUE fields from the previous resolved keyframe (the first from
// the §6.5 defaults). `ease` is exempt from carryover: each key's outgoing
// curves come only from its own map. The result is a dense, time-sorted
// pose list.
function resolveTrack(track: AnimationTrack): ResolvedKey[] {
  const sorted = Object.keys(track)
    .map((k) => ({ k, t: Number(k) }))
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);

  const out: ResolvedKey[] = [];
  let prev = defaultPose();
  for (const { k, t } of sorted) {
    const kf = track[k]!;
    const resolved: Pose = {
      rot: kf.rot ?? prev.rot,
      pos: kf.pos ?? prev.pos,
      scale: kf.scale ?? prev.scale,
      visible: kf.visible ?? prev.visible,
    };
    const ease: ResolvedEase = {
      rot: kf.ease?.rot ?? DEFAULT_EASING,
      pos: kf.ease?.pos ?? DEFAULT_EASING,
      scale: kf.ease?.scale ?? DEFAULT_EASING,
    };
    out.push({ t, ease, ...resolved });
    prev = resolved;
  }
  return out;
}

// SPEC §6.7 states that a keyed value is hit EXACTLY at its keyframe, and
// means it literally. `applyEasing` clamping its endpoints is only half of
// that promise: the interpolation itself has to reproduce the endpoints too,
// and the two textbook forms differ on exactly that.
//
//   a + (b − a)·u   is exact at u = 0 and NOT at u = 1
//   a·(1 − u) + b·u is exact at both
//
// Measured over the corpus, the first form misses 32 of 5970 segment
// endpoints, and 36 of 3411 keyed components did not survive a round trip
// through the sampler — `fox/trot` keys the body at `-0.02` and read back
// `-0.01999999999999999`. The second form misses none.
//
// So the form is not an implementation detail and §6.7 now names it. The
// cost is the usual trade: this one is not monotonic in the last bits for
// interior u, where the other is. The endpoints are where an author put a
// number and expects to see it; the interior is compared to a tolerance.
function lerp3(a: Vec3Tuple, b: Vec3Tuple, u: number): Vec3Tuple {
  const v = 1 - u;
  return [a[0] * v + b[0] * u, a[1] * v + b[1] * u, a[2] * v + b[2] * u];
}

// SPEC §6.7 step interpolation for `visible`: the value of the latest
// keyframe whose time is ≤ t takes effect. Before the first key, the first
// key's value holds (every animated part starts at "0.0" per §6.6, so this
// only matters defensively).
//
// The comparison is exact, like the segment selection the other three
// attributes use — `snapToKey` below is what makes that safe.
function stepVisible(keys: readonly ResolvedKey[], t: number): boolean {
  let v = keys[0]!.visible;
  for (const k of keys) {
    if (k.t <= t) v = k.visible;
    else break;
  }
  return v;
}

// SPEC §6.7: a wrapped time within a tolerance of a keyframe IS that
// keyframe's time, for every attribute at once.
//
// The wrap is the exact IEEE remainder, and that is not the same as the
// arithmetic one, because the dividend is not the number the author wrote:
// the double nearest `12.7` is 12.699999999999999289…, so its remainder mod
// a 6 s clip is 0.6999999999999993 and no formula recovers 0.7. In
// `models/windmill` that lands a few ULPs below the `"0.7"` key on every
// loop after the second. Read exactly, the interpolating attributes see
// u = 0.99999999999999905 — at the key for any purpose — while `visible`
// sees "not yet", so the sack vanished at t = 12.7, 18.7, 24.7 …
//
// So the tolerance is not a nicety, and it belongs HERE rather than inside
// one attribute's comparison: applied once, before anything reads `t`, it
// is what guarantees the four attributes answer the same question. (A 1e-9
// absolute tolerance used to sit inside `stepVisible` alone, undocumented,
// which is why removing it looked safe.)
//
// Scaled to the larger of the clock and the clip, because the error comes
// from the dividend's magnitude, not the remainder's — and then BOUNDED by a
// thousandth of the closest pair of keys, because that scaling is unbounded
// in the clock and the guarantee it is supposed to provide is not.
//
// Unbounded, the tolerance overtakes the thing it is measuring. Against a
// track keyed at 0.0 / 0.001 / 0.002, a clock at 1e9 gives eps = 1e-3 — a
// whole key spacing, so every sample snaps and the part stops moving. It
// also defeated the §6.7 clamp on a NON-LOOPING clip, where there is no wrap
// error to tolerate at all: at t = 1e308 the clamp correctly yields
// `duration`, and an eps of 1e296 then snapped that to "0.0" and returned
// the FIRST keyframe where the last must hold.
//
// A thousandth, not a half. Half the gap is the largest tolerance that
// cannot reach a NON-NEAREST key — but half-gap balls centred on the keys
// TILE the timeline, so at that bound every sample is within tolerance of
// something and interpolation disappears just as completely. Measured on the
// track above, `minGap / 2` left 2 distinct values across the whole clip at a
// clock of 1e9, where the unbounded form left 2 as well: the bound changed
// nothing at the case it was written for. A thousandth leaves 99.8% of each
// segment interpolating, and still covers the wrap error by three orders at
// any clock under ~4e9 seconds, which is a hundred and forty years.
//
// Past that the sample time has lost the precision to name a keyframe and no
// tolerance can recover it without destroying the interpolation it protects.
// That is a property of the double, not a choice made here.
function snapToKey(
  keys: readonly ResolvedKey[],
  t: number,
  time: number,
  duration: number,
): number {
  let minGap = Infinity;
  for (let i = 1; i < keys.length; i++) {
    const gap = keys[i]!.t - keys[i - 1]!.t;
    if (gap > 0 && gap < minGap) minGap = gap;
  }
  const eps = Math.min(
    Math.max(Math.abs(time), duration) * 1e-12,
    minGap * 1e-3, // Infinity for a single-key track: nothing to collide with
  );
  // Nearest key within the tolerance; ties keep the EARLIER one, since `keys`
  // is sorted ascending and the comparison only improves on a strict win. An
  // equidistant midpoint used to take the later key and jump a whole segment.
  let best = t;
  let bestDist = Infinity;
  for (const k of keys) {
    const d = Math.abs(k.t - t);
    if (d <= eps && d < bestDist) {
      bestDist = d;
      best = k.t;
    }
  }
  return best;
}

// SPEC §6.7: bring an arbitrary clock time inside a clip — a looping clip
// wraps (positive modulo, so a negative time lands inside too), a
// non-looping one holds at its ends. Whatever displays a position in a
// clip against a monotonic clock applies this, or the scrubber pegs at
// the end while the model carries on looping.
export function clampToClip(
  time: number,
  duration: number,
  loop: boolean,
): number {
  // `!(duration > 0)`, not `duration <= 0`: NaN fails both comparisons, and
  // a NaN duration reached the segment search as exactly the two failures the
  // non-finite `time` guard below was written to remove — a pose of NaNs from
  // a two-key track, an index past the end from a one-key one.
  if (!(duration > 0)) return 0;
  if (!loop) {
    // ±Infinity clamps to an end, which is the answer the rule already
    // gives; NaN has no position in a clip at all.
    return Number.isNaN(time) ? 0 : Math.min(Math.max(time, 0), duration);
  }
  // `Infinity % duration` is NaN, and a NaN time reaches the segment search
  // in samplePart as a comparison that is false either way: a two-key track
  // returned a pose of NaNs that then poisoned the whole rig, and a
  // one-key track indexed past the end and threw. Two failure modes for one
  // input, chosen by key count — and C# would raise on the second where
  // JavaScript returned `undefined`. 0 is the defined answer, as it already
  // is for a zero-length clip.
  if (!Number.isFinite(time)) return 0;
  const wrapped = time % duration;
  return wrapped < 0 ? wrapped + duration : wrapped;
}

// SPEC §6.7: sample one part's track at `time` (seconds). `rot`/`pos`/`scale`
// each interpolate along their own easing curve (the OUTGOING key's `ease`
// entry for that attribute, default linear); `visible` always steps.
// Out-of-range handling:
//   - loop: time wraps modulo duration; the tail interval (last key →
//     duration) interpolates toward the "0.0" keyframe (§6.7)
//   - no loop: time clamps to [0, duration]; values hold past the last key
export function samplePart(
  track: AnimationTrack,
  time: number,
  duration: number,
  loop: boolean,
): Pose {
  const keys = resolveTrack(track);
  if (keys.length === 0) return defaultPose();

  const first = keys[0]!;
  const last = keys[keys.length - 1]!;

  // The SAME wrap the scrubber applies. This used to be a second formula,
  // `time - Math.floor(time / duration) * duration`, which agrees with
  // clampToClip on round numbers and not otherwise: at time 5 in a 0.1s
  // clip it returns 0 where clampToClip returns 0.09999999999999973, a full
  // clip apart, so the UI reported the end of the loop while the model was
  // posed at the start. `%` is the exact IEEE remainder; the subtraction
  // form rounds twice, at the divide and at the multiply.
  const t = snapToKey(keys, clampToClip(time, duration, loop), time, duration);

  let rot: Vec3Tuple;
  let pos: Vec3Tuple;
  let scale: Vec3Tuple;

  if (t <= first.t) {
    rot = first.rot;
    pos = first.pos;
    scale = first.scale;
  } else if (t >= last.t) {
    if (loop && last.t < duration) {
      // §6.7 wrap interval: interpolate last → first across [last.t, duration]
      // along the last key's per-attribute ease (it is the segment's
      // outgoing key).
      const span = duration - last.t;
      const u = span > 0 ? (t - last.t) / span : 0;
      rot = lerp3(last.rot, first.rot, applyEasing(last.ease.rot, u));
      pos = lerp3(last.pos, first.pos, applyEasing(last.ease.pos, u));
      scale = lerp3(last.scale, first.scale, applyEasing(last.ease.scale, u));
    } else {
      rot = last.rot;
      pos = last.pos;
      scale = last.scale;
    }
  } else {
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1]!.t < t) i++;
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    rot = lerp3(a.rot, b.rot, applyEasing(a.ease.rot, u));
    pos = lerp3(a.pos, b.pos, applyEasing(a.ease.pos, u));
    scale = lerp3(a.scale, b.scale, applyEasing(a.ease.scale, u));
  }

  return { rot, pos, scale, visible: stepVisible(keys, t) };
}

// Sample every animated part of an inline animation at `time` (seconds).
// Returns a map from part name to Pose. Parts not present in the animation
// are absent from the map (the renderer treats them as rest pose). SPEC §6.8
// (animation targets a part the model lacks) is the renderer's concern — it
// simply has no part to apply the pose to.
export function sampleAnimation(
  anim: InlineAnimation,
  time: number,
): Map<string, Pose> {
  const out = new Map<string, Pose>();
  for (const [name, track] of Object.entries(anim.parts)) {
    out.set(name, samplePart(track, time, anim.duration, anim.loop));
  }
  return out;
}
