using System.IO;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

// The corpus pins one document per code. These pin the boundaries around it,
// and every expectation here was MEASURED against the reference rather than
// derived from reading its source — the probes are in the C2 chunk's history.
[TestFixture]
public class GeometryReaderTests
{
    private static Result<Geometry> Parse(string text) => GeometryReader.ParseGeometryText(text);

    private static Geometry Ok(string text)
    {
        Result<Geometry> r = Parse(text);
        Assert.That(r.Ok, Is.True, () => $"{r.Code.ToWire()}: {r.Message}");
        return r.Value;
    }

    private static void Fails(string text, CuboidyErrorCode code)
    {
        Result<Geometry> r = Parse(text);
        Assert.That(r.Ok, Is.False, "expected a failure, got a document");
        Assert.That(r.Code, Is.EqualTo(code), () => r.Message);
    }

    private const string Minimal =
        """{"palette":["#FF0000"],"parts":[{"name":"body","size":[1,1,1],"voxels":[["0"]]}]}""";

    // ----- §10: integer and decimal literals are interchangeable ---------

    [Test]
    public void ASizeWrittenAsThreePointZeroIsAnInteger()
    {
        // Hazard N5. `GetInt32()` throws here; the reference accepts it.
        Geometry g = Ok("""{"palette":["#FF0000"],"parts":[{"name":"b","size":[3.0,1,1],"voxels":[["000"]]}]}""");
        Assert.That(g.Parts[0].Size, Is.EqualTo(new Size(3, 1, 1)));
    }

    [Test]
    public void AFractionalSizeIsNot()
    {
        Fails("""{"palette":["#FF0000"],"parts":[{"name":"b","size":[3.5,1,1],"voxels":[["000"]]}]}""",
            CuboidyErrorCode.InvalidValue);
    }

    [TestCase("0")]
    [TestCase("1025")]
    public void ASizeDimensionOutsideOneToTenTwentyFourIsInvalid(string dim)
    {
        Fails($$"""{"palette":["#FF0000"],"parts":[{"name":"b","size":[{{dim}},1,1],"voxels":[["0"]]}]}""",
            CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void ACoordinateThatOverflowsADoubleIsADiagnosticNotAnException()
    {
        // Hazard N6. `1e400` is Infinity in JavaScript and rejected there;
        // .NET parses it to infinity too, so the guard is the finite test.
        Fails(
            """{"palette":["#FF0000"],"parts":[{"name":"b","size":[1,1,1],"pivot":{"pos":[1e400,0,0]},"voxels":[["0"]]}]}""",
            CuboidyErrorCode.InvalidValue);
    }

    // ----- §11.2 arity vs value ------------------------------------------

    [TestCase("[1,1]")]
    [TestCase("[1,1,1,1]")]
    public void ASizeThatIsNotATripleIsWrongArity(string size)
    {
        Fails($$"""{"palette":["#FF0000"],"parts":[{"name":"b","size":{{size}},"voxels":[["0"]]}]}""",
            CuboidyErrorCode.WrongArity);
    }

    [TestCase("[0,0]")]
    [TestCase("[0,0,0,0]")]
    public void ACoordinateThatIsNotATripleIsWrongArity(string pos)
    {
        Fails(
            $$"""{"palette":["#FF0000"],"parts":[{"name":"b","size":[1,1,1],"pivot":{"pos":{{pos}}},"voxels":[["0"]]}]}""",
            CuboidyErrorCode.WrongArity);
    }

    [Test]
    public void AnEmptyInlinePaletteIsWrongArityWhileEmptyPartsIsMissing()
    {
        // The one place §11.2 puts an arity violation under `missing`: an empty
        // `parts` reads as "nothing declared", not as a bad count.
        Fails("""{"palette":[],"parts":[{"name":"b","size":[1,1,1],"voxels":[["."]]}]}""",
            CuboidyErrorCode.WrongArity);
        Fails("""{"palette":["#FF0000"],"parts":[]}""", CuboidyErrorCode.Missing);
    }

    [Test]
    public void APaletteOfSixtyThreeColorsIsWrongArity()
    {
        string colors = string.Join(",", Enumerable.Repeat("\"#FF0000\"", 63));
        Fails($$"""{"palette":[{{colors}}],"parts":[{"name":"b","size":[1,1,1],"voxels":[["."]]}]}""",
            CuboidyErrorCode.WrongArity);
    }

    [Test]
    public void SixtyTwoColorsIsTheLimitNotOverIt()
    {
        string colors = string.Join(",", Enumerable.Repeat("\"#FF0000\"", 62));
        Geometry g = Ok($$"""{"palette":[{{colors}}],"parts":[{"name":"b","size":[1,1,1],"voxels":[["Z"]]}]}""");
        Assert.That(g.Palette.Count, Is.EqualTo(62));
        Assert.That(g.Parts[0].Voxels[0][0][0], Is.EqualTo(61));
    }

    // ----- absence vs a wrong type ---------------------------------------

    [Test]
    public void AnAbsentFieldIsMissingAndAnExplicitNullIsInvalid()
    {
        Fails("""{"palette":["#FF0000"],"parts":[{"name":"b","voxels":[["0"]]}]}""",
            CuboidyErrorCode.Missing);
        Fails("""{"palette":["#FF0000"],"parts":[{"name":"b","size":null,"voxels":[["0"]]}]}""",
            CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void AnUnrecognizedKeyIsUnknownAtEveryLevel()
    {
        Fails("""{"palette":["#FF0000"],"mystery":1,"parts":[{"name":"b","size":[1,1,1],"voxels":[["0"]]}]}""",
            CuboidyErrorCode.Unknown);
        Fails(
            """{"palette":["#FF0000"],"parts":[{"name":"b","size":[1,1,1],"voxels":[["0"]],"pivot":{"pos":[0,0,0],"scale":1}}]}""",
            CuboidyErrorCode.Unknown);
        Fails(
            """{"palette":["#FF0000"],"parts":[{"name":"b","size":[1,1,1],"voxels":[["0"]],"sockets":[{"name":"h","pos":[0,0,0],"q":1}]}]}""",
            CuboidyErrorCode.Unknown);
        Fails("""{"palette":[{"color":"#FF0000","shininess":1}],"parts":[{"name":"b","size":[1,1,1],"voxels":[["0"]]}]}""",
            CuboidyErrorCode.Unknown);
    }

    [Test]
    public void ARootThatIsNotAnObjectIsInvalidValue()
    {
        Fails("[]", CuboidyErrorCode.InvalidValue);
        Fails("null", CuboidyErrorCode.InvalidValue);
        Fails("3", CuboidyErrorCode.InvalidValue);
    }

    // ----- §11.8 phase order ---------------------------------------------

    [Test]
    public void APhaseTwoViolationOutranksAPhaseThreeOne()
    {
        // An unrecognized key AND a row that does not match `size`. §11.8 makes
        // the phase-2 answer a MUST, not a preference: a phase runs only if
        // every earlier phase passed.
        Fails("""{"palette":["#FF0000"],"mystery":1,"parts":[{"name":"b","size":[3,1,1],"voxels":[["0"]]}]}""",
            CuboidyErrorCode.Unknown);
    }

    [Test]
    public void WithinPhaseThreePartsAreExaminedInDocumentOrder()
    {
        // Part 0's row width is wrong and part 1 duplicates part 0's name. The
        // reference reports the row width, because it reaches part 0 first —
        // measured, and the reason this reader raises at the first failure
        // rather than collecting.
        Fails(
            """{"palette":["#FF0000"],"parts":[{"name":"b","size":[3,1,1],"voxels":[["0"]]},{"name":"b","size":[1,1,1],"voxels":[["0"]]}]}""",
            CuboidyErrorCode.WrongArity);
    }

    [Test]
    public void TheLayerCountIsCheckedBeforeTheRowsInsideIt()
    {
        // §11.8: each level stops descending when it fails, so a part with the
        // wrong layer count reports that rather than a cascade of row errors.
        Fails("""{"palette":["#FF0000"],"parts":[{"name":"b","size":[3,2,1],"voxels":[["0"]]}]}""",
            CuboidyErrorCode.WrongArity);
    }

    // ----- §7.4 palette forms --------------------------------------------

    [Test]
    public void APaletteReferenceStaysUnresolved()
    {
        Geometry g = Ok("""{"palette":"shared/pal.json","parts":[{"name":"b","size":[1,1,1],"voxels":[["z"]]}]}""");

        Assert.That(g.PaletteRef, Is.EqualTo("shared/pal.json"));
        Assert.That(g.Palette, Is.Empty);
        // The index range is NOT checked here — it moves to §11.6, which is
        // why a cell of `z` (index 35) against an unresolved palette loads.
        Assert.That(g.Parts[0].Voxels[0][0][0], Is.EqualTo(35));
    }

    [TestCase("shared\\pal.json")]
    [TestCase("/pal.json")]
    [TestCase("res://pal.json")]
    [TestCase("pal.txt")]
    [TestCase("a//pal.json")]
    public void ASection8ViolationInAPaletteReferenceIsInvalidValue(string reference)
    {
        string escaped = reference.Replace("\\", "\\\\");
        Fails($$"""{"palette":"{{escaped}}","parts":[{"name":"b","size":[1,1,1],"voxels":[["."]]}]}""",
            CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void APaletteThatIsNeitherAListNorAStringIsInvalidValue()
    {
        Fails("""{"palette":7,"parts":[{"name":"b","size":[1,1,1],"voxels":[["."]]}]}""",
            CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void AMaterialFieldOutsideZeroToOneIsInvalidValueNotWrongArity()
    {
        // A bound on a NUMBER is never an arity — nothing was counted. §7.4's
        // three material fields are the first named fields to carry a numeric
        // range, and getting this wrong says the palette had the wrong number
        // of entries, which it did not.
        Fails("""{"palette":[{"color":"#FF0000","metallic":2}],"parts":[{"name":"b","size":[1,1,1],"voxels":[["0"]]}]}""",
            CuboidyErrorCode.InvalidValue);
        Fails("""{"palette":[{"color":"#FF0000","roughness":-0.1}],"parts":[{"name":"b","size":[1,1,1],"voxels":[["0"]]}]}""",
            CuboidyErrorCode.InvalidValue);
    }

    // ----- hazard S1: a trailing newline ---------------------------------

    [TestCase(""""{"palette":["#FF0000"],"parts":[{"name":"body\n","size":[1,1,1],"voxels":[["0"]]}]}"""")]
    [TestCase(""""{"palette":["#FF0000"],"parts":[{"name":"b","size":[1,1,1],"sockets":[{"name":"hand\n","pos":[0,0,0]}],"voxels":[["0"]]}]}"""")]
    [TestCase(""""{"palette":["#FF0000\n"],"parts":[{"name":"b","size":[1,1,1],"voxels":[["0"]]}]}"""")]
    [TestCase(""""{"palette":["#FF0000"],"parts":[{"name":"b","size":[2,1,1],"voxels":[["0\n"]]}]}"""")]
    [TestCase(""""{"palette":"p.json\n","parts":[{"name":"b","size":[1,1,1],"voxels":[["."]]}]}"""")]
    public void AValueEndingInANewlineIsRejected(string text)
    {
        // Hazard S1, and the whole reason five patterns in this library end in
        // `\z`. .NET's `$` also matches immediately before a trailing newline,
        // so the literal translation of the reference accepts every one of
        // these. Measured: the reference rejects all five.
        Fails(text, CuboidyErrorCode.InvalidValue);
    }

    // ----- phase 1 --------------------------------------------------------

    [Test]
    public void MalformedJsonIsAPhaseOneFailureWithNoPath()
    {
        Result<Geometry> r = Parse("{\"parts\":");
        Assert.That(r.Ok, Is.False);
        Assert.That(r.Code, Is.EqualTo(CuboidyErrorCode.InvalidValue));
        Assert.That(r.Path, Is.Null, "a syntax failure is about bytes, not about a field");
    }

    [Test]
    public void AByteOrderMarkIsRejected()
    {
        // SPEC §9 forbids a BOM. The reference enforces it by its JSON parser
        // throwing; hazard S2 is that `File.ReadAllText` strips one before a
        // reader can object, which is the loader's problem, not this one's.
        Result<Geometry> r = Parse(((char)0xFEFF) + Minimal);
        Assert.That(r.Ok, Is.False);
        Assert.That(r.Code, Is.EqualTo(CuboidyErrorCode.InvalidValue));
    }

    [Test]
    public void DuplicateKeysAreLastWins()
    {
        // Hazard C3. `JSON.parse` is last-wins and so is the reference;
        // measured, a document with an empty `parts` followed by a populated
        // one loads. `System.Text.Json` keeps both and enumerates them in
        // document order, so assigning as it goes gives the same answer.
        Geometry g = Ok(
            """{"palette":["#FF0000"],"parts":[],"parts":[{"name":"b","size":[1,1,1],"voxels":[["0"]]}]}""");
        Assert.That(g.Parts.Count, Is.EqualTo(1));
    }

    // ----- the AST ---------------------------------------------------------

    [Test]
    public void AnAbsentPivotIsTheBottomCenterOfTheBoundingBox()
    {
        // Hazard N1, on the odd dimension that makes it visible: `W / 2` is
        // integer division and would put this pivot at 1, half a voxel off,
        // for every downstream coordinate.
        Geometry g = Ok("""{"palette":["#FF0000"],"parts":[{"name":"b","size":[3,4,5],"voxels":[["000","000","000","000","000"],["000","000","000","000","000"],["000","000","000","000","000"],["000","000","000","000","000"]]}]}""");

        Assert.That(g.Parts[0].Pivot.Pos, Is.EqualTo(new Vec3(1.5, 0, 2.5)));
        Assert.That(g.Parts[0].Pivot.Rot, Is.Null);
    }

    [Test]
    public void AVoxelRowDecodesThroughTheSection74Alphabet()
    {
        string colors = string.Join(",", Enumerable.Repeat("\"#FF0000\"", 62));
        Geometry g = Ok($$"""{"palette":[{{colors}}],"parts":[{"name":"b","size":[5,1,1],"voxels":[[".09aZ"]]}]}""");

        Assert.That(g.Parts[0].Voxels[0][0], Is.EqualTo(new[] { VoxelRow.Air, 0, 9, 10, 61 }));
    }

    // ----- against a shipped model ----------------------------------------

    [Test]
    public void TheSwordReadsWithItsPivotsAndSockets()
    {
        Geometry g = Ok(File.ReadAllText(Path.Combine(TestPaths.ModelsDir, "sword", "voxels.json")));

        Assert.That(g.Palette.Count, Is.EqualTo(9));
        Assert.That(g.PaletteRef, Is.Null);
        Assert.That(g.Parts.Select(p => p.Name), Is.EqualTo(new[] { "grip", "pommel", "guard", "blade" }));

        // `guard` declares no pivot and is 11 wide by 4 deep — an odd width, so
        // the §7.7 default lands on a half voxel.
        Part guard = g.Parts.Single(p => p.Name == "guard");
        Assert.That(guard.Pivot.Pos, Is.EqualTo(new Vec3(5.5, 0, 2)));

        Part pommel = g.Parts.Single(p => p.Name == "pommel");
        Assert.That(pommel.Sockets.Count, Is.EqualTo(2));
    }

    [Test]
    public void TheSubmersibleKeepsItsMaterialsAndDefaultsRoughnessToOne()
    {
        // Hazard T2, on the file that carries it: `models/submersible/palette.json`
        // has entries that set `emissive` and omit `roughness`. A non-nullable
        // `double Roughness` reads those as a mirror instead of a diffuse
        // surface — and moves the entry in §7.4's normative material order.
        string text = File.ReadAllText(Path.Combine(TestPaths.ModelsDir, "submersible", "palette.json"));
        using System.Text.Json.JsonDocument doc = System.Text.Json.JsonDocument.Parse(text);

        var entries = doc.RootElement.GetProperty("colors").EnumerateArray()
            .Select((e, i) => GeometrySchema.ReadPaletteEntry(e, DocPath.Root.Add("colors", i)))
            .ToList();
        var palette = GeometryReader.ColorsToPalette(entries);

        PaletteEntry emissiveOnly = palette[8]; // {"color":"#FFE9A8","emissive":1}
        Assert.That(emissiveOnly.Material.Emissive, Is.EqualTo(1));
        Assert.That(emissiveOnly.Material.Roughness, Is.EqualTo(1), "roughness defaults to 1, not to default(double)");
        Assert.That(emissiveOnly.Material.Metallic, Is.EqualTo(0));

        // One of the two models with an alpha channel: #FFD07AB4.
        Assert.That(palette[9].Color.A, Is.EqualTo(0xB4));

        PaletteEntry metal = palette[2]; // {"color":"#93A4B4","metallic":1,"roughness":0.68}
        Assert.That(metal.Material.Metallic, Is.EqualTo(1));
        Assert.That(metal.Material.Roughness, Is.EqualTo(0.68));
    }

    [Test]
    public void TheSubmersibleHullPointsAtItsPaletteRatherThanSpellingItOut()
    {
        Geometry g = Ok(File.ReadAllText(Path.Combine(TestPaths.ModelsDir, "submersible", "hull.json")));

        Assert.That(g.PaletteRef, Is.EqualTo("palette.json"));
        Assert.That(g.Palette, Is.Empty);
        Assert.That(g.Parts.Select(p => p.Name),
            Is.EqualTo(new[] { "hull", "collar", "tower", "skid-l", "skid-r" }));
    }

    [Test]
    public void EveryJsonFileShippedWithAModelGetsAVerdictRatherThanAnException()
    {
        // §11.6 W07 decides what a geometry file IS by content, not extension:
        // "a file is one if the §7 reader accepts it". Since v0.9 the manifest,
        // palette files and animation clips are all `.json` too, so this reader
        // is handed all of them and must answer rather than throw.
        foreach (string path in Directory.GetFiles(TestPaths.ModelsDir, "*.json", SearchOption.AllDirectories))
        {
            Result<Geometry> r = GeometryReader.ParseGeometryText(File.ReadAllText(path));
            if (!r.Ok) Assert.That(r.Message, Is.Not.Empty, path);
            else Assert.That(r.Value.Parts, Is.Not.Empty, path);
        }
    }

    [Test]
    public void TheContentTestActuallyDiscriminates()
    {
        // The other half of W07, and the half that can silently stop working: a
        // reader loose enough to accept a manifest would make every package
        // report its own `cuboidy.json` as an unreferenced geometry file.
        //
        // Measured against the reference over all 94 documents under `models/`
        // and `fixtures/`: the two implementations ACCEPT AND REJECT EXACTLY
        // THE SAME FILES. They disagree about the CODE on some of the rejected
        // ones — a manifest fed to the §7 reader breaks several phase-2 rules
        // at once, and §11.8 leaves within-phase ordering implementation-
        // defined, which is why every shared fixture holds exactly one error.
        foreach (string path in Directory.GetFiles(TestPaths.ModelsDir, "*.json", SearchOption.AllDirectories))
        {
            string name = Path.GetFileName(path);
            bool isManifest = name == "cuboidy.json";
            bool isClip = Path.GetFileName(Path.GetDirectoryName(path)!) == "anims";
            if (!isManifest && !isClip) continue;

            Result<Geometry> r = GeometryReader.ParseGeometryText(File.ReadAllText(path));
            Assert.That(r.Ok, Is.False, $"{path} is not a geometry file and must not read as one");
        }
    }

    // ----- line numbers ----------------------------------------------------

    [Test]
    public void AFailureWithAPathIsPrefixedWithItsLine()
    {
        string text = string.Join("\n",
            "{",
            "  \"palette\": [\"#FF0000\"],",
            "  \"parts\": [",
            "    { \"name\": \"body\", \"size\": [3, 1, 1], \"voxels\": [[\"0\"]] }",
            "  ]",
            "}");

        Result<Geometry> r = Parse(text);
        Assert.That(r.Ok, Is.False);
        Assert.That(r.Message, Does.StartWith("line 4:"));
    }
}
