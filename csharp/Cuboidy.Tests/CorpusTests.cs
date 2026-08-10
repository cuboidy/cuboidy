using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

// The corpus is the cross-implementation contract (docs/csharp-implementation.md,
// "Done means"): every file under `fixtures/` yields the diagnostic code its
// directory is NAMED after. That naming is only a contract if the C# enum can
// actually spell every directory — a code the enum lacks would otherwise show
// up as a skipped fixture rather than a failure.
//
// The counts are pinned on the TypeScript side by `corpus-coverage.test.ts`,
// which reads the plan document and fails when it goes stale. This file checks
// the half that document cannot: that the corpus is reachable from the test
// assembly and that its vocabulary is the enum's.
[TestFixture]
public class CorpusTests
{
    private static readonly string[] DocumentKinds = { "geometry", "manifest", "palette" };

    [Test]
    public void TheSharedCorpusIsReachableFromTheTestAssembly()
    {
        Assert.That(Directory.Exists(TestPaths.FixturesDir), Is.True, TestPaths.FixturesDir);
        Assert.That(Directory.Exists(TestPaths.ModelsDir), Is.True, TestPaths.ModelsDir);
        Assert.That(File.Exists(Path.Combine(TestPaths.FixturesDir, "README.md")), Is.True);
    }

    [Test]
    public void EveryFixtureDirectoryNamesACodeTheEnumCanSpell()
    {
        var unknown = new List<string>();

        foreach (string kind in DocumentKinds)
        {
            string root = Path.Combine(TestPaths.FixturesDir, kind);
            Assert.That(Directory.Exists(root), Is.True, root);

            foreach (string dir in Directory.GetDirectories(root))
            {
                string name = Path.GetFileName(dir);
                if (!CuboidyErrorCodeExtensions.TryParseWire(name, out _))
                {
                    unknown.Add($"{kind}/{name}");
                }
            }
        }

        Assert.That(unknown, Is.Empty, "fixture directories naming a code CuboidyErrorCode has no member for");
    }

    [Test]
    public void EveryNegativeFixtureIsAJsonDocumentUnderACodeDirectory()
    {
        // A fixture parked directly under `fixtures/geometry/` would be
        // silently uncovered: nothing names the code it should report.
        foreach (string kind in DocumentKinds)
        {
            string root = Path.Combine(TestPaths.FixturesDir, kind);
            Assert.That(Directory.GetFiles(root), Is.Empty, $"{kind}/ holds a file outside any code directory");
        }
    }

    [Test]
    public void TheNineShippedModelsArePresent()
    {
        // The positive half of the same contract. `submersible` is not an
        // afterthought in this list: it is the only one carrying §7.4
        // materials, and one of two with an alpha channel, so a port that read
        // the object form of a palette entry and threw the material away would
        // pass the whole criterion without it.
        string[] expected =
        {
            "fox", "herbalist", "knight", "koi", "orrery", "owl", "submersible", "sword", "windmill",
        };

        IEnumerable<string> present = Directory
            .GetDirectories(TestPaths.ModelsDir)
            .Select(Path.GetFileName)
            .OfType<string>()
            .OrderBy(n => n, System.StringComparer.Ordinal);

        Assert.That(present, Is.EqualTo(expected));
    }
}
