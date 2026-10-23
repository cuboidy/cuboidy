using System.Collections.Generic;
using Cuboidy.Runtime;
using NUnit.Framework;

namespace Cuboidy.Tests;

// SPEC §7.13: which of a part's cells belong to which named region — a name
// for the whole part, or a grid the shape of its voxels with keys. The same
// cases `ts/packages/core/test/regions.test.ts` pins for the reference, so the
// two readers are held to one answer per document.
[TestFixture]
public class RegionsReaderTests
{
    // A 3-wide, 2-high, 1-deep part: its bottom layer two cells marked skin
    // and one of air, its top layer painted in one entry with two cells marked
    // cloth and the third in no region.
    private const string Voxels = """[["11."],["000"]]""";
    private const string Grid = """{"keys":{"s":"skin","c":"cloth"},"cells":[["ss."],["cc."]]}""";

    private static string File(string? regions, string voxels = Voxels, string size = "[3,2,1]") =>
        "{\"palette\":[\"#F6CA9F\",\"#424C6E\"],\"parts\":[{\"name\":\"forearm\",\"size\":" + size +
        ",\"voxels\":" + voxels + (regions is null ? "" : ",\"regions\":" + regions) + "}]}";

    private static Part PartOf(string text)
    {
        Result<Geometry> r = GeometryReader.ParseGeometryText(text);
        Assert.That(r.Ok, Is.True, () => $"{r.Code.ToWire()}: {r.Message}");
        return r.Value.Parts[0];
    }

    private static string CodeOf(string text)
    {
        Result<Geometry> r = GeometryReader.ParseGeometryText(text);
        return r.Ok ? "ok" : r.Code.ToWire();
    }

    [Test]
    public void ARegionNameCoversTheWholePart()
    {
        Regions? regions = PartOf(File("\"skin\"")).Regions;
        Assert.That(regions, Is.Not.Null);
        Assert.That(regions!.Whole, Is.EqualTo("skin"));
        Assert.That(regions.Keys, Is.Null);
        Assert.That(regions.Cells, Is.Null);
    }

    [Test]
    public void AGridIsReadAsWrittenKeysIncluded()
    {
        Regions regions = PartOf(File(Grid)).Regions!;
        Assert.That(regions.Whole, Is.Null);
        Assert.That(regions.Keys, Is.EquivalentTo(new Dictionary<char, string> { ['s'] = "skin", ['c'] = "cloth" }));
        Assert.That(regions.Cells, Is.EqualTo(new[] { new[] { "ss." }, new[] { "cc." } }));
    }

    [Test]
    public void APartThatDeclaresNoneHasNone()
    {
        Assert.That(PartOf(File(null)).Regions, Is.Null);
    }

    [Test]
    public void AKeyMayBeACharacterThatIsAlsoAColour()
    {
        Regions regions = PartOf(File("""{"keys":{"0":"skin"},"cells":[["00."],["..."]]}""")).Regions!;
        Assert.That(regions.Keys!['0'], Is.EqualTo("skin"));
    }

    [Test]
    public void TwoKeysMayNameOneRegion()
    {
        Assert.That(CodeOf(File("""{"keys":{"a":"skin","b":"skin"},"cells":[["ab."],["..."]]}""")), Is.EqualTo("ok"));
    }

    [TestCase("""{"keys":{"s":"skin","c":"cloth"},"cells":[["ss."],["cc."]],"names":{}}""", "unknown")]
    [TestCase("""{"keys":{"s":"skin"}}""", "missing")]
    [TestCase("""{"cells":[["..."],["..."]]}""", "missing")]
    [TestCase("""{"keys":{},"cells":[["..."],["..."]]}""", "wrong-arity")]
    [TestCase("""{"keys":{"ss":"skin"},"cells":[["..."],["..."]]}""", "invalid-value")]
    [TestCase("""{"keys":{".":"skin"},"cells":[["..."],["..."]]}""", "invalid-value")]
    [TestCase("""{"keys":{"#":"skin"},"cells":[["..."],["..."]]}""", "invalid-value")]
    [TestCase("\"1skin\"", "invalid-value")]
    [TestCase("\"palette\"", "invalid-value")]
    [TestCase("""{"keys":{"s":"skin tone"},"cells":[["s.."],["..."]]}""", "invalid-value")]
    [TestCase("7", "invalid-value")]
    [TestCase("""["skin"]""", "invalid-value")]
    [TestCase("""{"keys":{"s":"skin"},"cells":[["s#."],["..."]]}""", "invalid-value")]
    public void RefusesAMalformedField(string regions, string code)
    {
        Assert.That(CodeOf(File(regions)), Is.EqualTo(code));
    }

    [TestCase("""{"keys":{"s":"skin"},"cells":[["s.."]]}""")]
    [TestCase("""{"keys":{"s":"skin"},"cells":[["s.."],[]]}""")]
    [TestCase("""{"keys":{"s":"skin"},"cells":[["s."],["..."]]}""")]
    [TestCase("""{"keys":{"s":"skin"},"cells":[["s..."],["..."]]}""")]
    public void RefusesAGridThatIsNotTheShapeOfTheVoxels(string regions)
    {
        Assert.That(CodeOf(File(regions)), Is.EqualTo("wrong-arity"));
    }

    [Test]
    public void RefusesACellHoldingACharacterTheGridDeclaresNoKeyFor()
    {
        Assert.That(CodeOf(File("""{"keys":{"s":"skin"},"cells":[["sc."],["..."]]}""")), Is.EqualTo("invalid-value"));
    }

    [Test]
    public void AFieldErrorElsewhereOutranksAGridOfTheWrongShape()
    {
        // A stale grid is §11.8 phase 3; a part with no `name` is phase 2.
        string text = "{\"palette\":[\"#F6CA9F\"],\"parts\":[{\"name\":\"forearm\",\"size\":[3,2,1],\"voxels\":" + Voxels +
            ",\"regions\":{\"keys\":{\"s\":\"skin\"},\"cells\":[[\"s.\"],[\"...\"]]}},{\"size\":[1,1,1],\"voxels\":[[\"0\"]]}]}";
        Assert.That(CodeOf(text), Is.EqualTo("missing"));
    }

    // ----- §6.13: inline in a manifest ----------------------------------

    private static string Manifest(string geometry) =>
        "{\"name\":\"one_file\",\"palette\":[\"#F6CA9F\",\"#424C6E\"],\"parts\":[{\"name\":\"forearm\",\"geometry\":" +
        geometry + "}]}";

    [Test]
    public void AnInlinePartCarriesItToItsResolvedPart()
    {
        Result<Manifest> m = ManifestReader.ParseManifestText(
            Manifest("{\"size\":[3,2,1],\"voxels\":" + Voxels + ",\"regions\":" + Grid + "}"));
        Assert.That(m.Ok, Is.True, () => m.Message);
        ResolvedProject project = Project.ResolveProject(m.Value, new Dictionary<string, string>());
        Regions regions = project.Parts["forearm"].Part.Regions!;
        Assert.That(regions.Cells, Is.EqualTo(new[] { new[] { "ss." }, new[] { "cc." } }));
    }

    [Test]
    public void AnInlineGridIsHeldToThePartShape()
    {
        Result<Manifest> m = ManifestReader.ParseManifestText(
            Manifest("{\"size\":[3,2,1],\"voxels\":" + Voxels + ",\"regions\":{\"keys\":{\"s\":\"skin\"},\"cells\":[[\"s..\"]]}}"));
        Assert.That(m.Ok, Is.False);
        Assert.That(m.Code, Is.EqualTo(CuboidyErrorCode.WrongArity), () => m.Message);
    }

    [Test]
    public void AReferenceCannotCarryIt()
    {
        Result<Manifest> m = ManifestReader.ParseManifestText(Manifest("{\"path\":\"voxels.json\",\"regions\":\"skin\"}"));
        Assert.That(m.Ok, Is.False);
        Assert.That(m.Code, Is.EqualTo(CuboidyErrorCode.Unknown), () => m.Message);
    }

    // ----- draws nothing --------------------------------------------------

    [Test]
    public void TwoPartsDifferingOnlyInTheirRegionsMeshToTheSameFaces()
    {
        Result<Geometry> plain = GeometryReader.ParseGeometryText(File(null));
        Result<Geometry> marked = GeometryReader.ParseGeometryText(File(Grid));
        Assert.That(plain.Ok && marked.Ok, Is.True);
        MeshData a = Mesh.BuildMesh(plain.Value.Parts[0], plain.Value.Palette);
        MeshData b = Mesh.BuildMesh(marked.Value.Parts[0], marked.Value.Palette);
        Assert.That(b.Positions, Is.EqualTo(a.Positions));
        Assert.That(b.Colors, Is.EqualTo(a.Colors));
        Assert.That(b.Indices, Is.EqualTo(a.Indices));
    }
}
