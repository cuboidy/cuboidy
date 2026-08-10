using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using NUnit.Framework;

namespace Cuboidy.Tests;

[TestFixture]
public class PackageLoaderTests
{
    private string _temp = string.Empty;

    [SetUp]
    public void CreateTempPackage()
    {
        _temp = Path.Combine(Path.GetTempPath(), "cuboidy-pkg-" + TestContext.CurrentContext.Test.ID);
        Directory.CreateDirectory(_temp);
    }

    [TearDown]
    public void RemoveTempPackage()
    {
        try
        {
            if (Directory.Exists(_temp)) Directory.Delete(_temp, recursive: true);
        }
        catch (IOException)
        {
            // A leftover temp directory is not worth failing a test over.
        }
    }

    private void Write(string relative, string text)
    {
        string path = Path.Combine(_temp, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, new UTF8Encoding(false).GetBytes(text));
    }

    private CuboidyPackage Load()
    {
        Result<CuboidyPackage> r = PackageLoader.LoadDirectory(_temp);
        Assert.That(r.Ok, Is.True, () => $"{r.Code.ToWire()}: {r.Message}");
        return r.Value;
    }

    private const string OneRedPart =
        """{"palette":["#FF0000"],"parts":[{"name":"head","size":[1,1,1],"voxels":[["0"]]}]}""";

    // ----- the nine shipped models ----------------------------------------

    public static IEnumerable<string> ShippedModels() =>
        Directory.GetDirectories(TestPaths.ModelsDir)
            .Select(Path.GetFileName)
            .OfType<string>()
            .OrderBy(n => n, StringComparer.Ordinal);

    [TestCaseSource(nameof(ShippedModels))]
    public void AShippedModelLoadsCleanAndFullyResolved(string model)
    {
        // The positive half of the acceptance contract: every shipped model
        // loads clean. `submersible` is not an afterthought in that list — it
        // is the only one carrying §7.4 materials, and one of two with an alpha
        // channel.
        Result<CuboidyPackage> r = PackageLoader.LoadDirectory(Path.Combine(TestPaths.ModelsDir, model));
        Assert.That(r.Ok, Is.True, () => $"{model}: {r.Message}");

        CuboidyPackage pkg = r.Value;
        Assert.That(pkg.Project.Diagnostics, Is.Empty,
            () => string.Join("\n", pkg.Project.Diagnostics.Select(d => $"{d.File}: {d.Diag.Message}")));
        Assert.That(pkg.Project.Complete, Is.True, model);
        Assert.That(pkg.Project.Resolved, Is.True, model);
        Assert.That(pkg.Project.Unresolved, Is.Empty, model);
        Assert.That(pkg.Project.Duplicates, Is.Empty, model);

        // Every manifest part is bound to a shape, in manifest order.
        Assert.That(pkg.Project.Parts.Keys, Is.EqualTo(pkg.Manifest.Parts.Select(p => p.Name)), model);

        // Every §6.3 clip that is a reference resolved.
        foreach (KeyValuePair<string, Animation> entry in pkg.Manifest.Animations)
        {
            if (entry.Value.Ref is null) continue;
            Assert.That(pkg.Project.ExternalAnims.ContainsKey(entry.Key), Is.True, $"{model}/{entry.Key}");
        }
    }

    [Test]
    public void TheOrreryResolvesAPaletteRelativeToTheGeometryFileThatNamedIt()
    {
        // SPEC §8, on the one shipped model that exercises it: `parts/frame.json`
        // names `palette.json` and means `parts/palette.json`, not a
        // `palette.json` at the package root. It is also the model with an
        // inline part beside file-defined ones.
        CuboidyPackage pkg = PackageLoader
            .LoadDirectory(Path.Combine(TestPaths.ModelsDir, "orrery")).Value;

        Assert.That(pkg.Files.Keys, Does.Contain("parts/palette.json"));
        Assert.That(pkg.Files.Keys, Has.None.EqualTo("palette.json"));

        GeometryFile frame = pkg.Project.Geometries.Single(g => g.Path == "parts/frame.json");
        Assert.That(frame.Geometry.PaletteRef, Is.EqualTo("palette.json"));
        Assert.That(frame.Geometry.Palette.Count, Is.EqualTo(3));

        Assert.That(pkg.Project.Parts["base"].Source, Is.Null, "written inline in the manifest");
        Assert.That(pkg.Project.Parts["post"].Source, Is.EqualTo(new PartSource("parts/frame.json", "post")));
    }

    [Test]
    public void PackageRelativeKeysAreForwardSlashedWhateverThePlatformSeparatorIs()
    {
        CuboidyPackage pkg = PackageLoader
            .LoadDirectory(Path.Combine(TestPaths.ModelsDir, "orrery")).Value;

        foreach (string key in pkg.Files.Keys)
        {
            Assert.That(key, Does.Not.Contain("\\"), key);
            Assert.That(key, Does.Not.Contain(":"), key);
            Assert.That(key, Does.Not.StartWith("/"), key);
        }
    }

    // ----- the manifest is the only thing that can fail the load ----------

    [Test]
    public void AnAbsentManifestIsMissing()
    {
        Result<CuboidyPackage> r = PackageLoader.LoadDirectory(_temp);

        Assert.That(r.Ok, Is.False);
        Assert.That(r.Code, Is.EqualTo(CuboidyErrorCode.Missing));
        Assert.That(r.Message, Does.Contain("cuboidy.json"));
    }

    [Test]
    public void AByteOrderMarkOnTheManifestIsRejected()
    {
        // Hazard S2, and the whole reason the loader does not use
        // `File.ReadAllText`: SPEC §9 forbids a BOM, the reference enforces it
        // only by its JSON parser throwing on the U+FEFF it finds, and
        // `File.ReadAllText` would strip the character before anything could
        // object — silently accepting what the reference rejects.
        string path = Path.Combine(_temp, "cuboidy.json");
        var bytes = new List<byte> { 0xEF, 0xBB, 0xBF };
        bytes.AddRange(Encoding.UTF8.GetBytes("""{"name":"m","parts":[{"name":"head"}]}"""));
        File.WriteAllBytes(path, bytes.ToArray());

        Result<CuboidyPackage> r = PackageLoader.LoadDirectory(_temp);

        Assert.That(r.Ok, Is.False);
        Assert.That(r.Code, Is.EqualTo(CuboidyErrorCode.InvalidValue));
    }

    [Test]
    public void AManifestWithoutABomLoadsFine()
    {
        // The control for the test above: the same bytes minus three.
        Write("cuboidy.json", """{"name":"m","geometry":["v.json"],"parts":[{"name":"head"}]}""");
        Write("v.json", OneRedPart);

        Assert.That(Load().Project.Resolved, Is.True);
    }

    [Test]
    public void AnInvalidManifestFailsTheLoadWithItsOwnCode()
    {
        Write("cuboidy.json", """{"name":"m","parts":[{"name":"head","mystery":1}]}""");

        Result<CuboidyPackage> r = PackageLoader.LoadDirectory(_temp);

        Assert.That(r.Ok, Is.False);
        Assert.That(r.Code, Is.EqualTo(CuboidyErrorCode.Unknown));
        Assert.That(r.Message, Does.Contain("cuboidy.json"));
    }

    [Test]
    public void AnUnreadableGeometryFileIsADiagnosticRatherThanAFailedLoad()
    {
        // A package with one unreadable geometry file still has a manifest, a
        // part list and every other file, and a caller deciding what to do
        // about it needs all of them.
        Write("cuboidy.json", """{"name":"m","geometry":["a.json","gone.json"],"parts":[{"name":"head"}]}""");
        Write("a.json", OneRedPart);

        CuboidyPackage pkg = Load();

        Assert.That(pkg.Project.Complete, Is.False);
        Assert.That(pkg.Project.Diagnostics.Select(d => d.File), Is.EqualTo(new[] { "gone.json" }));
        Assert.That(pkg.Project.Diagnostics[0].Diag.Code, Is.EqualTo(CuboidyErrorCode.Missing));
        // The path in the diagnostic is the one the AUTHOR wrote, not an
        // absolute one this machine happens to use.
        Assert.That(pkg.Project.Diagnostics[0].Diag.Message, Does.Not.Contain(_temp));
        // And what did resolve is still there.
        Assert.That(pkg.Project.Parts.Keys, Is.EqualTo(new[] { "head" }));
    }

    // ----- the two-round walk ---------------------------------------------

    [Test]
    public void ThePaletteRoundHappensAfterTheGeometryRound()
    {
        // §7.4 references live INSIDE geometry files, so a loader that staged
        // its IO in one pass would never fetch this file at all.
        Write("cuboidy.json", """{"name":"m","geometry":["nested/a.json"],"parts":[{"name":"head"}]}""");
        Write("nested/a.json",
            """{"palette":"pal.json","parts":[{"name":"head","size":[1,1,1],"voxels":[["1"]]}]}""");
        Write("nested/pal.json", """{"colors":["#FF0000","#00FF00"]}""");

        CuboidyPackage pkg = Load();

        Assert.That(pkg.Files.Keys.OrderBy(k => k, StringComparer.Ordinal),
            Is.EqualTo(new[] { "nested/a.json", "nested/pal.json" }));
        Assert.That(pkg.Project.Resolved, Is.True);
        Assert.That(pkg.Project.Parts["head"].Palette.Count, Is.EqualTo(2));
    }

    [Test]
    public void AnExternalAnimationIsStagedInTheFirstRound()
    {
        Write("cuboidy.json",
            """{"name":"m","geometry":["a.json"],"parts":[{"name":"head"}],"animations":{"walk":"anims/w.json"}}""");
        Write("a.json", OneRedPart);
        Write("anims/w.json", """{"duration":1,"loop":true,"parts":{"head":{"0.0":{"pos":[0,1,0]}}}}""");

        CuboidyPackage pkg = Load();

        Assert.That(pkg.Project.Complete, Is.True);
        Assert.That(pkg.Project.ExternalAnims["walk"].Path, Is.EqualTo("anims/w.json"));
    }

    [Test]
    public void AnAllInlineModelIsOneFile()
    {
        // §6.9: demanding a `voxels.json` beside an all-inline manifest would
        // make the one-file form impossible.
        Write("cuboidy.json",
            """{"name":"m","palette":["#FF0000"],"parts":[{"name":"head","geometry":{"size":[1,1,1],"voxels":[["0"]]}}]}""");

        CuboidyPackage pkg = Load();

        Assert.That(pkg.Files, Is.Empty);
        Assert.That(pkg.Project.Geometries, Is.Empty);
        Assert.That(pkg.Project.Resolved, Is.True);
        Assert.That(pkg.Project.Parts["head"].Palette.Count, Is.EqualTo(1));
    }
}
