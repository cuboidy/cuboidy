using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

// The §7.4 half of the acceptance contract.
//
// `parity/mesh.txt` is `cuboidy-query --mesh` over all nine models, every clip,
// and the same 27 sample times the runtime file uses: a face count, a digest
// over the sorted face lines, and one `mesh-part` line per part carrying that
// part's material list IN THE NORMATIVE ORDER, its opaque face count, and
// whether the opaque/translucent index split holds.
//
// WHY THE DIGEST IS ENOUGH HERE, when the plan document says it is a
// regression check rather than a parity check: it is FNV-1a over text at six
// decimals, so a one-ulp difference anywhere flips it. The full `--mesh-faces`
// form was generated on both sides once and compared — 1,108,465 lines, 274 MB,
// BYTE-IDENTICAL — so for these two implementations the digest currently
// summarises an exact agreement rather than papering over a near one.
//
// If a future .NET or V8 moves a trig result and a digest changes while the
// `mesh-part` lines still agree, that is the expected failure mode and it is
// NOT a licence to relax this test. Regenerate the face form on both sides
// (`npx tsx scripts/dump-parity.ts <out> faces`) and diff it: the answer is
// either a real defect or a per-number tolerance on the offending model,
// stated as such.
//
// What is deliberately FREE, and verified free: the order faces come out in
// (they are sorted), the triangulation, the voxel walk, and which corner a
// quad's four are listed from — the corners are rotated to start at the
// lexicographically smallest, so the rectangle and its winding are compared and
// the table's starting index is not. What is NOT free, and this is a narrowing
// of what §7.4 permits: a mesher that MERGES faces fails this criterion.
[TestFixture]
public class MeshParityTests
{
    private static string ParityFile =>
        Path.Combine(TestContext.CurrentContext.TestDirectory, "parity", "mesh.txt");

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
            current!.Add(line);
        }

        return sections;
    }

    [Test]
    public void EveryFaceSetAndMaterialListMatchesTheReference()
    {
        Dictionary<string, List<string>> reference = ReadReference();
        var failures = new List<string>();
        int compared = 0;
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (string dir in Directory.GetDirectories(TestPaths.ModelsDir)
                     .OrderBy(d => d, StringComparer.Ordinal))
        {
            string model = Path.GetFileName(dir);
            CuboidyPackage pkg = PackageLoader.LoadDirectory(dir).Value;

            var sections = new List<(string Label, string? Clip, double Time)>
            {
                ($"{model} rest", null, 0),
            };

            OrderedMap<InlineAnimation> clips = ParityFormat.ClipsOf(pkg);
            foreach (string clip in clips.Keys.OrderBy(c => c, StringComparer.Ordinal))
            {
                double duration = clips[clip].Duration;
                for (int k = -1; k <= 25; k++)
                {
                    sections.Add(($"{model} {clip} k={k}", clip, (k * duration) / 24));
                }
            }

            foreach ((string label, string? clip, double time) in sections)
            {
                seen.Add(label);
                List<string> lines = ParityFormat.MeshLines(pkg, clip, time, withFaces: false);

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
                    if (!string.Equals(expected[i], lines[i], StringComparison.Ordinal))
                    {
                        failures.Add($"[{label}]\n    expected `{expected[i]}`\n    got      `{lines[i]}`");
                    }

                    compared++;
                }
            }
        }

        foreach (string label in reference.Keys)
        {
            if (!seen.Contains(label)) failures.Add($"[{label}] is in the reference and was not produced");
        }

        Assert.That(failures, Is.Empty, string.Join("\n", failures.Take(30)));
        TestContext.Out.WriteLine($"{compared} lines over {seen.Count} sections, compared exactly");
    }

    [Test]
    public void TheReferenceCarriesTheFaceCountsTheModelsActuallyHave()
    {
        // Measured at rest, so a corpus that lost a model or a mesher that
        // quietly started merging is visible as a number rather than as a
        // digest nobody can read.
        var expected = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["fox"] = 3256,
            ["herbalist"] = 1022,
            ["knight"] = 3244,
            ["koi"] = 1840,
            ["orrery"] = 150,
            ["owl"] = 3304,
            ["submersible"] = 2610,
            ["sword"] = 608,
            ["windmill"] = 10092,
        };

        Dictionary<string, List<string>> reference = ReadReference();
        foreach (KeyValuePair<string, int> entry in expected)
        {
            Assert.That(reference.ContainsKey($"{entry.Key} rest"), Is.True, entry.Key);
            string head = reference[$"{entry.Key} rest"][0];
            Assert.That(head, Does.StartWith($"mesh faces={entry.Value} digest="), entry.Key);
        }
    }

    [Test]
    [NonParallelizable]
    public void TheFaceSortIsUnaffectedByTheAmbientCulture()
    {
        // Hazard S6, and the one place in this suite where the hazard is real
        // and the test cannot prove it on this machine. Re-measured from here:
        // sorting models/sword's 608 face lines with a CULTURE comparer moves
        // 607 of them under NLS collation — for ja-JP, de-DE, tr-TR and en-US
        // alike, so the engine matters and the culture barely does — and moves
        // NONE of them under ICU, which is the .NET 8 default this runs on.
        //
        // So a port using `Comparer<string>.Default` would pass everything
        // here and then reorder its output on a machine running NLS. This test
        // is what fails there; on ICU it is a statement of intent.
        CuboidyPackage pkg = PackageLoader.LoadDirectory(
            Path.Combine(TestPaths.ModelsDir, "sword")).Value;
        string reference = ReadReference()["sword rest"][0];

        foreach (string culture in new[]
                 {
                     CultureScope.NonOrdinalSort, CultureScope.DecimalComma, CultureScope.DotlessI,
                 })
        {
            using (new CultureScope(culture))
            {
                Assert.That(ParityFormat.MeshLines(pkg, null, 0, withFaces: false)[0],
                    Is.EqualTo(reference), culture);
            }
        }
    }

    [Test]
    public void EveryPartsOpaqueSplitHolds()
    {
        // §7.4's draw-pass property, asserted directly rather than only through
        // the reference text: every index below `OpaqueIndexCount` belongs to an
        // opaque material and every index above it to a translucent one.
        foreach (string dir in Directory.GetDirectories(TestPaths.ModelsDir))
        {
            CuboidyPackage pkg = PackageLoader.LoadDirectory(dir).Value;
            foreach (string line in ParityFormat.MeshLines(pkg, null, 0, withFaces: false))
            {
                if (!line.StartsWith("mesh-part ", StringComparison.Ordinal)) continue;
                Assert.That(line, Does.Not.Contain("opaque-split=BROKEN"), $"{dir}: {line}");
            }
        }
    }
}
