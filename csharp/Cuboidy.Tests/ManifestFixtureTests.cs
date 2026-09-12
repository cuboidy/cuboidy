using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

// The cross-implementation contract for §6 and §6.10: every file under
// `fixtures/manifest/<code>/` and `fixtures/palette/<code>/` must fail with
// `<code>`. Compared by code alone, for the reason `fixtures/README.md` gives.
[TestFixture]
public class ManifestFixtureTests
{
    private static IEnumerable<TestCaseData> FixturesUnder(string kind)
    {
        string root = Path.Combine(TestPaths.FixturesDir, kind);
        foreach (string dir in Directory.GetDirectories(root).OrderBy(d => d, StringComparer.Ordinal))
        {
            string wire = Path.GetFileName(dir);
            foreach (string file in Directory.GetFiles(dir, "*.json").OrderBy(f => f, StringComparer.Ordinal))
            {
                yield return new TestCaseData(file, wire)
                    .SetName($"Reports_{wire.Replace('-', '_')}_for_{kind}_" +
                             $"{Path.GetFileNameWithoutExtension(file).Replace('-', '_')}");
            }
        }
    }

    public static IEnumerable<TestCaseData> ManifestFixtures() => FixturesUnder("manifest");

    public static IEnumerable<TestCaseData> PaletteFixtures() => FixturesUnder("palette");

    [TestCaseSource(nameof(ManifestFixtures))]
    public void AManifestFixtureReportsTheCodeItsDirectoryIsNamedAfter(string path, string wire)
    {
        Assert.That(CuboidyErrorCodeExtensions.TryParseWire(wire, out CuboidyErrorCode expected), Is.True);

        Result<Manifest> result = ManifestReader.ParseManifestText(File.ReadAllText(path));

        Assert.That(result.Ok, Is.False, $"{path} was accepted; it must fail with '{wire}'");
        Assert.That(
            result.Code, Is.EqualTo(expected),
            $"{path}: expected '{wire}', got '{result.Code.ToWire()}' — {result.Message}");
    }

    [TestCaseSource(nameof(PaletteFixtures))]
    public void APaletteFixtureReportsTheCodeItsDirectoryIsNamedAfter(string path, string wire)
    {
        Assert.That(CuboidyErrorCodeExtensions.TryParseWire(wire, out CuboidyErrorCode expected), Is.True);

        Result<IReadOnlyList<PaletteEntry>> result =
            PaletteFileReader.ParsePaletteFileText(File.ReadAllText(path));

        Assert.That(result.Ok, Is.False, $"{path} was accepted; it must fail with '{wire}'");
        Assert.That(
            result.Code, Is.EqualTo(expected),
            $"{path}: expected '{wire}', got '{result.Code.ToWire()}' — {result.Message}");
    }

    [Test]
    public void TheWholeNegativeCorpusIsFiftyTwoDocuments()
    {
        // geometry 20 + manifest 25 + palette 7. Both the plan document and
        // `fixtures/README.md` quote this count and both were stale within a
        // day of being written; a corpus that shrank without anyone noticing
        // is a contract that stopped testing something.
        int geometry = Count("geometry");
        int manifest = Count("manifest");
        int palette = Count("palette");

        Assert.That(geometry, Is.EqualTo(20), "fixtures/geometry");
        Assert.That(manifest, Is.EqualTo(25), "fixtures/manifest");
        Assert.That(palette, Is.EqualTo(7), "fixtures/palette");
        Assert.That(geometry + manifest + palette, Is.EqualTo(52));

        static int Count(string kind) => Directory
            .GetFiles(Path.Combine(TestPaths.FixturesDir, kind), "*.json", SearchOption.AllDirectories)
            .Length;
    }

    [Test]
    public void EveryShippedManifestLoads()
    {
        // The positive half. `resolveProject` is not here yet, so this is the
        // manifest alone — which is still the document with the most §6 rules
        // in it, and nine of them are real.
        foreach (string dir in Directory.GetDirectories(TestPaths.ModelsDir))
        {
            string path = Path.Combine(dir, "cuboidy.json");
            Assert.That(File.Exists(path), Is.True, path);

            Result<Manifest> result = ManifestReader.ParseManifestText(File.ReadAllText(path));
            Assert.That(result.Ok, Is.True, () => $"{path}: {result.Code.ToWire()} — {result.Message}");
            Assert.That(result.Value.Parts, Is.Not.Empty, path);
        }
    }

    [Test]
    public void EveryShippedPaletteFileLoads()
    {
        // Decided by content, not by name: a file is a palette file if the
        // §6.10 reader accepts it. Every model's `cuboidy.json` must NOT be
        // one, or the loader would bind a manifest as a colour list.
        var accepted = new List<string>();
        foreach (string path in Directory.GetFiles(TestPaths.ModelsDir, "*.json", SearchOption.AllDirectories))
        {
            Result<IReadOnlyList<PaletteEntry>> result =
                PaletteFileReader.ParsePaletteFileText(File.ReadAllText(path));
            if (result.Ok)
            {
                Assert.That(result.Value, Is.Not.Empty, path);
                accepted.Add(Path.GetFileName(path));
            }
        }

        Assert.That(accepted, Is.Not.Empty);
        Assert.That(accepted, Has.None.EqualTo("cuboidy.json"));
        Assert.That(accepted, Has.All.EqualTo("palette.json"));
    }
}
