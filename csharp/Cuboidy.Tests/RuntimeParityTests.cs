using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

// The runtime half of the acceptance contract.
//
// There are no fixtures for it — a pose is a number, not a diagnostic — so it
// is checked against TypeScript NUMERICALLY, exactly as
// `docs/csharp-implementation.md` describes:
//
//   cuboidy-query <model> --transforms --sockets [--anim=<clip> --time=<s>]
//   t = k·duration/24   for k = -1 … 25
//
// `parity/runtime.txt` is that command's own output, over every shipped model,
// every clip it defines, and every one of those 27 sample times — produced by
// driving `runQuery` in-process, so the lines come from the code the criterion
// names. Regenerate it with `npm run -w @cuboidy/core dump:parity`.
//
// SAMPLE TIMES ARE PART OF THE CRITERION, because detection is
// sampling-dependent: a wrong `outBounce` threshold shows at 241 samples per
// clip and not at 9. k = -1 and k = 25 are there to cover one step outside the
// clip in each direction, where a looping clip must wrap and a non-looping one
// must hold.
//
// Compared as PARSED DOUBLES with a tolerance, never as strings: the two
// runtimes' trig differs in the last bits (measured on the easing table: four
// of 220 values, all sines, one ulp each), and .NET renders negative zero as
// "-0" where JavaScript renders "0".
[TestFixture]
public class RuntimeParityTests
{
    // Two steps of the 1e-6 grid every printed number is already quantized to.
    // Not "some": a real porting mistake — a dropped `pivot.rot`, a swapped
    // quaternion product, Euler XYZ instead of ZXY — moves a coordinate by
    // whole voxels or flips a sign.
    private const double Tolerance = 2e-6;

    private static string ParityFile =>
        Path.Combine(TestContext.CurrentContext.TestDirectory, "parity", "runtime.txt");

    private static Dictionary<string, List<string>> ReadReference()
    {
        Assert.That(File.Exists(ParityFile), Is.True,
            $"{ParityFile} is missing — regenerate it with `npm run -w @cuboidy/core dump:parity`");

        var sections = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        List<string>? current = null;
        foreach (string raw in File.ReadLines(ParityFile))
        {
            string line = raw.TrimEnd('\r');
            if (line.StartsWith("## ", StringComparison.Ordinal))
            {
                current = new List<string>();
                sections[line.Substring(3)] = current;
                continue;
            }

            if (line.Length == 0) continue;
            Assert.That(current, Is.Not.Null, "a line before the first section header");
            current!.Add(line);
        }

        return sections;
    }

    private static List<(string Label, List<string> Lines)> Produce()
    {
        var produced = new List<(string, List<string>)>();
        foreach (string dir in Directory.GetDirectories(TestPaths.ModelsDir)
                     .OrderBy(d => d, StringComparer.Ordinal))
        {
            string model = Path.GetFileName(dir);
            Result<CuboidyPackage> loaded = PackageLoader.LoadDirectory(dir);
            Assert.That(loaded.Ok, Is.True, () => $"{model}: {loaded.Message}");
            CuboidyPackage pkg = loaded.Value;

            produced.Add(($"{model} rest", ParityFormat.TransformsAndSockets(pkg, null, 0)));

            OrderedMap<InlineAnimation> clips = ParityFormat.ClipsOf(pkg);
            foreach (string clip in clips.Keys.OrderBy(c => c, StringComparer.Ordinal))
            {
                double duration = clips[clip].Duration;
                for (int k = -1; k <= 25; k++)
                {
                    produced.Add((
                        $"{model} {clip} k={k}",
                        ParityFormat.TransformsAndSockets(pkg, clip, (k * duration) / 24)));
                }
            }
        }

        return produced;
    }

    [Test]
    public void EveryTransformAndSocketMatchesTheReference()
    {
        Dictionary<string, List<string>> reference = ReadReference();
        List<(string Label, List<string> Lines)> produced = Produce();

        var failures = new List<string>();
        int compared = 0;

        foreach ((string label, List<string> lines) in produced)
        {
            if (!reference.TryGetValue(label, out List<string>? expected))
            {
                failures.Add($"[{label}] has no section in the reference");
                continue;
            }

            if (expected.Count != lines.Count)
            {
                failures.Add($"[{label}] {lines.Count} lines, reference has {expected.Count}");
                continue;
            }

            for (int i = 0; i < lines.Count; i++)
            {
                string? problem = CompareLine(expected[i], lines[i]);
                if (problem is not null) failures.Add($"[{label}] {problem}");
                compared++;
            }
        }

        foreach (string label in reference.Keys)
        {
            if (!produced.Any(p => p.Label == label))
            {
                failures.Add($"[{label}] is in the reference and was not produced");
            }
        }

        Assert.That(failures, Is.Empty, string.Join("\n", failures.Take(40)));
        TestContext.Out.WriteLine(
            $"{compared} lines over {produced.Count} sections, tolerance {Tolerance:R}");
    }

    // Splits both lines into words, then into numbers where the word carries
    // them. Everything that is not a number must match EXACTLY — the part
    // name, the field names, `visible=0` — because none of it can drift by a
    // rounding.
    private static string? CompareLine(string expected, string actual)
    {
        string[] a = expected.Split(' ');
        string[] b = actual.Split(' ');
        if (a.Length != b.Length) return $"expected `{expected}` got `{actual}`";

        for (int i = 0; i < a.Length; i++)
        {
            if (string.Equals(a[i], b[i], StringComparison.Ordinal)) continue;

            int eqA = a[i].IndexOf('=');
            int eqB = b[i].IndexOf('=');
            if (eqA < 0 || eqA != eqB ||
                !string.Equals(a[i].Substring(0, eqA), b[i].Substring(0, eqB), StringComparison.Ordinal))
            {
                return $"expected `{expected}` got `{actual}`";
            }

            string[] na = a[i].Substring(eqA + 1).Split(',');
            string[] nb = b[i].Substring(eqB + 1).Split(',');
            if (na.Length != nb.Length) return $"expected `{expected}` got `{actual}`";

            for (int j = 0; j < na.Length; j++)
            {
                if (!double.TryParse(na[j], NumberStyles.Float, CultureInfo.InvariantCulture, out double va) ||
                    !double.TryParse(nb[j], NumberStyles.Float, CultureInfo.InvariantCulture, out double vb))
                {
                    return $"expected `{expected}` got `{actual}`";
                }

                if (Math.Abs(va - vb) > Tolerance)
                {
                    return $"{a[i].Substring(0, eqA)}[{j}] {vb:R} vs reference {va:R} " +
                           $"(Δ {Math.Abs(va - vb):R})\n    expected `{expected}`\n    got      `{actual}`";
                }
            }
        }

        return null;
    }

    [Test]
    public void TheReferenceCoversEveryModelAndEveryClip()
    {
        // A parity file that quietly lost half its sections would still pass
        // the comparison above for the half it kept.
        Dictionary<string, List<string>> reference = ReadReference();

        foreach (string dir in Directory.GetDirectories(TestPaths.ModelsDir))
        {
            string model = Path.GetFileName(dir);
            Assert.That(reference.ContainsKey($"{model} rest"), Is.True, model);

            CuboidyPackage pkg = PackageLoader.LoadDirectory(dir).Value;
            foreach (string clip in ParityFormat.ClipsOf(pkg).Keys)
            {
                foreach (int k in new[] { -1, 0, 12, 24, 25 })
                {
                    Assert.That(reference.ContainsKey($"{model} {clip} k={k}"), Is.True,
                        $"{model} {clip} k={k}");
                }
            }
        }
    }

    [Test]
    [NonParallelizable]
    public void TheNumberFormatIsInvariantAndFoldsNegativeZero()
    {
        // Hazards N2 and N4 in the harness itself, which is the one place the
        // port formats a double for comparison.
        using (new CultureScope(CultureScope.DecimalComma))
        {
            Assert.That(ParityFormat.Num(0.5), Is.EqualTo("0.500000"));
            Assert.That(ParityFormat.Num(-0.0), Is.EqualTo("0.000000"));
            Assert.That(ParityFormat.Num(-1e-9), Is.EqualTo("0.000000"));
            Assert.That(ParityFormat.Num(-1.5), Is.EqualTo("-1.500000"));
        }
    }

    [TestCase(0.5, 1.0)]
    [TestCase(1.5, 2.0)]
    [TestCase(2.5, 3.0)]
    [TestCase(-0.5, 0.0)]
    [TestCase(-1.5, -1.0)]
    [TestCase(-2.5, -2.0)]
    public void Round6IsHalfTowardPositiveInfinityLikeJavaScript(double sixthDecimalHalf, double expected)
    {
        // Hazard N3. `Math.Round` is banker's — 0.5 → 0, 2.5 → 2 — and
        // `MidpointRounding.AwayFromZero` gets the negatives wrong the other
        // way. Only `Math.Floor(n * 1e6 + 0.5) / 1e6` matches.
        double actual = ParityFormat.Round6(sixthDecimalHalf * 1e-6) * 1e6;
        Assert.That(actual, Is.EqualTo(expected).Within(1e-9));
    }
}
