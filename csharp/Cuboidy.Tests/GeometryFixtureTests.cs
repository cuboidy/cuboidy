using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

// The cross-implementation contract for §7, as `fixtures/README.md` states it:
// every file under `fixtures/geometry/<code>/` must fail with `<code>`.
//
// Compared by CODE alone, deliberately. §11.8 leaves within-phase ordering
// implementation-defined and every fixture holds exactly one error, which is
// what lets two implementations with different internals be checked against
// the same corpus without agreeing on message text.
[TestFixture]
public class GeometryFixtureTests
{
    public static IEnumerable<TestCaseData> NegativeFixtures()
    {
        string root = Path.Combine(TestPaths.FixturesDir, "geometry");
        foreach (string dir in Directory.GetDirectories(root).OrderBy(d => d, System.StringComparer.Ordinal))
        {
            string wire = Path.GetFileName(dir);
            foreach (string file in Directory.GetFiles(dir, "*.json").OrderBy(f => f, System.StringComparer.Ordinal))
            {
                yield return new TestCaseData(file, wire)
                    .SetName($"Reports_{wire.Replace('-', '_')}_for_{Path.GetFileNameWithoutExtension(file).Replace('-', '_')}");
            }
        }
    }

    [TestCaseSource(nameof(NegativeFixtures))]
    public void ReportsTheCodeItsDirectoryIsNamedAfter(string path, string wire)
    {
        Assert.That(
            CuboidyErrorCodeExtensions.TryParseWire(wire, out CuboidyErrorCode expected),
            Is.True,
            $"fixture directory '{wire}' names no known code");

        Result<Geometry> result = GeometryReader.ParseGeometryText(File.ReadAllText(path));

        Assert.That(result.Ok, Is.False, $"{path} was accepted; it must fail with '{wire}'");
        Assert.That(
            result.Code, Is.EqualTo(expected),
            $"{path}: expected '{wire}', got '{result.Code.ToWire()}' — {result.Message}");
    }

    [Test]
    public void TheGeometryCorpusHasTheTwentyDocumentsTheContractCounts()
    {
        // Named as a digit on purpose: the plan document and `fixtures/README.md`
        // both quote a count, and both were stale within a day of being
        // written. A corpus that shrank without anyone noticing is a contract
        // that stopped testing something.
        int count = Directory
            .GetFiles(Path.Combine(TestPaths.FixturesDir, "geometry"), "*.json", SearchOption.AllDirectories)
            .Length;

        Assert.That(count, Is.EqualTo(20));
    }
}
