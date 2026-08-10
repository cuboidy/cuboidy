using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Cuboidy.Runtime;

namespace Cuboidy.Tests;

// The C# half of the acceptance criterion's runtime check. Emits the same
// `transform` and `socket` lines `cuboidy-query --transforms --sockets` does,
// so the two can be compared number for number.
//
// This lives in the TEST assembly on purpose. `cuboidy-query` is an author's
// tool and stays TypeScript; what the library owes is the numbers, not the
// text around them.
internal static class ParityFormat
{
    // `num.ts` is not ported, and this is the one thing in it that a harness
    // needs. Hazards N3 and N4 both live in these three lines:
    //
    //   N3  JavaScript's `Math.round` is half toward +∞. C#'s `Math.Round` is
    //       banker's and `MidpointRounding.AwayFromZero` differs on negatives,
    //       so neither is a translation of it. `Math.Floor(n * 1e6 + 0.5)` is.
    //   N4  `round6` can return -0, which JavaScript prints as "0" and .NET
    //       prints as "-0". Folded before formatting.
    public static double Round6(double n) => Math.Floor(n * 1e6 + 0.5) / 1e6;

    // Every printed number goes through here: rounded to the 1e-6 grid the
    // world coordinates already use, with -0 folded to 0, and a fixed 6
    // decimals so the text form never switches to exponent notation.
    // InvariantCulture, always — hazard N2, where `de-DE` would print "0,5".
    public static string Num(double n)
    {
        double r = Round6(n);
        if (r == 0) r = 0;
        return r.ToString("F6", CultureInfo.InvariantCulture);
    }

    private static string Vec(Vec3 v) => $"{Num(v.X)},{Num(v.Y)},{Num(v.Z)}";

    private static string Quat(Quat q) => $"{Num(q.X)},{Num(q.Y)},{Num(q.Z)},{Num(q.W)}";

    // SPEC §6.3 clips in both forms, flattened to one map so nothing branches
    // on whether the author wrote the animation inline or pointed at a file.
    // External entries come second only because a clip name cannot be both.
    public static OrderedMap<InlineAnimation> ClipsOf(CuboidyPackage pkg)
    {
        var clips = new List<KeyValuePair<string, InlineAnimation>>();
        foreach (KeyValuePair<string, Animation> entry in pkg.Manifest.Animations)
        {
            if (entry.Value.Inline is { } inline)
            {
                clips.Add(new KeyValuePair<string, InlineAnimation>(entry.Key, inline));
            }
        }

        foreach (KeyValuePair<string, ExternalAnimation> entry in pkg.Project.ExternalAnims)
        {
            clips.Add(new KeyValuePair<string, InlineAnimation>(entry.Key, entry.Value.Anim));
        }

        return OrderedMap<InlineAnimation>.From(clips);
    }

    // `clip` null for the rest pose, which is the same call with nothing
    // sampled — one implementation of the hierarchy math.
    public static List<string> TransformsAndSockets(CuboidyPackage pkg, string? clip, double time)
    {
        OrderedMap<Pose> poses = OrderedMap<Pose>.Empty;
        if (clip is not null)
        {
            OrderedMap<InlineAnimation> clips = ClipsOf(pkg);
            if (!clips.TryGetValue(clip, out InlineAnimation? animation))
            {
                throw new ArgumentException($"model has no animation \"{clip}\"", nameof(clip));
            }

            poses = Sampler.SampleAnimation(animation, time);
        }

        OrderedMap<Frame> world = RigTransform.ComputeWorldTransforms(
            pkg.Manifest.Parts, RigTransform.PivotRotsOf(pkg.Project.Parts), poses);

        var lines = new List<string>();
        foreach (KeyValuePair<string, Frame> entry in world)
        {
            // A part's whole §6.5 pose, not just the rigid half. `scale` and
            // `visible` are deliberately outside the frame — scale is local and
            // does not propagate to children, visibility is a draw decision —
            // and that is exactly why they need printing: nothing else in the
            // acceptance contract can see them. Measured before they were here,
            // a port that never implemented step-visible, or that applied scale
            // in world axes after the rotation instead of about the pivot
            // before it, produced byte-identical output for every model, every
            // clip and every sample time.
            bool posed = poses.TryGetValue(entry.Key, out Pose pose);
            Vec3 scale = posed ? pose.Scale : new Vec3(1, 1, 1);
            bool visible = !posed || pose.Visible;
            lines.Add(
                $"transform {entry.Key} pos={Vec(entry.Value.Pos)} quat={Quat(entry.Value.Quat)} " +
                $"scale={Vec(scale)} visible={(visible ? 1 : 0)}");
        }

        OrderedMap<Frame> frames = SocketFrame.PublishedSocketFrames(
            pkg.Manifest, pkg.Project.Parts, poses);

        if (frames.Count == 0)
        {
            lines.Add("sockets: (model publishes none)");
            return lines;
        }

        // ORDINAL. `Array.prototype.sort()` with no comparator is specified to
        // compare UTF-16 code units; .NET's default string comparer — including
        // `OrderBy(x => x)` — is culture-sensitive, and hazard S6 measured it
        // reordering every one of `--mesh-faces`' 608 lines under ja-JP.
        foreach (string name in frames.Keys.OrderBy(n => n, StringComparer.Ordinal))
        {
            Frame f = frames[name];
            lines.Add($"socket {name} pos={Vec(f.Pos)} quat={Quat(f.Quat)}");
        }

        return lines;
    }
}
