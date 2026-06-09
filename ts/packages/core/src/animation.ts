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

const Vec3Tuple = z.tuple([z.number(), z.number(), z.number()]);

// SPEC §6.5: a single keyframe. Every field is optional — an omitted field
// inherits from the previous keyframe (carryover, resolved in resolveTrack).
// `.strict()` rejects typo'd field names (matches the manifest's strictness).
export const KeyframeSchema = z
  .object({
    rot: Vec3Tuple.optional(),
    pos: Vec3Tuple.optional(),
    scale: Vec3Tuple.optional(),
    visible: z.boolean().optional(),
  })
  .strict();

// SPEC §6.6: a part's keyframe sequence, keyed by decimal-string time keys
// ("0.0", "0.5", …). Key ordering / start-at-0 / ≤ duration are SPEC
// "planned" lint concerns (§11); the sampler tolerates unsorted input.
export const AnimationTrackSchema = z.record(z.string(), KeyframeSchema);

// SPEC §6.4: an inline animation object.
export const InlineAnimationSchema = z
  .object({
    duration: z.number(),
    loop: z.boolean(),
    parts: z.record(z.string(), AnimationTrackSchema),
  })
  .strict();

// SPEC §6.3: a value in the animation map is either an inline object or a
// string path to an external animation JSON file (§8). The editor viewer
// currently samples inline animations; string refs are carried but skipped.
export const AnimationSchema = z.union([InlineAnimationSchema, z.string()]);

// SPEC §5 / §6.3: animation names obey the identifier rule (regex + no
// reserved keyword), like model / part names. Keys are validated at parse
// time; the JSON Schema's propertyNames carries the same pattern + not.enum.
export const AnimationsSchema = z.record(Identifier, AnimationSchema);

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

interface ResolvedKey extends Pose {
  t: number; // time key parsed to seconds
}

// SPEC §6.5 carryover + §6.6 ordering: parse the time keys to numbers, drop
// non-numeric keys defensively, sort ascending, then fill each keyframe's
// omitted fields from the previous resolved keyframe (the first from the
// §6.5 defaults). The result is a dense, time-sorted pose list.
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
    out.push({ t, ...resolved });
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

// SPEC §6.7: sample one part's track at `time` (seconds). `rot`/`pos`/`scale`
// linearly interpolate; `visible` steps. Out-of-range handling:
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
      // §6.7 wrap interval: interpolate last → first across [last.t, duration].
      const span = duration - last.t;
      const u = span > 0 ? (t - last.t) / span : 0;
      rot = lerp3(last.rot, first.rot, u);
      pos = lerp3(last.pos, first.pos, u);
      scale = lerp3(last.scale, first.scale, u);
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
    rot = lerp3(a.rot, b.rot, u);
    pos = lerp3(a.pos, b.pos, u);
    scale = lerp3(a.scale, b.scale, u);
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
