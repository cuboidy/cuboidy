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
import { Identifier } from './identifier-schema.js';
import { refPath } from './ref-path.js';
import {
  DEFAULT_EASING,
  EASING_NAMES,
  applyEasing,
  type EasingName,
} from './easing.js';

const Vec3Tuple = z.tuple([z.number(), z.number(), z.number()]);

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
    rot: Vec3Tuple.optional(),
    pos: Vec3Tuple.optional(),
    scale: Vec3Tuple.optional(),
    visible: z.boolean().optional(),
    ease: EaseMapSchema.optional(),
  })
  .strict();

// SPEC §6.6: a part's keyframe sequence, keyed by decimal-string time keys
// ("0.0", "0.5", …). Key format / ordering / start-at-0 / ≤ duration are
// validated on the enclosing InlineAnimationSchema (they need `duration`);
// the sampler still tolerates unsorted input defensively.
export const AnimationTrackSchema = z.record(z.string(), KeyframeSchema);

// SPEC §6.4 / §6.6: an inline animation object, including the semantic
// rules the schema shape alone can't express — duration must be a
// positive finite number covering every time key, and each track's keys
// must be decimal-number strings starting at 0 and strictly increasing.
export const InlineAnimationSchema = z
  .object({
    duration: z.number(),
    loop: z.boolean(),
    parts: z.record(z.string(), AnimationTrackSchema),
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
      for (const key of Object.keys(track)) {
        const t = Number(key);
        if (key.trim() !== key || key === '' || !Number.isFinite(t)) {
          ctx.addIssue({
            code: 'custom',
            path: ['parts', part, key],
            message: `time key "${key}" is not a decimal number string`,
          });
          break;
        }
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

export type Vec3Tuple = [number, number, number];

// A fully-resolved part pose at one instant. All fields concrete (carryover
// + interpolation already applied). Units per SPEC §6.5.
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

function lerp3(a: Vec3Tuple, b: Vec3Tuple, u: number): Vec3Tuple {
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

// SPEC §6.7 step interpolation for `visible`: the value of the latest
// keyframe whose time is ≤ t takes effect. Before the first key, the first
// key's value holds (every animated part starts at "0.0" per §6.6, so this
// only matters defensively).
const EPS = 1e-9;
function stepVisible(keys: readonly ResolvedKey[], t: number): boolean {
  let v = keys[0]!.visible;
  for (const k of keys) {
    if (k.t <= t + EPS) v = k.visible;
    else break;
  }
  return v;
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
  if (duration <= 0) return 0;
  if (!loop) return Math.min(Math.max(time, 0), duration);
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

  let t: number;
  if (loop && duration > 0) {
    // Positive modulo (handles negative time too).
    t = time - Math.floor(time / duration) * duration;
  } else {
    t = Math.max(0, Math.min(time, duration));
  }

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
