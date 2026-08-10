// Port of ts/packages/core/src/easing.ts.
//
// SPEC §6.7: named easing presets for keyframe interpolation.
//
// An easing is a pure function u → u' remapping normalized segment progress
// (0 at the segment's start keyframe, 1 at the next keyframe) before linear
// interpolation. The presets follow the standard easings.net formulas.
// `back` / `elastic` / `bounce` intentionally leave [0,1] (overshoot); the
// lerp simply extrapolates, which is meaningful for rot/pos/scale.
// `step` reproduces §6.7 step interpolation for continuous attributes: the
// outgoing keyframe's value holds across the open interval and the next
// keyframe's value lands exactly at its time.
//
// ==> DO NOT TIDY THE FORMULAS BELOW. <==
//
// Hazard N9, and §6.7 requires the expressions as written. `outBounce`'s
// `n1 * (u -= 1.5 / d1) * u + 0.75` ports verbatim only while `u` is a MUTABLE
// value parameter: an `in double`, a readonly local, or lifting the subtraction
// into a temp changes the observable residue. `Math.Pow(x, 2)` is not
// guaranteed to equal `x * x` in the last bits on either runtime, so every
// `Math.pow` in the reference is a `Math.Pow` here and every `*` is a `*`.
// Interior values are NOT normalized — they are whatever these expressions
// produce — so an algebraically equivalent rewrite is a behavioural change.

using System;
using System.Collections.Generic;

namespace Cuboidy;

// Declared in EASING_NAMES order, so the enum's numeric value is its index in
// `EasingNames` and the two cannot drift apart.
public enum EasingName
{
    Linear,
    Step,
    InSine,
    OutSine,
    InOutSine,
    InQuad,
    OutQuad,
    InOutQuad,
    InCubic,
    OutCubic,
    InOutCubic,
    InBack,
    OutBack,
    InOutBack,
    InElastic,
    OutElastic,
    InOutElastic,
    InBounce,
    OutBounce,
    InOutBounce,
}

public static class Easing
{
    public static readonly IReadOnlyList<string> EasingNames = new[]
    {
        "linear",
        "step",
        "in-sine",
        "out-sine",
        "in-out-sine",
        "in-quad",
        "out-quad",
        "in-out-quad",
        "in-cubic",
        "out-cubic",
        "in-out-cubic",
        "in-back",
        "out-back",
        "in-out-back",
        "in-elastic",
        "out-elastic",
        "in-out-elastic",
        "in-bounce",
        "out-bounce",
        "in-out-bounce",
    };

    // SPEC §6.5: the default easing (also the first-keyframe carryover seed).
    public const EasingName DefaultEasing = EasingName.Linear;

    private static readonly Dictionary<string, EasingName> ByWire = BuildByWire();

    public static string ToWire(this EasingName name)
    {
        int index = (int)name;
        if (index < 0 || index >= EasingNames.Count)
        {
            throw new ArgumentOutOfRangeException(nameof(name), name, "unknown easing preset");
        }

        return EasingNames[index];
    }

    // Ordinal, never the current culture — hazard S4. Two of these names
    // contain an `i` and one contains an `I` after a hyphen.
    public static bool TryParseWire(string wire, out EasingName name) =>
        ByWire.TryGetValue(wire, out name);

    // easings.net constants.
    private const double C1 = 1.70158;             // back overshoot amount
    private const double C2 = C1 * 1.525;          // back in-out overshoot
    private const double C3 = C1 + 1;
    private static readonly double C4 = (2 * Math.PI) / 3;   // elastic period
    private static readonly double C5 = (2 * Math.PI) / 4.5; // elastic in-out period

    private static double OutBounce(double u)
    {
        const double n1 = 7.5625;
        const double d1 = 2.75;
        if (u < 1 / d1) return n1 * u * u;
        if (u < 2 / d1) return n1 * (u -= 1.5 / d1) * u + 0.75;
        if (u < 2.5 / d1) return n1 * (u -= 2.25 / d1) * u + 0.9375;
        return n1 * (u -= 2.625 / d1) * u + 0.984375;
    }

    // Remap normalized segment progress `u` through the named preset. Every
    // preset maps 0 → 0 and 1 → 1, so a keyed value is hit exactly at its
    // keyframe (SPEC §6.7).
    //
    // The endpoints are CLAMPED rather than trusted, because the formulas do
    // not deliver them: `in-sine(1)` is 0.9999999999999999, `in-back(1)` is
    // 0.9999999999999998, `out-back(0)` is 2.220446049250313e-16, and
    // `in-out-sine(0)` is -0. Five of the twenty presets, all landing exactly
    // where an author placed a value and expects to see it — and each one a
    // place a second implementation's trig could round the other way.
    public static double ApplyEasing(EasingName name, double u)
    {
        if (u == 0) return 0; // also normalizes -0
        if (u == 1) return 1;
        switch (name)
        {
            case EasingName.Linear: return u;
            case EasingName.Step: return u < 1 ? 0 : 1;

            case EasingName.InSine: return 1 - Math.Cos((u * Math.PI) / 2);
            case EasingName.OutSine: return Math.Sin((u * Math.PI) / 2);
            case EasingName.InOutSine: return -(Math.Cos(Math.PI * u) - 1) / 2;

            case EasingName.InQuad: return u * u;
            case EasingName.OutQuad: return 1 - (1 - u) * (1 - u);
            case EasingName.InOutQuad:
                return u < 0.5 ? 2 * u * u : 1 - Math.Pow(-2 * u + 2, 2) / 2;

            case EasingName.InCubic: return u * u * u;
            case EasingName.OutCubic: return 1 - Math.Pow(1 - u, 3);
            case EasingName.InOutCubic:
                return u < 0.5 ? 4 * u * u * u : 1 - Math.Pow(-2 * u + 2, 3) / 2;

            case EasingName.InBack: return C3 * u * u * u - C1 * u * u;
            case EasingName.OutBack:
                return 1 + C3 * Math.Pow(u - 1, 3) + C1 * Math.Pow(u - 1, 2);
            case EasingName.InOutBack:
                return u < 0.5
                    ? (Math.Pow(2 * u, 2) * ((C2 + 1) * 2 * u - C2)) / 2
                    : (Math.Pow(2 * u - 2, 2) * ((C2 + 1) * (u * 2 - 2) + C2) + 2) / 2;

            case EasingName.InElastic:
                return u == 0
                    ? 0
                    : u == 1
                        ? 1
                        : -Math.Pow(2, 10 * u - 10) * Math.Sin((u * 10 - 10.75) * C4);
            case EasingName.OutElastic:
                return u == 0
                    ? 0
                    : u == 1
                        ? 1
                        : Math.Pow(2, -10 * u) * Math.Sin((u * 10 - 0.75) * C4) + 1;
            case EasingName.InOutElastic:
                return u == 0
                    ? 0
                    : u == 1
                        ? 1
                        : u < 0.5
                            ? -(Math.Pow(2, 20 * u - 10) * Math.Sin((20 * u - 11.125) * C5)) / 2
                            : (Math.Pow(2, -20 * u + 10) * Math.Sin((20 * u - 11.125) * C5)) / 2 +
                              1;

            case EasingName.InBounce: return 1 - OutBounce(1 - u);
            case EasingName.OutBounce: return OutBounce(u);
            case EasingName.InOutBounce:
                return u < 0.5 ? (1 - OutBounce(1 - 2 * u)) / 2 : (1 + OutBounce(2 * u - 1)) / 2;

            default:
                throw new ArgumentOutOfRangeException(nameof(name), name, "unknown easing preset");
        }
    }

    private static Dictionary<string, EasingName> BuildByWire()
    {
        var map = new Dictionary<string, EasingName>(StringComparer.Ordinal);
        for (int i = 0; i < EasingNames.Count; i++) map[EasingNames[i]] = (EasingName)i;
        return map;
    }
}
