using System.IO;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

// `fixtures/project/` is the odd corner of the corpus and `fixtures/README.md`
// says why: §11.6 is about a manifest and the files it references TOGETHER, so
// a single document cannot express it. Each fixture is a DIRECTORY, and the
// manifest itself always parses — the failure is in the project.
//
// §11.6 splits in two and this library owns only the first half:
//
//   Resolution — the package must not resolve. For `duplicate/` this is
//   NORMATIVE, and a second implementation must reproduce it whether or not it
//   lints, because a runtime that binds one of two candidate shapes makes the
//   answer a fact about its hash table rather than about the model.
//
//   Reporting — some cross-file finding carries the code the directory names.
//   That is lint, which is not ported, so it is checked on the TypeScript side
//   only.
[TestFixture]
public class ProjectFixtureTests
{
    private static ResolvedProject Load(string kind, string package)
    {
        string dir = Path.Combine(TestPaths.FixturesDir, "project", kind, package);
        Result<CuboidyPackage> r = PackageLoader.LoadDirectory(dir);
        Assert.That(r.Ok, Is.True, () => $"{dir}: the manifest itself must parse — {r.Message}");
        return r.Value.Project;
    }

    [TestCase("duplicate", "part-in-two-files")]
    [TestCase("missing", "part-in-no-file")]
    public void AProjectFixtureDoesNotResolve(string kind, string package)
    {
        ResolvedProject p = Load(kind, package);

        Assert.That(p.Resolved, Is.False, $"fixtures/project/{kind}/{package} must not resolve");
        // …while READING the package went fine. `Complete` gating on this
        // would mean an unresolved part silences the very rule that reports it.
        Assert.That(p.Complete, Is.True);
    }

    [Test]
    public void AnAmbiguousNameIsRefusedRatherThanBoundToTheFirstFile()
    {
        ResolvedProject p = Load("duplicate", "part-in-two-files");

        Assert.That(p.Parts.ContainsKey("head"), Is.False, "the name must bind to NOTHING");
        Assert.That(p.Duplicates.Select(d => d.Name), Is.EqualTo(new[] { "head" }));
        Assert.That(p.Duplicates[0].Files, Is.EqualTo(new[] { "a.json", "b.json" }));

        // The two definitions really do differ, which is what makes binding
        // either one a fact about the reader rather than about the model.
        Assert.That(p.Geometries.Select(g => g.Path), Is.EqualTo(new[] { "a.json", "b.json" }));
        Assert.That(p.Geometries[0].Geometry.Parts[0].Size, Is.EqualTo(new Size(1, 1, 1)));
        Assert.That(p.Geometries[1].Geometry.Parts[0].Size, Is.EqualTo(new Size(2, 1, 1)));
    }

    [Test]
    public void APartNoFileDefinesStillLeavesItsSiblingsBound()
    {
        // For `missing/` the spec asks only that the condition be reported, so
        // a library MAY hand back the parts it did resolve — and does, because
        // a consumer asking "can I draw this" reads `Resolved`, and a refusal
        // would cost an editor its ability to show a half-finished model.
        ResolvedProject p = Load("missing", "part-in-no-file");

        Assert.That(p.Parts.Keys, Is.EqualTo(new[] { "head" }));
        Assert.That(p.Unresolved.Select(u => u.Name), Is.EqualTo(new[] { "tail" }));
        Assert.That(p.Parts["head"].Source, Is.EqualTo(new PartSource("a.json", "head")));
    }

    [Test]
    public void TheProjectCorpusIsTwoPackages()
    {
        int packages = Directory
            .GetDirectories(Path.Combine(TestPaths.FixturesDir, "project"))
            .Sum(kind => Directory.GetDirectories(kind).Length);

        Assert.That(packages, Is.EqualTo(2));
    }
}
