// The second half of ts/packages/core/src/animation.ts: the renderer-agnostic
// sampler. `Animation.cs` holds the first half — the §6.3–6.6 schema the
// manifest reader shares.
//
// One file there, two here, because the namespace boundary the plan document
// draws (reading is `Cuboidy`, runtime is `Cuboidy.Runtime`) runs straight
// through that module and a C# file carries one file-scoped namespace.
//
// Poses are emitted in the SPEC's native units (rot = Euler degrees, ZXY
// intrinsic per §4; pos = voxel-unit delta; scale = per-axis multiplier). The
// sampler never touches matrices or quaternions — that conversion is the
// renderer's job.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Cuboidy.Runtime;

// A fully-resolved part pose at one instant. All fields concrete (carryover
// and interpolation already applied). Units per SPEC §6.5.
//
// This is the ONE pose type. The reference used to declare two narrower views
// of it — `AnimPose` (rot/pos) and `PosedPart` (plus an optional scale) —
// which a `Map<string, Pose>` satisfied for free, twice over: by structural
// typing, and by the map being covariant in its value type. C# has neither.
// `IReadOnlyDictionary<K, V>` is invariant in `V`, so a `Dictionary<string,
// Pose>` is not passable where a `PosedPart` map is expected even with
// inheritance in place — and inheritance was blocked anyway, because
// `Pose.Scale` is required where `PosedPart.scale` was optional (hazard T4).
public readonly record struct Pose(Vec3 Rot, Vec3 Pos, Vec3 Scale, bool Visible)
{
    // SPEC §6.5 first-keyframe defaults.
    public static Pose Default => new Pose(
        new Vec3(0, 0, 0), new Vec3(0, 0, 0), new Vec3(1, 1, 1), true);
}

public static class Sampler
{
    // The curves of the segment LEAVING a key, one per interpolating
    // attribute, resolved to concrete names (absent map entries → linear). No
    // carryover.
    private readonly record struct ResolvedEase(EasingName Rot, EasingName Pos, EasingName Scale);

    private readonly record struct ResolvedKey(double T, Pose Pose, ResolvedEase Ease);

    // SPEC §6.5 carryover + §6.6 ordering: parse the time keys to numbers, drop
    // non-numeric keys defensively, sort ascending, then fill each keyframe's
    // omitted VALUE fields from the previous resolved keyframe (the first from
    // the §6.5 defaults). `ease` is exempt from carryover: each key's outgoing
    // curves come only from its own map. The result is a dense, time-sorted
    // pose list.
    private static List<ResolvedKey> ResolveTrack(AnimationTrack track)
    {
        var timed = new List<(double T, Keyframe Frame)>();
        foreach (KeyValuePair<string, Keyframe> entry in track.Keys)
        {
            // InvariantCulture — hazard N2, and the second of the two
            // string→double conversions in the whole closure.
            if (!double.TryParse(
                    entry.Key, NumberStyles.Float, CultureInfo.InvariantCulture, out double t))
            {
                continue;
            }

            if (double.IsNaN(t) || double.IsInfinity(t)) continue;
            timed.Add((t, entry.Value));
        }

        // `OrderBy`, not `List<T>.Sort` — hazard N8: `Array.prototype.sort` has
        // been stable since ES2019 and `List<T>.Sort` is introsort, which is
        // not. Reachable for keyframes that bypassed validation, which this
        // function documents itself as tolerating. And hazard N7: a
        // `Comparison<T>` returning `a.T - b.T` truncates to `int`, so every
        // pair of keys under one second apart would compare equal and the sort
        // would silently do nothing.
        List<(double T, Keyframe Frame)> sorted = timed.OrderBy(e => e.T).ToList();

        var keys = new List<ResolvedKey>(sorted.Count);
        Pose previous = Pose.Default;
        foreach ((double t, Keyframe kf) in sorted)
        {
            var resolved = new Pose(
                kf.Rot ?? previous.Rot,
                kf.Pos ?? previous.Pos,
                kf.Scale ?? previous.Scale,
                kf.Visible ?? previous.Visible);
            var ease = new ResolvedEase(
                kf.Ease?.Rot ?? Easing.DefaultEasing,
                kf.Ease?.Pos ?? Easing.DefaultEasing,
                kf.Ease?.Scale ?? Easing.DefaultEasing);
            keys.Add(new ResolvedKey(t, resolved, ease));
            previous = resolved;
        }

        return keys;
    }

    // SPEC §6.7 states that a keyed value is hit EXACTLY at its keyframe, and
    // means it literally. `ApplyEasing` clamping its endpoints is only half of
    // that promise: the interpolation itself has to reproduce the endpoints
    // too, and the two textbook forms differ on exactly that.
    //
    //   a + (b − a)·u   is exact at u = 0 and NOT at u = 1
    //   a·(1 − u) + b·u is exact at both
    //
    // Measured over the corpus, the first form misses 32 of 5970 segment
    // endpoints, and 36 of 3411 keyed components did not survive a round trip
    // through the sampler — `fox/trot` keys the body at `-0.02` and read back
    // `-0.01999999999999999`. The second form misses none, and §6.7 now names
    // it. Do not rewrite this as the first form.
    private static Vec3 Lerp3(Vec3 a, Vec3 b, double u)
    {
        double v = 1 - u;
        return new Vec3(a.X * v + b.X * u, a.Y * v + b.Y * u, a.Z * v + b.Z * u);
    }

    // SPEC §6.7 step interpolation for `visible`: the value of the latest
    // keyframe whose time is ≤ t takes effect. Before the first key, the first
    // key's value holds (every animated part starts at "0.0" per §6.6, so this
    // only matters defensively).
    //
    // The comparison is exact, like the segment selection the other three
    // attributes use — `SnapToKey` is what makes that safe.
    private static bool StepVisible(List<ResolvedKey> keys, double t)
    {
        bool v = keys[0].Pose.Visible;
        foreach (ResolvedKey k in keys)
        {
            if (k.T <= t) v = k.Pose.Visible;
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
    // is what guarantees the four attributes answer the same question.
    //
    // Scaled to the larger of the clock and the clip, because the error comes
    // from the dividend's magnitude, not the remainder's — and then BOUNDED by
    // a thousandth of the closest pair of keys, because that scaling is
    // unbounded in the clock and the guarantee it provides is not. Unbounded,
    // the tolerance overtakes the thing it is measuring: against a track keyed
    // at 0.0 / 0.001 / 0.002, a clock at 1e9 gives eps = 1e-3 — a whole key
    // spacing, so every sample snaps and the part stops moving.
    //
    // A thousandth, not a half. Half the gap is the largest tolerance that
    // cannot reach a NON-NEAREST key — but half-gap balls centred on the keys
    // TILE the timeline, so at that bound every sample is within tolerance of
    // something and interpolation disappears just as completely.
    private static double SnapToKey(List<ResolvedKey> keys, double t, double time, double duration)
    {
        double minGap = double.PositiveInfinity;
        for (int i = 1; i < keys.Count; i++)
        {
            double gap = keys[i].T - keys[i - 1].T;
            if (gap > 0 && gap < minGap) minGap = gap;
        }

        double eps = Math.Min(
            Math.Max(Math.Abs(time), duration) * 1e-12,
            minGap * 1e-3); // Infinity for a single-key track: nothing to collide with

        // Nearest key within the tolerance; ties keep the EARLIER one, since
        // `keys` is sorted ascending and the comparison only improves on a
        // strict win. An equidistant midpoint used to take the later key and
        // jump a whole segment.
        double best = t;
        double bestDist = double.PositiveInfinity;
        foreach (ResolvedKey k in keys)
        {
            double d = Math.Abs(k.T - t);
            if (d <= eps && d < bestDist)
            {
                bestDist = d;
                best = k.T;
            }
        }

        return best;
    }

    // SPEC §6.7: bring an arbitrary clock time inside a clip — a looping clip
    // wraps (positive modulo, so a negative time lands inside too), a
    // non-looping one holds at its ends.
    public static double ClampToClip(double time, double duration, bool loop)
    {
        // `!(duration > 0)`, not `duration <= 0`: NaN fails both comparisons,
        // and a NaN duration reached the segment search as exactly the two
        // failures the non-finite `time` guard below was written to remove.
        if (!(duration > 0)) return 0;
        if (!loop)
        {
            // ±Infinity clamps to an end, which is the answer the rule already
            // gives; NaN has no position in a clip at all.
            return double.IsNaN(time) ? 0 : Math.Min(Math.Max(time, 0), duration);
        }

        // `Infinity % duration` is NaN, and a NaN time reaches the segment
        // search as a comparison that is false either way: a two-key track
        // returned a pose of NaNs that then poisoned the whole rig, and a
        // one-key track indexed past the end and threw — which C# raises on
        // where JavaScript returned `undefined`. 0 is the defined answer, as it
        // already is for a zero-length clip.
        if (double.IsNaN(time) || double.IsInfinity(time)) return 0;
        double wrapped = time % duration;
        return wrapped < 0 ? wrapped + duration : wrapped;
    }

    // SPEC §6.7: sample one part's track at `time` (seconds). `rot`/`pos`/
    // `scale` each interpolate along their own easing curve (the OUTGOING key's
    // `ease` entry for that attribute, default linear); `visible` always steps.
    //
    //   loop:    time wraps modulo duration; the tail interval (last key →
    //            duration) interpolates toward the "0.0" keyframe (§6.7)
    //   no loop: time clamps to [0, duration]; values hold past the last key
    public static Pose SamplePart(AnimationTrack track, double time, double duration, bool loop)
    {
        List<ResolvedKey> keys = ResolveTrack(track);
        if (keys.Count == 0) return Pose.Default;

        ResolvedKey first = keys[0];
        ResolvedKey last = keys[keys.Count - 1];

        // The SAME wrap the scrubber applies. This used to be a second formula,
        // `time - Math.Floor(time / duration) * duration`, which agrees with
        // `ClampToClip` on round numbers and not otherwise: at time 5 in a 0.1s
        // clip it returns 0 where the clamp returns 0.09999999999999973, a full
        // clip apart. `%` is the exact IEEE remainder; the subtraction form
        // rounds twice, at the divide and at the multiply.
        double t = SnapToKey(keys, ClampToClip(time, duration, loop), time, duration);

        Vec3 rot;
        Vec3 pos;
        Vec3 scale;

        if (t <= first.T)
        {
            rot = first.Pose.Rot;
            pos = first.Pose.Pos;
            scale = first.Pose.Scale;
        }
        else if (t >= last.T)
        {
            if (loop && last.T < duration)
            {
                // §6.7 wrap interval: interpolate last → first across
                // [last.T, duration] along the last key's per-attribute ease
                // (it is the segment's outgoing key).
                double span = duration - last.T;
                double u = span > 0 ? (t - last.T) / span : 0;
                rot = Lerp3(last.Pose.Rot, first.Pose.Rot, Easing.ApplyEasing(last.Ease.Rot, u));
                pos = Lerp3(last.Pose.Pos, first.Pose.Pos, Easing.ApplyEasing(last.Ease.Pos, u));
                scale = Lerp3(last.Pose.Scale, first.Pose.Scale, Easing.ApplyEasing(last.Ease.Scale, u));
            }
            else
            {
                rot = last.Pose.Rot;
                pos = last.Pose.Pos;
                scale = last.Pose.Scale;
            }
        }
        else
        {
            int i = 0;
            while (i < keys.Count - 1 && keys[i + 1].T < t) i++;
            ResolvedKey a = keys[i];
            ResolvedKey b = keys[i + 1];
            double u = b.T > a.T ? (t - a.T) / (b.T - a.T) : 0;
            rot = Lerp3(a.Pose.Rot, b.Pose.Rot, Easing.ApplyEasing(a.Ease.Rot, u));
            pos = Lerp3(a.Pose.Pos, b.Pose.Pos, Easing.ApplyEasing(a.Ease.Pos, u));
            scale = Lerp3(a.Pose.Scale, b.Pose.Scale, Easing.ApplyEasing(a.Ease.Scale, u));
        }

        return new Pose(rot, pos, scale, StepVisible(keys, t));
    }

    // Sample every animated part of an inline animation at `time` (seconds).
    // Parts not present in the animation are ABSENT from the map (a renderer
    // treats them as rest pose). SPEC §6.8 — an animation targeting a part the
    // model lacks — is the renderer's concern: it simply has no part to apply
    // the pose to.
    public static OrderedMap<Pose> SampleAnimation(InlineAnimation animation, double time)
    {
        var poses = new List<KeyValuePair<string, Pose>>();
        foreach (KeyValuePair<string, AnimationTrack> entry in animation.Parts)
        {
            poses.Add(new KeyValuePair<string, Pose>(
                entry.Key, SamplePart(entry.Value, time, animation.Duration, animation.Loop)));
        }

        return OrderedMap<Pose>.From(poses);
    }
}
