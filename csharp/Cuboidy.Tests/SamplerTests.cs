using System;
using System.Collections.Generic;
using System.Linq;
using Cuboidy.Runtime;
using NUnit.Framework;

namespace Cuboidy.Tests;

// The parity sweep covers every shipped model at 27 sample times per clip, and
// it is blind to three things by construction: it prints six decimals, so a
// last-bit difference is invisible, and its clock never leaves the first loop.
// Every expectation below was MEASURED against `samplePart` / `clampToClip`
// from @cuboidy/core, and each one corresponds to a deliberate break the
// parity sweep did NOT catch.
[TestFixture]
public class SamplerTests
{
    private static AnimationTrack Track(params (string Key, Keyframe Frame)[] keys) =>
        new AnimationTrack(OrderedMap<Keyframe>.From(
            keys.Select(k => new KeyValuePair<string, Keyframe>(k.Key, k.Frame))));

    private static Keyframe Pos(double x) =>
        new Keyframe(null, new Vec3(x, 0, 0), null, null, null);

    private static Keyframe Visible(bool v) => new Keyframe(null, null, null, v, null);

    // ----- §6.7: a keyed value is hit EXACTLY at its keyframe -------------

    [Test]
    public void AKeyedValueIsReproducedBitForBitAtItsOwnKeyframe()
    {
        // The two textbook lerp forms differ on exactly this, and §6.7 names
        // the one that works:
        //
        //   a + (b − a)·u   is exact at u = 0 and NOT at u = 1
        //   a·(1 − u) + b·u is exact at both
        //
        // Measured: with a = 0.1 and b = -0.02, the first form returns
        // -0.020000000000000004. That is 4e-18 away — invisible at the six
        // decimals the parity sweep prints, and the reason this test exists
        // rather than being left to it. `fox/trot` keys the body at -0.02 and
        // read the wrong value back before the form was settled.
        AnimationTrack track = Track(("0.0", Pos(0.1)), ("1.0", Pos(-0.02)), ("2.0", Pos(0.3)));

        Pose at = Sampler.SamplePart(track, 1, 2, false);

        Assert.That(at.Pos.X, Is.EqualTo(-0.02), "not within a tolerance — exactly");
        Assert.That(at.Pos.X.Equals(-0.02), Is.True);
        Assert.That(0.1 + (-0.02 - 0.1) * 1.0, Is.Not.EqualTo(-0.02),
            "the control: the other form really does miss it here");
    }

    // ----- §6.7: the wrap is the exact IEEE remainder ---------------------

    [Test]
    public void TheWrapIsTheRemainderAndNotTheSubtractionForm()
    {
        // Measured: at time 5 in a 0.1 s clip the remainder gives
        // 0.09999999999999973 and `time - floor(time/duration)*duration` gives
        // 0 — a full clip apart, so the scrubber reported the end of the loop
        // while the model was posed at the start. The parity sweep never sees
        // it because its clock never leaves the first loop.
        double exact = Sampler.ClampToClip(5, 0.1, loop: true);

        Assert.That(exact, Is.EqualTo(0.09999999999999973));
        Assert.That(5 - Math.Floor(5 / 0.1) * 0.1, Is.EqualTo(0.0), "the control");
    }

    [TestCase(12.7, 6.0, 0.6999999999999993)]
    [TestCase(-0.25, 2.0, 1.75)]
    [TestCase(1e9, 6.0, 4.0)]
    public void ALoopingClipWrapsPositively(double time, double duration, double expected)
    {
        Assert.That(Sampler.ClampToClip(time, duration, loop: true), Is.EqualTo(expected));
    }

    [TestCase(5.0, 0.1, 0.1)]
    [TestCase(-1.0, 2.0, 0.0)]
    public void ANonLoopingClipHoldsAtItsEnds(double time, double duration, double expected)
    {
        Assert.That(Sampler.ClampToClip(time, duration, loop: false), Is.EqualTo(expected));
    }

    [Test]
    public void ADegenerateClockOrClipHasTheDefinedAnswerRatherThanARaise()
    {
        // `!(duration > 0)`, not `duration <= 0`: NaN fails both comparisons.
        // A NaN time used to reach the segment search as a comparison false
        // either way — a pose of NaNs from a two-key track, an index past the
        // end from a one-key one, and C# raises where JavaScript returned
        // `undefined`.
        Assert.That(Sampler.ClampToClip(1, 0, loop: true), Is.EqualTo(0));
        Assert.That(Sampler.ClampToClip(1, double.NaN, loop: true), Is.EqualTo(0));
        Assert.That(Sampler.ClampToClip(double.PositiveInfinity, 2, loop: true), Is.EqualTo(0));
        Assert.That(Sampler.ClampToClip(double.NaN, 2, loop: false), Is.EqualTo(0));

        AnimationTrack one = Track(("0.0", Pos(3)));
        Assert.That(() => Sampler.SamplePart(one, double.NaN, 2, true), Throws.Nothing);
        Assert.That(Sampler.SamplePart(one, double.NaN, 2, true).Pos.X, Is.EqualTo(3));
    }

    // ----- §6.7: a wrapped time within tolerance of a key IS that key -----

    [Test]
    public void AWrappedTimeAFewUlpsBelowAKeySnapsToIt()
    {
        // The double nearest 12.7 is 12.699999999999999289…, so its remainder
        // mod a 6 s clip is 0.6999999999999993 and no formula recovers 0.7.
        // Read exactly, the interpolating attributes see u = 0.99999999999999905
        // — at the key for any purpose — while `visible` sees "not yet", so
        // `models/windmill`'s sack vanished at t = 12.7, 18.7, 24.7 …
        //
        // Measured on the reference: `false` at every one of these.
        AnimationTrack track = Track(("0.0", Visible(true)), ("0.7", Visible(false)));

        foreach (double t in new[] { 0.7, 6.7, 12.7, 18.7, 24.7 })
        {
            Assert.That(Sampler.SamplePart(track, t, 6, loop: true).Visible, Is.False, $"t={t}");
        }
    }

    [Test]
    public void TheSnapToleranceIsBoundedSoInterpolationSurvivesAHugeClock()
    {
        // "A thousandth, not a half." Unbounded, the tolerance overtakes the
        // thing it measures: against a track keyed at 0.0 / 0.001 / 0.002, a
        // clock at 1e9 gives eps = 1e-3 — a whole key spacing, so every sample
        // snaps and the part stops moving. Half the gap tiles the timeline and
        // does the same. A thousandth leaves 99.8% of each segment
        // interpolating.
        AnimationTrack track = Track(("0.0", Pos(0)), ("0.001", Pos(1)), ("0.002", Pos(2)));

        var distinct = new HashSet<double>();
        for (int i = 0; i <= 200; i++)
        {
            distinct.Add(Sampler.SamplePart(track, 1e9 + i * 0.00001, 0.002, loop: true).Pos.X);
        }

        // With the bound in place every sample but a handful interpolates.
        // Without it, eps reaches 1e-3 — the whole key spacing — and the only
        // values left are the three keys'.
        Assert.That(distinct.Count, Is.GreaterThan(10),
            "an unbounded or half-gap tolerance leaves only the key values");
    }

    // ----- §6.5 carryover and §6.7 segments -------------------------------

    [Test]
    public void AnOmittedFieldInheritsFromThePreviousKeyframeAndNotFromTheDefault()
    {
        AnimationTrack track = Track(
            ("0.0", new Keyframe(null, new Vec3(5, 6, 7), new Vec3(2, 2, 2), false, null)),
            ("1.0", new Keyframe(new Vec3(90, 0, 0), null, null, null, null)));

        Pose at = Sampler.SamplePart(track, 1, 1, loop: false);

        Assert.That(at.Pos, Is.EqualTo(new Vec3(5, 6, 7)));
        Assert.That(at.Scale, Is.EqualTo(new Vec3(2, 2, 2)));
        Assert.That(at.Visible, Is.False);
        Assert.That(at.Rot, Is.EqualTo(new Vec3(90, 0, 0)));
    }

    [Test]
    public void EaseIsExemptFromCarryover()
    {
        // A curve set on one key must not silently reshape later segments.
        AnimationTrack track = Track(
            ("0.0", new Keyframe(null, new Vec3(0, 0, 0), null, null,
                new EaseMap(null, EasingName.Step, null))),
            ("1.0", Pos(10)),
            ("2.0", new Keyframe(null, new Vec3(20, 0, 0), null, null, null)));

        // Segment 0→1 steps: it holds at 0 across the open interval.
        Assert.That(Sampler.SamplePart(track, 0.5, 2, false).Pos.X, Is.EqualTo(0));
        // Segment 1→2 is linear, because `step` did not carry over.
        Assert.That(Sampler.SamplePart(track, 1.5, 2, false).Pos.X, Is.EqualTo(15));
    }

    [Test]
    public void TheTailIntervalOfALoopingClipInterpolatesTowardTheFirstKey()
    {
        // §6.7's wrap interval: [last key, duration] runs last → first, along
        // the LAST key's ease (it is the segment's outgoing key).
        AnimationTrack track = Track(("0.0", Pos(0)), ("1.0", Pos(10)));

        Assert.That(Sampler.SamplePart(track, 1.5, 2, loop: true).Pos.X, Is.EqualTo(5));
        // A non-looping clip HOLDS instead.
        Assert.That(Sampler.SamplePart(track, 1.5, 2, loop: false).Pos.X, Is.EqualTo(10));
    }

    [Test]
    public void AnEmptyTrackIsTheDefaultPose()
    {
        Assert.That(Sampler.SamplePart(Track(), 0, 1, false), Is.EqualTo(Pose.Default));
        Assert.That(Pose.Default,
            Is.EqualTo(new Pose(new Vec3(0, 0, 0), new Vec3(0, 0, 0), new Vec3(1, 1, 1), true)));
    }

    [Test]
    public void KeysOutOfOrderAreSortedStablyRatherThanTrusted()
    {
        // `samplePart` documents itself as tolerating input the §6.6 validation
        // would have rejected. Hazard N8: `List<T>.Sort` is introsort and not
        // stable; hazard N7: a `Comparison<T>` returning `a.T - b.T` truncates
        // to `int`, so every pair of keys under a second apart compares equal
        // and the sort silently does nothing.
        AnimationTrack track = Track(("0.5", Pos(10)), ("0.0", Pos(0)), ("0.25", Pos(5)));

        Assert.That(Sampler.SamplePart(track, 0.0, 1, false).Pos.X, Is.EqualTo(0));
        Assert.That(Sampler.SamplePart(track, 0.25, 1, false).Pos.X, Is.EqualTo(5));
        Assert.That(Sampler.SamplePart(track, 0.5, 1, false).Pos.X, Is.EqualTo(10));
    }

    [Test]
    public void SampleAnimationKeepsDocumentOrderAndOmitsUntargetedParts()
    {
        var animation = new InlineAnimation(1, true, OrderedMap<AnimationTrack>.From(new[]
        {
            new KeyValuePair<string, AnimationTrack>("zap", Track(("0.0", Pos(1)))),
            new KeyValuePair<string, AnimationTrack>("anchor", Track(("0.0", Pos(2)))),
        }));

        OrderedMap<Pose> poses = Sampler.SampleAnimation(animation, 0);

        Assert.That(poses.Keys, Is.EqualTo(new[] { "zap", "anchor" }));
        Assert.That(poses.ContainsKey("elsewhere"), Is.False);
    }
}
