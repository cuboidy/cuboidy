using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

// SPEC §6.7 requires the expressions as written, so the check is numeric
// against the reference rather than "does it look like an ease".
//
// Every number below was PRINTED BY `applyEasing` from @cuboidy/core at the
// same eleven values of u. That is the only way hazard N9 is visible at all:
// `outBounce`'s `n1 * (u -= 1.5 / d1) * u + 0.75` still returns something
// monotonic and ease-shaped after being "tidied" into a temp, and
// `Math.Pow(x, 2)` still looks like `x * x`.
[TestFixture]
public class EasingTests
{
    private static readonly double[] Us =
    {
        0, 0.001, 0.1, 0.25, 1.0 / 3.0, 0.5, 0.625, 0.75, 0.9, 0.999, 1,
    };

    private static readonly Dictionary<string, double[]> Reference = new()
    {
        { "linear", new[] { 0.0, 0.001, 0.1, 0.25, 0.3333333333333333, 0.5, 0.625, 0.75, 0.9, 0.999, 1.0 } },
        { "step", new[] { 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0 } },
        { "in-sine", new[] { 0.0, 0.0000012337002964768473, 0.01231165940486223, 0.07612046748871326, 0.1339745962155613, 0.2928932188134524, 0.4444297669803977, 0.6173165676349102, 0.843565534959769, 0.9984292043191692, 1.0 } },
        { "out-sine", new[] { 0.0, 0.001570795680830879, 0.15643446504023087, 0.3826834323650898, 0.49999999999999994, 0.7071067811865475, 0.8314696123025452, 0.9238795325112867, 0.9876883405951378, 0.9999987662997035, 1.0 } },
        { "in-out-sine", new[] { 0.0, 0.000002467399070893439, 0.024471741852423234, 0.1464466094067262, 0.24999999999999994, 0.49999999999999994, 0.6913417161825448, 0.8535533905932737, 0.9755282581475768, 0.9999975326009292, 1.0 } },
        { "in-quad", new[] { 0.0, 0.000001, 0.010000000000000002, 0.0625, 0.1111111111111111, 0.25, 0.390625, 0.5625, 0.81, 0.998001, 1.0 } },
        { "out-quad", new[] { 0.0, 0.001998999999999973, 0.18999999999999995, 0.4375, 0.5555555555555555, 0.75, 0.859375, 0.9375, 0.99, 0.999999, 1.0 } },
        { "in-out-quad", new[] { 0.0, 0.000002, 0.020000000000000004, 0.125, 0.2222222222222222, 0.5, 0.71875, 0.875, 0.98, 0.999998, 1.0 } },
        { "in-cubic", new[] { 0.0, 1e-9, 0.0010000000000000002, 0.015625, 0.037037037037037035, 0.125, 0.244140625, 0.421875, 0.7290000000000001, 0.997002999, 1.0 } },
        { "out-cubic", new[] { 0.0, 0.002997000999999999, 0.2709999999999999, 0.578125, 0.7037037037037036, 0.875, 0.947265625, 0.984375, 0.999, 0.999999999, 1.0 } },
        { "in-out-cubic", new[] { 0.0, 4e-9, 0.004000000000000001, 0.0625, 0.14814814814814814, 0.5, 0.7890625, 0.9375, 0.996, 0.999999996, 1.0 } },
        { "in-back", new[] { 0.0, -0.00000169887842, -0.014314220000000004, -0.06413656250000001, -0.08900592592592592, -0.08769750000000004, -0.005114257812500078, 0.18259031249999969, 0.5911720200000001, 0.9953048204584196, 1.0 } },
        { "out-back", new[] { 0.0, 0.004695179541580385, 0.40882797999999987, 0.8174096875000002, 0.9557896296296295, 1.0876975, 1.0968185546875, 1.0641365625, 1.01431422, 1.00000169887842, 1.0 } },
        { "in-out-back", new[] { 0.0, -0.000005175439361999999, -0.037518552000000004, -0.09968184375, -0.0440673703703704, 0.5, 0.97151707421875, 1.09968184375, 1.0375185519999999, 1.000005175439362, 1.0 } },
        { "in-elastic", new[] { 0.0, -0.0004737348983368502, 0.001953125, -0.005524271728019902, 0.001709242143112897, -0.015625000000000045, 2.7306725379587635e-17, 0.08838834764831831, -0.24999999999999986, 0.9928746938417797, 1.0 } },
        { "out-elastic", new[] { 0.0, 0.007125306158220379, 1.25, 0.9116116523516816, 0.9239987653211588, 1.015625, 0.9886212866006096, 1.00552427172802, 0.998046875, 1.0004737348983368, 1.0 } },
        { "in-out-elastic", new[] { 0.0, 0.00009955315640743322, 0.000339156597005722, 0.011969444423734044, -0.002884348830593738, 0.5, 1.0830578780485842, 0.988030555576266, 0.9996608434029943, 0.9999004468435926, 1.0 } },
        { "in-bounce", new[] { 0.0, 0.0006799375000000607, 0.01187500000000008, 0.02734375, 0.13888888888888873, 0.234375, 0.03027343750000011, 0.52734375, 0.9243750000000001, 0.9999924375, 1.0 } },
        { "out-bounce", new[] { 0.0, 0.0000075625, 0.07562500000000001, 0.47265625, 0.8402777777777777, 0.765625, 0.7978515625, 0.97265625, 0.9881249999999999, 0.9993200624999999, 1.0 } },
        { "in-out-bounce", new[] { 0.0, 0.0006723750000000028, 0.030000000000000027, 0.1171875, 0.07986111111111105, 0.5, 0.736328125, 0.8828125, 0.97, 0.999327625, 1.0 } },
    };

    // The fourteen presets built only from +, -, *, / and `Math.Pow`. These
    // must be BIT-EXACT against the reference: both runtimes evaluate IEEE
    // doubles, so any difference is a difference in the expressions, which is
    // the whole of hazard N9. All three `bounce` presets are here, and they are
    // where the hazard actually lives.
    private static readonly HashSet<EasingName> PureArithmetic = new()
    {
        EasingName.Linear, EasingName.Step,
        EasingName.InQuad, EasingName.OutQuad, EasingName.InOutQuad,
        EasingName.InCubic, EasingName.OutCubic, EasingName.InOutCubic,
        EasingName.InBack, EasingName.OutBack, EasingName.InOutBack,
        EasingName.InBounce, EasingName.OutBounce, EasingName.InOutBounce,
    };

    // Distance in representable doubles. 0 means bit-identical.
    private static long Ulps(double a, double b)
    {
        if (a.Equals(b)) return 0;
        long ai = Order(BitConverter.DoubleToInt64Bits(a));
        long bi = Order(BitConverter.DoubleToInt64Bits(b));
        return Math.Abs(ai - bi);

        static long Order(long bits) => bits < 0 ? long.MinValue - bits : bits;
    }

    [Test]
    public void ArithmeticPresetsMatchTheReferenceBitForBit()
    {
        // No tolerance, on purpose. `outBounce`'s `n1 * (u -= 1.5 / d1) * u`
        // and `Math.Pow(x, 2)` both survive a "harmless" rewrite with a
        // plausible-looking curve; only an exact comparison fails on it, and
        // failing HERE beats failing three chunks later inside a mesh digest.
        var mismatches = new List<string>();

        foreach (EasingName preset in Enum.GetValues<EasingName>())
        {
            if (!PureArithmetic.Contains(preset)) continue;
            double[] expected = Reference[preset.ToWire()];
            for (int i = 0; i < Us.Length; i++)
            {
                double actual = Easing.ApplyEasing(preset, Us[i]);
                if (!actual.Equals(expected[i]))
                {
                    mismatches.Add(
                        $"{preset.ToWire()}({Us[i]:R}) = {actual:R}, reference {expected[i]:R} " +
                        $"({Ulps(actual, expected[i])} ulp)");
                }
            }
        }

        Assert.That(mismatches, Is.Empty, string.Join("\n", mismatches));
    }

    [Test]
    public void TranscendentalPresetsMatchTheReferenceToWithinTwoUlp()
    {
        // The six `sine` and `elastic` presets call `Math.Sin`, `Math.Cos` or
        // `Math.Pow(2, x)`, and neither IEEE 754 nor either language spec
        // requires a correctly-rounded result for those. MEASURED across all
        // 220 values in this table, V8 and .NET 8 differ on exactly four, all
        // of them a sine and all of them by ONE ulp:
        //
        //   out-sine(0.5)         .NET …5476   V8 …5475
        //   in-elastic(0.25)      .NET …19903  V8 …19902
        //   in-elastic(0.75)      .NET …31832  V8 …31831
        //   in-out-elastic(0.625) .NET …85844  V8 …85842
        //
        // This is what "Done means" is talking about when it says to compare
        // parsed doubles with a tolerance rather than strings, and it is why
        // the mesh digest is a regression check rather than a parity check.
        // The bound is 2, not "some": a real porting mistake in one of these
        // expressions moves a value far further than the last bit.
        var mismatches = new List<string>();
        int differing = 0;

        foreach (EasingName preset in Enum.GetValues<EasingName>())
        {
            if (PureArithmetic.Contains(preset)) continue;
            double[] expected = Reference[preset.ToWire()];
            for (int i = 0; i < Us.Length; i++)
            {
                double actual = Easing.ApplyEasing(preset, Us[i]);
                long ulps = Ulps(actual, expected[i]);
                if (ulps > 0) differing++;
                if (ulps > 2)
                {
                    mismatches.Add(
                        $"{preset.ToWire()}({Us[i]:R}) = {actual:R}, reference {expected[i]:R} ({ulps} ulp)");
                }
            }
        }

        Assert.That(mismatches, Is.Empty, string.Join("\n", mismatches));
        TestContext.Out.WriteLine($"{differing} of 66 transcendental values differ from the reference");
    }

    [Test]
    public void EveryReferenceRowIsStillReachable()
    {
        // The table is keyed by wire name; a renamed or removed preset would
        // otherwise leave a row silently unchecked.
        Assert.That(
            Enum.GetValues<EasingName>().Select(p => p.ToWire()).OrderBy(n => n, StringComparer.Ordinal),
            Is.EqualTo(Reference.Keys.OrderBy(n => n, StringComparer.Ordinal)));
    }

    [Test]
    public void TheEndpointsAreClampedRatherThanTrusted()
    {
        // Five of the twenty do not deliver their own endpoints: `in-sine(1)`
        // is 0.9999999999999999, `in-back(1)` is 0.9999999999999998,
        // `out-back(0)` is 2.220446049250313e-16, and `in-out-sine(0)` is -0.
        // Each is exactly where an author placed a value and expects to see it.
        foreach (EasingName preset in Enum.GetValues<EasingName>())
        {
            Assert.That(Easing.ApplyEasing(preset, 0), Is.EqualTo(0.0), preset.ToWire());
            Assert.That(Easing.ApplyEasing(preset, 1), Is.EqualTo(1.0), preset.ToWire());
        }
    }

    [Test]
    public void NegativeZeroIsNormalizedAtTheStart()
    {
        // `1 / applyEasing(...)` distinguishes 0 from -0; equality does not.
        double result = Easing.ApplyEasing(EasingName.InOutSine, -0.0);
        Assert.That(double.IsNegative(result), Is.False, "-0 must come back as +0");
    }

    [Test]
    public void TheTwentyNamesAreTheSpecOnesInOrder()
    {
        Assert.That(Easing.EasingNames, Is.EqualTo(new[]
        {
            "linear", "step",
            "in-sine", "out-sine", "in-out-sine",
            "in-quad", "out-quad", "in-out-quad",
            "in-cubic", "out-cubic", "in-out-cubic",
            "in-back", "out-back", "in-out-back",
            "in-elastic", "out-elastic", "in-out-elastic",
            "in-bounce", "out-bounce", "in-out-bounce",
        }));
        Assert.That(Easing.DefaultEasing, Is.EqualTo(EasingName.Linear));
    }

    [Test]
    public void TheEnumAndTheNameListCannotDrift()
    {
        // The enum's numeric value IS its index in `EasingNames`, which is what
        // makes `ToWire` a lookup rather than a switch that can go stale.
        EasingName[] presets = Enum.GetValues<EasingName>();
        Assert.That(presets.Length, Is.EqualTo(Easing.EasingNames.Count));
        for (int i = 0; i < presets.Length; i++)
        {
            Assert.That((int)presets[i], Is.EqualTo(i));
            Assert.That(presets[i].ToWire(), Is.EqualTo(Easing.EasingNames[i]));
            Assert.That(Easing.TryParseWire(Easing.EasingNames[i], out EasingName back), Is.True);
            Assert.That(back, Is.EqualTo(presets[i]));
        }
    }

    [Test]
    [NonParallelizable]
    public void PresetNamesAreMatchedOrdinally()
    {
        // Hazard S4: `in-sine` and `in-elastic` both start with an `i`, and
        // half these names contain one. A culture-sensitive lookup under tr-TR
        // is the kind of failure that only shows on one user's machine.
        using (new CultureScope(CultureScope.DotlessI))
        {
            Assert.That(Easing.TryParseWire("in-sine", out EasingName preset), Is.True);
            Assert.That(preset, Is.EqualTo(EasingName.InSine));
            Assert.That(Easing.TryParseWire("IN-SINE", out _), Is.False);
            Assert.That(Easing.TryParseWire("in-sıne", out _), Is.False);
        }
    }

    [Test]
    public void AnUnknownNameDoesNotParse()
    {
        Assert.That(Easing.TryParseWire("nope", out _), Is.False);
        Assert.That(Easing.TryParseWire("", out _), Is.False);
    }

    [Test]
    public void StepHoldsAcrossTheOpenIntervalAndLandsAtTheNextKey()
    {
        // SPEC §6.7 step interpolation for continuous attributes.
        Assert.That(Easing.ApplyEasing(EasingName.Step, 0.999999), Is.EqualTo(0.0));
        Assert.That(Easing.ApplyEasing(EasingName.Step, 1), Is.EqualTo(1.0));
    }

    [Test]
    public void TheOvershootingPresetsDoLeaveTheUnitInterval()
    {
        // `back` / `elastic` / `bounce` intentionally overshoot; the lerp
        // extrapolates, which is meaningful for rot/pos/scale. A port that
        // clamped the interior would look correct and animate wrong.
        Assert.That(Easing.ApplyEasing(EasingName.InBack, 0.5), Is.LessThan(0));
        Assert.That(Easing.ApplyEasing(EasingName.OutBack, 0.5), Is.GreaterThan(1));
        Assert.That(Easing.ApplyEasing(EasingName.OutElastic, 0.1), Is.GreaterThan(1));
    }
}
