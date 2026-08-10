using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

// `ResolveProject` never touches IO, so these hand it a file map directly —
// which is also how the editor and an archive reader would use it.
[TestFixture]
public class ProjectResolverTests
{
    private static Manifest ManifestOf(string text)
    {
        Result<Manifest> r = ManifestReader.ParseManifestText(text);
        Assert.That(r.Ok, Is.True, () => $"{r.Code.ToWire()}: {r.Message}");
        return r.Value;
    }

    private static Dictionary<string, string> Files(params (string Path, string Text)[] entries) =>
        entries.ToDictionary(e => e.Path, e => e.Text, System.StringComparer.Ordinal);

    private const string OneRedPart =
        """{"palette":["#FF0000"],"parts":[{"name":"head","size":[1,1,1],"voxels":[["0"]]}]}""";

    // ----- §8 path normalization ------------------------------------------

    [TestCase("voxels.json", "voxels.json")]
    [TestCase("./voxels.json", "voxels.json")]
    [TestCase("a//b.json", "a/b.json")]
    [TestCase("a/./b.json", "a/b.json")]
    [TestCase("a/../b.json", "b.json")]
    [TestCase("a/b/../c.json", "a/c.json")]
    [TestCase("../shared/p.json", "../shared/p.json")]
    [TestCase("../../p.json", "../../p.json")]
    [TestCase("a/../../p.json", "../p.json")]
    [TestCase("", "")]
    public void NormalizeRefPathResolvesDotSegmentsWithoutTouchingTheFilesystem(string input, string expected)
    {
        // NOT `Path.GetFullPath`, which would anchor on the process's current
        // directory and hand back a drive letter and backslashes — nothing a
        // §8 reference can name, and nothing the file map is keyed by.
        Assert.That(Project.NormalizeRefPath(input), Is.EqualTo(expected));
    }

    [Test]
    public void ALeadingDotDotSurvivesBecauseItMeansOutsideThePackage()
    {
        Assert.That(Project.NormalizeRefPath("../p.json"), Does.StartWith(".."));
    }

    [TestCase("voxels.json", "palette.json", "palette.json")]
    [TestCase("parts/frame.json", "palette.json", "parts/palette.json")]
    [TestCase("a/b/c.json", "../p.json", "a/p.json")]
    [TestCase("gear/body.json", "shared/p.json", "gear/shared/p.json")]
    public void AReferenceResolvesRelativeToTheFileThatContainsIt(
        string fromFile, string reference, string expected)
    {
        // SPEC §8, and the whole reason this function exists: `gear/body.json`
        // naming `palette.json` means `gear/palette.json`, not a `palette.json`
        // at the root.
        Assert.That(Project.ResolveRefFrom(fromFile, reference), Is.EqualTo(expected));
    }

    // ----- §6.9 which files the lookup searches ---------------------------

    [Test]
    public void TheDefaultGeometryListAppliesOnlyWhenSomePartNeedsTheLookup()
    {
        // This is what lets a model be a single file: an all-inline manifest
        // never looks in the list, and demanding a `voxels.json` beside it
        // would make the one-file form impossible.
        Manifest allInline = ManifestOf(
            """{"name":"m","parts":[{"name":"head","geometry":{"size":[1,1,1],"voxels":[["."]]}}]}""");
        Assert.That(Project.GeometryPaths(allInline), Is.Empty);

        Manifest needsLookup = ManifestOf("""{"name":"m","parts":[{"name":"head"}]}""");
        Assert.That(Project.GeometryPaths(needsLookup), Is.EqualTo(new[] { "voxels.json" }));
    }

    [Test]
    public void AnExplicitListIsAlwaysReadEvenWhenNothingResolvesToIt()
    {
        // So a stale entry still surfaces as the §11.6 `unknown` warning rather
        // than being dropped in silence.
        Manifest m = ManifestOf(
            """{"name":"m","geometry":["a.json"],"parts":[{"name":"head","geometry":{"size":[1,1,1],"voxels":[["."]]}}]}""");
        Assert.That(Project.GeometryPaths(m), Is.EqualTo(new[] { "a.json" }));
    }

    [Test]
    public void APartsOwnPathJoinsTheReadListAndKeepsOrderWithoutDuplicating()
    {
        Manifest m = ManifestOf(
            """{"name":"m","geometry":["a.json","b.json"],"parts":[{"name":"head"},{"name":"cap","geometry":{"path":"b.json"}},{"name":"tip","geometry":{"path":"c.json"}}]}""");

        // Order preserved, `b.json` not repeated — `[...new Set(out)]`, which
        // `Enumerable.Distinct` does not promise.
        Assert.That(Project.GeometryPaths(m), Is.EqualTo(new[] { "a.json", "b.json", "c.json" }));
    }

    [Test]
    public void AFileReachedOnlyByAnExplicitPathIsNotSearchedByName()
    {
        // §11.6: files reached only by `geometry.path` "do not take part" in
        // the name-uniqueness check — so they must not be searched by name
        // either, or a name they happen to share would bind without ever being
        // checked for being ambiguous. `head` is defined in BOTH files here and
        // that is not a duplicate, because only `a.json` is listed.
        Manifest m = ManifestOf(
            """{"name":"m","geometry":["a.json"],"parts":[{"name":"head"},{"name":"cap","geometry":{"path":"b.json","part":"head"}}]}""");

        ResolvedProject p = Project.ResolveProject(m, Files(("a.json", OneRedPart), ("b.json", OneRedPart)));

        Assert.That(p.Duplicates, Is.Empty);
        Assert.That(p.Resolved, Is.True);
        Assert.That(p.Parts["head"].Source, Is.EqualTo(new PartSource("a.json", "head")));
        Assert.That(p.Parts["cap"].Source, Is.EqualTo(new PartSource("b.json", "head")));
    }

    [Test]
    public void AnAnimationRefListIsDedupedAndAPaletteIsNotInIt()
    {
        Manifest m = ManifestOf(
            """{"name":"m","parts":[{"name":"head"}],"animations":{"walk":"a/w.json","run":"a/w.json","idle":"a/i.json","here":{"duration":1,"loop":true,"parts":{}}}}""");

        ProjectPaths paths = Project.ProjectFilePaths(m);

        // Two clips may share one file; an inline clip names none.
        Assert.That(paths.Animations, Is.EqualTo(new[] { "a/w.json", "a/i.json" }));
        // Palettes are absent on purpose — a §7.4 reference lives INSIDE a
        // geometry file and is only discoverable once those are read.
        Assert.That(paths.Geometry, Is.EqualTo(new[] { "voxels.json" }));
    }

    // ----- §6.13 the three forms ------------------------------------------

    [Test]
    public void AnInlinePartTakesTheManifestPaletteAndHasNoSource()
    {
        ResolvedProject p = Project.ResolveProject(
            ManifestOf(
                """{"name":"m","palette":["#FF0000","#00FF00"],"parts":[{"name":"head","geometry":{"size":[1,1,1],"voxels":[["1"]]}}]}"""),
            Files());

        ResolvedPart head = p.Parts["head"];
        Assert.That(head.Source, Is.Null);
        Assert.That(head.Palette.Count, Is.EqualTo(2));
        Assert.That(head.Part.Name, Is.EqualTo("head"));
        Assert.That(p.Resolved, Is.True);
    }

    [Test]
    public void AnInlinePartsOwnPaletteBeatsTheManifestOne()
    {
        ResolvedProject p = Project.ResolveProject(
            ManifestOf(
                """{"name":"m","palette":["#FF0000","#00FF00"],"parts":[{"name":"head","geometry":{"size":[1,1,1],"voxels":[["0"]],"palette":["#0000FF"]}}]}"""),
            Files());

        Assert.That(p.Parts["head"].Palette.Count, Is.EqualTo(1));
        Assert.That(p.Parts["head"].Palette[0].Color, Is.EqualTo(new Color(0, 0, 0xFF, 0xFF)));
    }

    [Test]
    public void AReferencedPartTakesItsFilesPaletteNotTheManifestOne()
    {
        // Both ends of §6.13's reference form end at a part in a file, so both
        // take that file's palette (§7.4) — the manifest's never applies.
        ResolvedProject p = Project.ResolveProject(
            ManifestOf("""{"name":"m","palette":["#FF0000","#00FF00","#0000FF"],"parts":[{"name":"head"}]}"""),
            Files(("voxels.json", OneRedPart)));

        Assert.That(p.Parts["head"].Palette.Count, Is.EqualTo(1));
    }

    [Test]
    public void AnExplicitPartRenamesTheShapeWhileSourceKeepsTheFilesName()
    {
        ResolvedProject p = Project.ResolveProject(
            ManifestOf(
                """{"name":"m","geometry":["a.json"],"parts":[{"name":"cap","geometry":{"path":"a.json","part":"head"}}]}"""),
            Files(("a.json", OneRedPart)));

        // The rig knows this part by the MANIFEST's name; the name it has in
        // the FILE survives in `Source`, because renaming it here would
        // otherwise lose which definition this is.
        Assert.That(p.Parts["cap"].Part.Name, Is.EqualTo("cap"));
        Assert.That(p.Parts["cap"].Source, Is.EqualTo(new PartSource("a.json", "head")));
    }

    [Test]
    public void TwoRigPartsMaySharePartOfOneFile()
    {
        ResolvedProject p = Project.ResolveProject(
            ManifestOf(
                """{"name":"m","geometry":["a.json"],"parts":[{"name":"l","geometry":{"path":"a.json","part":"head"}},{"name":"r","geometry":{"path":"a.json","part":"head"}}]}"""),
            Files(("a.json", OneRedPart)));

        Assert.That(p.Resolved, Is.True);
        Assert.That(p.Parts["l"].Part.Name, Is.EqualTo("l"));
        Assert.That(p.Parts["r"].Part.Name, Is.EqualTo("r"));
        Assert.That(p.Parts["l"].Source!.Part, Is.EqualTo("head"));
    }

    [Test]
    public void PartsComeBackInManifestOrder()
    {
        // Hazard C1. `Dictionary` guarantees no order and every ordered output
        // downstream walks this map.
        ResolvedProject p = Project.ResolveProject(
            ManifestOf(
                """{"name":"m","parts":[{"name":"z","geometry":{"size":[1,1,1],"voxels":[["."]]}},{"name":"a","geometry":{"size":[1,1,1],"voxels":[["."]]}},{"name":"m","geometry":{"size":[1,1,1],"voxels":[["."]]}}]}"""),
            Files());

        Assert.That(p.Parts.Keys, Is.EqualTo(new[] { "z", "a", "m" }));
    }

    // ----- §11.6 the two resolution failures ------------------------------

    [Test]
    public void AnAmbiguousNameBindsToNothingRatherThanToWhicheverFileCameFirst()
    {
        // Normative (§11.6): "an implementation MUST refuse to bind it".
        // Returning one of the two candidates would make the answer a fact
        // about the reader's collections rather than about the model.
        ResolvedProject p = Project.ResolveProject(
            ManifestOf("""{"name":"m","geometry":["a.json","b.json"],"parts":[{"name":"head"}]}"""),
            Files(
                ("a.json", OneRedPart),
                ("b.json", """{"palette":["#00FF00"],"parts":[{"name":"head","size":[2,1,1],"voxels":[["00"]]}]}""")));

        Assert.That(p.Parts.ContainsKey("head"), Is.False);
        Assert.That(p.Duplicates.Select(d => d.Name), Is.EqualTo(new[] { "head" }));
        Assert.That(p.Duplicates[0].Files, Is.EqualTo(new[] { "a.json", "b.json" }));
        Assert.That(p.Unresolved.Select(u => u.Name), Is.EqualTo(new[] { "head" }));

        // `Complete` stays TRUE: reading the package went fine. Reporting the
        // ambiguity as a diagnostic would gate cross-file validation off
        // entirely, so one ambiguous name would hide every other §11.6 finding
        // for the model.
        Assert.That(p.Complete, Is.True);
        Assert.That(p.Resolved, Is.False);
    }

    [Test]
    public void APartNoFileDefinesLeavesTheRestResolved()
    {
        // Only reported, not normative — so the library hands back the parts it
        // DID resolve, which is what keeps an editor able to show a
        // half-finished model.
        ResolvedProject p = Project.ResolveProject(
            ManifestOf("""{"name":"m","geometry":["a.json"],"parts":[{"name":"head"},{"name":"tail"}]}"""),
            Files(("a.json", OneRedPart)));

        Assert.That(p.Parts.Keys, Is.EqualTo(new[] { "head" }));
        Assert.That(p.Unresolved.Select(u => u.Name), Is.EqualTo(new[] { "tail" }));
        Assert.That(p.Complete, Is.True);
        Assert.That(p.Resolved, Is.False);
    }

    [Test]
    public void AnExplicitPathThatNamesNoSuchPartIsUnresolvedNotADiagnostic()
    {
        ResolvedProject p = Project.ResolveProject(
            ManifestOf(
                """{"name":"m","geometry":["a.json"],"parts":[{"name":"cap","geometry":{"path":"a.json","part":"ghost"}}]}"""),
            Files(("a.json", OneRedPart)));

        Assert.That(p.Unresolved.Select(u => u.Name), Is.EqualTo(new[] { "cap" }));
        Assert.That(p.Unresolved[0].Message, Does.Contain("a.json"));
        Assert.That(p.Complete, Is.True);
        Assert.That(p.Resolved, Is.False);
    }

    [Test]
    public void AnUnreadableFileIsADiagnosticAndSaidOnlyOnce()
    {
        ResolvedProject p = Project.ResolveProject(
            ManifestOf("""{"name":"m","geometry":["a.json"],"parts":[{"name":"head"}]}"""),
            Files());

        Assert.That(p.Diagnostics.Count, Is.EqualTo(1));
        Assert.That(p.Diagnostics[0].File, Is.EqualTo("a.json"));
        Assert.That(p.Diagnostics[0].Diag.Code, Is.EqualTo(CuboidyErrorCode.Missing));
        Assert.That(p.Complete, Is.False);
        Assert.That(p.Resolved, Is.False);

        // The part's own failure is NOT repeated: "an unreadable or unparsable
        // path already has its own `missing`; saying it twice helps nobody."
        Assert.That(p.Unresolved.Select(u => u.Name), Is.EqualTo(new[] { "head" }));
    }

    // ----- §7.4 palette resolution ----------------------------------------

    [Test]
    public void APaletteReferenceIsFilledInAndItsSourceIsRecorded()
    {
        ResolvedProject p = Project.ResolveProject(
            ManifestOf("""{"name":"m","geometry":["parts/a.json"],"parts":[{"name":"head"}]}"""),
            Files(
                ("parts/a.json",
                 """{"palette":"pal.json","parts":[{"name":"head","size":[1,1,1],"voxels":[["1"]]}]}"""),
                // §8: relative to the geometry file, not to the package root.
                ("parts/pal.json", """{"colors":["#FF0000","#00FF00"]}""")));

        Assert.That(p.Complete, Is.True);
        Assert.That(p.Geometries[0].Geometry.PaletteRef, Is.EqualTo("pal.json"));
        Assert.That(p.Geometries[0].Geometry.Palette.Count, Is.EqualTo(2));
        Assert.That(p.Parts["head"].Palette.Count, Is.EqualTo(2));
    }

    [Test]
    public void TwoFilesSharingOnePaletteReadItOnceAndReportAtMostOnce()
    {
        var files = Files(
            ("a.json", """{"palette":"pal.json","parts":[{"name":"head","size":[1,1,1],"voxels":[["0"]]}]}"""),
            ("b.json", """{"palette":"pal.json","parts":[{"name":"tail","size":[1,1,1],"voxels":[["0"]]}]}"""));

        ResolvedProject p = Project.ResolveProject(
            ManifestOf("""{"name":"m","geometry":["a.json","b.json"],"parts":[{"name":"head"},{"name":"tail"}]}"""),
            files);

        // One diagnostic for the missing palette, not two.
        Assert.That(p.Diagnostics.Count, Is.EqualTo(1));
        Assert.That(p.Diagnostics[0].File, Is.EqualTo("pal.json"));
    }

    [Test]
    public void AnIndexPastAResolvedPaletteIsNotTheResolversProblem()
    {
        // §11.6 makes it an error and the check lives in lint, which is not
        // ported. A runtime that only draws has the answer it needs from
        // §7.4 — an index no palette defines renders as opaque magenta.
        ResolvedProject p = Project.ResolveProject(
            ManifestOf("""{"name":"m","geometry":["a.json"],"parts":[{"name":"head"}]}"""),
            Files(
                ("a.json", """{"palette":"pal.json","parts":[{"name":"head","size":[1,1,1],"voxels":[["9"]]}]}"""),
                ("pal.json", """{"colors":["#FF0000"]}""")));

        Assert.That(p.Complete, Is.True);
        Assert.That(p.Resolved, Is.True);
    }

    // ----- §6.3 external animations ---------------------------------------

    [Test]
    public void AnExternalClipIsReadByTheSameCodeAnInlineOneIs()
    {
        ResolvedProject p = Project.ResolveProject(
            ManifestOf("""{"name":"m","parts":[{"name":"head"}],"animations":{"walk":"a/w.json"}}"""),
            Files(
                ("voxels.json", OneRedPart),
                ("a/w.json", """{"duration":2,"loop":false,"parts":{"head":{"0.0":{"pos":[0,0,0]}}}}""")));

        Assert.That(p.Complete, Is.True);
        Assert.That(p.ExternalAnims["walk"].Path, Is.EqualTo("a/w.json"));
        Assert.That(p.ExternalAnims["walk"].Anim.Duration, Is.EqualTo(2));
        Assert.That(p.ExternalAnims["walk"].Anim.Loop, Is.False);
    }

    [TestCase("""{"duration":1,"parts":{}}""", CuboidyErrorCode.Missing)]
    [TestCase("""{"duration":1,"loop":true,"parts":{"body":{"0.0":{"ease":{"rot":"nope"}}}}}""",
        CuboidyErrorCode.Unknown)]
    [TestCase("""{"duration":1,"loop":true,"parts":{"body":{"1":{}}}}""", CuboidyErrorCode.InvalidValue)]
    public void AnExternalClipReportsTheSameCodeTheIdenticalInlineMistakeWould(
        string clip, CuboidyErrorCode expected)
    {
        // This used to hand-build the diagnostic with the code hardcoded to
        // `invalid-value`, so the identical mistake reported one code written
        // in the manifest and another written in a file beside it.
        ResolvedProject p = Project.ResolveProject(
            ManifestOf("""{"name":"m","parts":[{"name":"head"}],"animations":{"walk":"w.json"}}"""),
            Files(("voxels.json", OneRedPart), ("w.json", clip)));

        Assert.That(p.Diagnostics.Count, Is.EqualTo(1));
        Assert.That(p.Diagnostics[0].Diag.Code, Is.EqualTo(expected), p.Diagnostics[0].Diag.Message);
        Assert.That(p.Diagnostics[0].Diag.Message, Does.StartWith("animation 'walk':"));
    }

    [Test]
    public void TwoClipsMaySharadOneFileAndAreKeyedByClipName()
    {
        ResolvedProject p = Project.ResolveProject(
            ManifestOf("""{"name":"m","parts":[{"name":"head"}],"animations":{"walk":"w.json","run":"w.json"}}"""),
            Files(
                ("voxels.json", OneRedPart),
                ("w.json", """{"duration":1,"loop":true,"parts":{}}""")));

        Assert.That(p.ExternalAnims.Keys, Is.EqualTo(new[] { "walk", "run" }));
        Assert.That(p.ExternalAnims["run"].Path, Is.EqualTo("w.json"));
    }

    [Test]
    public void ANullManifestResolvesToNothingWithoutRaising()
    {
        ResolvedProject p = Project.ResolveProject(null, Files());

        Assert.That(p.Parts, Is.Empty);
        Assert.That(p.Geometries, Is.Empty);
        Assert.That(p.Diagnostics.Count, Is.EqualTo(1), "the default voxels.json is still looked for");
    }
}
