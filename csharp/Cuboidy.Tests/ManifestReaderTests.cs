using System.IO;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

// The corpus pins one document per code for §6. These pin the boundaries
// around it, and every expectation was MEASURED against `parseManifest` from
// @cuboidy/core rather than derived from reading it.
[TestFixture]
public class ManifestReaderTests
{
    private static Result<Manifest> Parse(string text) => ManifestReader.ParseManifestText(text);

    private static Manifest Ok(string text)
    {
        Result<Manifest> r = Parse(text);
        Assert.That(r.Ok, Is.True, () => $"{r.Code.ToWire()}: {r.Message}");
        return r.Value;
    }

    private static void Fails(string text, CuboidyErrorCode code)
    {
        Result<Manifest> r = Parse(text);
        Assert.That(r.Ok, Is.False, "expected a failure, got a manifest");
        Assert.That(r.Code, Is.EqualTo(code), () => r.Message);
    }

    // Concatenated rather than interpolated: a raw string literal cannot hold
    // `}}}`, which is what a JSON object closing right after an interpolation
    // hole looks like.
    private static string Base(string extra) =>
        "{\"name\":\"m\",\"parts\":[{\"name\":\"body\"}]" + extra + "}";

    private static string Anim(string clip) =>
        "{\"name\":\"m\",\"parts\":[{\"name\":\"body\"}],\"animations\":{\"walk\":" + clip + "}}";

    // ----- §6.9 the geometry list -----------------------------------------

    [Test]
    public void AnAbsentGeometryListMeansVoxelsJson()
    {
        Manifest m = Ok(Base(""));
        Assert.That(m.Geometry, Is.Null);
        Assert.That(ManifestReader.ManifestGeometry(m), Is.EqualTo(new[] { "voxels.json" }));
    }

    [Test]
    public void AnExplicitGeometryListIsUsedAsWritten()
    {
        Manifest m = Ok(Base(""","geometry":["a.json","b.json"]"""));
        Assert.That(ManifestReader.ManifestGeometry(m), Is.EqualTo(new[] { "a.json", "b.json" }));
    }

    [Test]
    public void ADuplicateOrEmptyGeometryListIsInvalidValueNotWrongArity()
    {
        // §11.5 groups "duplicate or empty `geometry` list" under
        // `invalid-value`, where §11.2 puts a palette's 0-or-over-62 under
        // `wrong-arity`. Two arrays spelled the same way, coded differently.
        Fails(Base(""","geometry":["a.json","a.json"]"""), CuboidyErrorCode.InvalidValue);
        Fails(Base(""","geometry":[]"""), CuboidyErrorCode.InvalidValue);
        Fails(Base(",\"geometry\":\"a.json\""), CuboidyErrorCode.InvalidValue);
    }

    // ----- §6.13 the two forms of a part's geometry -----------------------

    [TestCase("\"size\":[1,1,1]")]
    [TestCase("\"pivot\":{\"pos\":[0,0,0]}")]
    [TestCase("\"sockets\":[]")]
    [TestCase("\"voxels\":[[\".\"]]")]
    [TestCase("\"palette\":[\"#FF0000\"]")]
    public void AnInlineFieldBesideAPathIsUnknown(string field)
    {
        Fails(
            "{\"name\":\"m\",\"parts\":[{\"name\":\"body\",\"geometry\":{\"path\":\"v.json\","
            + field + "}}]}",
            CuboidyErrorCode.Unknown);
    }

    [Test]
    public void APathMayCarryPartAndNothingElse()
    {
        Manifest m = Ok("""{"name":"m","parts":[{"name":"body","geometry":{"path":"v.json","part":"beret"}}]}""");
        PartGeometry g = m.Parts[0].Geometry!;

        Assert.That(g.Path, Is.EqualTo("v.json"));
        Assert.That(g.Part, Is.EqualTo("beret"));
        Assert.That(g.Size, Is.Null);
        Assert.That(g.Voxels, Is.Null);
    }

    [Test]
    public void PartWithoutPathIsUnknownRatherThanIgnored()
    {
        // `part` names which part of a REFERENCED file to bind, so it is
        // meaningless without `path`. Written without one it used to parse and
        // then be destructured away in silence — which is the shape of the
        // actual authoring slip: naming the part and forgetting the file.
        Fails(
            """{"name":"m","parts":[{"name":"body","geometry":{"part":"beret","size":[1,1,1],"voxels":[["."]]}}]}""",
            CuboidyErrorCode.Unknown);
    }

    [Test]
    public void AnIncompleteInlineObjectIsMissing()
    {
        Fails("""{"name":"m","parts":[{"name":"body","geometry":{}}]}""", CuboidyErrorCode.Missing);
        Fails("""{"name":"m","parts":[{"name":"body","geometry":{"size":[1,1,1]}}]}""",
            CuboidyErrorCode.Missing);
        Fails("""{"name":"m","parts":[{"name":"body","geometry":{"voxels":[["."]]}}]}""",
            CuboidyErrorCode.Missing);
    }

    [Test]
    public void AnInlinePartIsRangeCheckedOnlyAgainstAPaletteItSpellsOutItself()
    {
        // Its own palette: phase 3, here.
        Fails(
            """{"name":"m","parts":[{"name":"body","geometry":{"size":[1,1,1],"voxels":[["5"]],"palette":["#FF0000"]}}]}""",
            CuboidyErrorCode.InvalidValue);

        // The MANIFEST's palette: deferred to §11.6 "even when the manifest's
        // palette is an array in the same document, so that where the colors
        // are written never changes when an error is reported" (§11.8).
        Ok("""{"name":"m","palette":["#FF0000"],"parts":[{"name":"body","geometry":{"size":[1,1,1],"voxels":[["5"]]}}]}""");
    }

    [Test]
    public void AnInlinePartGoesThroughTheSameCrossFieldChecksAsAFileOne()
    {
        Fails(
            """{"name":"m","parts":[{"name":"body","geometry":{"size":[2,1,1],"voxels":[["."]]}}]}""",
            CuboidyErrorCode.WrongArity);
        Fails(
            """{"name":"m","parts":[{"name":"b","geometry":{"size":[1,1,1],"voxels":[["."]],"sockets":[{"name":"g","pos":[0,0,0]},{"name":"g","pos":[1,0,0]}]}}]}""",
            CuboidyErrorCode.Duplicate);
    }

    // ----- §6.12 published sockets ----------------------------------------

    [Test]
    public void APublishedSocketNamesAPartOfThisModel()
    {
        Ok(Base(""","sockets":{"hand":{"part":"body","socket":"grip"}}"""));
        Fails(Base(""","sockets":{"hand":{"part":"ghost","socket":"grip"}}"""), CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void APublishedSocketNameIsAnIdentifierAndItsObjectIsClosed()
    {
        Fails(Base(""","sockets":{"1bad":{"part":"body","socket":"grip"}}"""), CuboidyErrorCode.InvalidValue);
        Fails(Base(""","sockets":{"hand":{"part":"body","socket":"g","x":1}}"""), CuboidyErrorCode.Unknown);
    }

    [Test]
    public void PublishedSocketsKeepDocumentOrder()
    {
        // Hazard C1: `Dictionary` guarantees no order and §6.12 is emitted per
        // entry. Written out of alphabetical order on purpose.
        Manifest m = Ok(Base(
            ""","sockets":{"zap":{"part":"body","socket":"a"},"anchor":{"part":"body","socket":"b"}}"""));

        Assert.That(m.Sockets.Keys, Is.EqualTo(new[] { "zap", "anchor" }));
        Assert.That(m.Sockets["anchor"].Socket, Is.EqualTo("b"));
    }

    [Test]
    public void AnAbsentSocketsMapIsEmptyRatherThanNull()
    {
        Manifest m = Ok(Base(""));
        Assert.That(m.Sockets, Is.Empty);
        Assert.That(m.Animations, Is.Empty);
    }

    // ----- §11.5 hierarchy -------------------------------------------------

    [Test]
    public void ASelfParentIsACycle()
    {
        Fails("""{"name":"m","parts":[{"name":"a","parent":"a"}]}""", CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void AParentThatNamesNoPartIsInvalidValue()
    {
        Fails("""{"name":"m","parts":[{"name":"a"},{"name":"b","parent":"ghost"}]}""",
            CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void ADeepChainIsFineAndForwardReferencesAreAllowed()
    {
        Manifest m = Ok(
            """{"name":"m","parts":[{"name":"hand","parent":"arm"},{"name":"arm","parent":"torso"},{"name":"torso"}]}""");
        Assert.That(m.Parts.Select(p => p.Name), Is.EqualTo(new[] { "hand", "arm", "torso" }));
    }

    // ----- §6.3 animations -------------------------------------------------

    [Test]
    public void AnAnimationIsEitherAnObjectOrAReference()
    {
        Manifest m = Ok(Anim("\"anims/walk.json\""));
        Assert.That(m.Animations["walk"].IsInline, Is.False);
        Assert.That(m.Animations["walk"].Ref, Is.EqualTo("anims/walk.json"));

        Manifest inline = Ok(Anim("""{"duration":1,"loop":true,"parts":{}}"""));
        Assert.That(inline.Animations["walk"].IsInline, Is.True);
        Assert.That(inline.Animations["walk"].Inline!.Duration, Is.EqualTo(1));
        Assert.That(inline.Animations["walk"].Inline!.Loop, Is.True);
    }

    [Test]
    public void ABadAnimationReferenceIsInvalidValue()
    {
        Fails(Anim("\"anims/walk.txt\""), CuboidyErrorCode.InvalidValue);
        Fails(Anim("7"), CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void AnAnimationNameIsAnIdentifier()
    {
        Fails("""{"name":"m","parts":[{"name":"body"}],"animations":{"1bad":"a.json"}}""",
            CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void ATrackKeyIsAPartNameEvenWhenTheModelLacksThatPart()
    {
        // §6.8 permits a track to target a part the model lacks; it does not
        // permit the key to be something that could not be a part name at all.
        Ok(Anim("""{"duration":1,"loop":true,"parts":{"wing":{"0.0":{}}}}"""));
        Fails(Anim("""{"duration":1,"loop":true,"parts":{"1bad":{"0.0":{}}}}"""),
            CuboidyErrorCode.InvalidValue);
    }

    [TestCase("""{"duration":1,"loop":true,"parts":{"body":{"1":{}}}}""")]
    [TestCase("""{"duration":1,"loop":true,"parts":{"body":{"0.5":{}}}}""")]
    [TestCase("""{"duration":1,"loop":true,"parts":{"body":{"0.0":{},"2.0":{}}}}""")]
    [TestCase("""{"duration":0,"loop":true,"parts":{"body":{"0.0":{}}}}""")]
    [TestCase("""{"duration":-1,"loop":true,"parts":{"body":{"0.0":{}}}}""")]
    public void TheSection66TimeKeyRulesAreEnforced(string clip)
    {
        Fails(Anim(clip), CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void ATimeKeyEndingInANewlineIsNotADecimalNumberString()
    {
        // Hazard S1's sixth site, and the nastiest: .NET's `$` matches before a
        // trailing newline AND `NumberStyles.Float` allows trailing whitespace,
        // so a `$`-based port accepts `"0.0\n"` through BOTH the regex and the
        // parse and never notices. Measured: the reference rejects it.
        Fails(Anim("""{"duration":1,"loop":true,"parts":{"body":{"0.0\n":{}}}}"""),
            CuboidyErrorCode.InvalidValue);
        Fails(Anim("""{"duration":1,"loop":true,"parts":{"body":{"0.0":{},"0.5\n":{}}}}"""),
            CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void TimeKeysAreValidatedInDocumentOrder()
    {
        // Hazard C2, and the one rule §6.6's decimal point exists to make
        // cross-implementation. `Dictionary` enumeration order is explicitly
        // unspecified, so validating by enumerating a deserialized dictionary
        // relies on undefined behaviour.
        Fails(Anim("""{"duration":2,"loop":true,"parts":{"body":{"0.0":{},"1.5":{},"1.0":{}}}}"""),
            CuboidyErrorCode.InvalidValue);
        Ok(Anim("""{"duration":2,"loop":true,"parts":{"body":{"0.0":{},"1.0":{},"1.5":{}}}}"""));
    }

    [Test]
    public void ADuplicateTimeKeyCollapsesLastWinsRatherThanFailingToIncrease()
    {
        // Hazard C3, which names time keys as the case that matters.
        // `JSON.parse('{"0.0":{},"0.0":{}}')` yields ONE key, so the reference
        // accepts this; a reader that kept both would reject it for not
        // strictly increasing. Measured.
        Manifest m = Ok(Anim(
            """{"duration":1,"loop":true,"parts":{"body":{"0.0":{"visible":true},"0.0":{"visible":false}}}}"""));

        AnimationTrack track = m.Animations["walk"].Inline!.Parts["body"];
        Assert.That(track.Keys.Count, Is.EqualTo(1));
        Assert.That(track.Keys["0.0"].Visible, Is.False);
    }

    [Test]
    public void TrackKeysKeepDocumentOrderAndTheirSpelling()
    {
        Manifest m = Ok(Anim("""{"duration":2,"loop":false,"parts":{"body":{"0.0":{},"0.50":{},"1.0":{}}}}"""));
        AnimationTrack track = m.Animations["walk"].Inline!.Parts["body"];

        Assert.That(track.Keys.Keys, Is.EqualTo(new[] { "0.0", "0.50", "1.0" }));
    }

    [Test]
    public void AnUnknownEasePresetIsUnknownWhileAWrongTypeIsInvalidValue()
    {
        // §11.2 files a STRING outside a closed set under `unknown`, and a
        // value of the wrong JSON type for its field under `invalid-value`. So
        // the VALUE has to be looked at, not just the failure.
        Fails(Anim("""{"duration":1,"loop":true,"parts":{"body":{"0.0":{"ease":{"rot":"nope"}}}}}"""),
            CuboidyErrorCode.Unknown);
        Fails(Anim("""{"duration":1,"loop":true,"parts":{"body":{"0.0":{"ease":{"rot":123}}}}}"""),
            CuboidyErrorCode.InvalidValue);
    }

    [Test]
    public void AKnownEasePresetReadsBackAsItself()
    {
        Manifest m = Ok(Anim(
            """{"duration":1,"loop":true,"parts":{"body":{"0.0":{"ease":{"rot":"in-out-back"}}}}}"""));
        EaseMap ease = m.Animations["walk"].Inline!.Parts["body"].Keys["0.0"].Ease!;

        Assert.That(ease.Rot, Is.EqualTo(EasingName.InOutBack));
        Assert.That(ease.Pos, Is.Null);
        Assert.That(ease.Scale, Is.Null);
    }

    [Test]
    public void TheKeyframeAndEaseObjectsAreClosed()
    {
        Fails(Anim("""{"duration":1,"loop":true,"parts":{"body":{"0.0":{"q":1}}}}"""),
            CuboidyErrorCode.Unknown);
        Fails(Anim("""{"duration":1,"loop":true,"parts":{"body":{"0.0":{"ease":{"q":"linear"}}}}}"""),
            CuboidyErrorCode.Unknown);
    }

    [Test]
    [NonParallelizable]
    public void ATimeKeyIsParsedInvariantly()
    {
        // Hazard N2, at one of the two string→double conversions in the whole
        // closure. Under de-DE the culture-sensitive overload reads "1.5" as
        // 15, which would put this key past its own duration.
        using (new CultureScope(CultureScope.DecimalComma))
        {
            Ok(Anim("""{"duration":2,"loop":true,"parts":{"body":{"0.0":{},"1.5":{}}}}"""));
            Fails(Anim("""{"duration":1,"loop":true,"parts":{"body":{"0.0":{},"1.5":{}}}}"""),
                CuboidyErrorCode.InvalidValue);
        }
    }

    // ----- against the shipped models --------------------------------------

    [Test]
    public void TheSubmersibleManifestReadsWithItsSocketsAndClips()
    {
        Manifest m = Ok(File.ReadAllText(Path.Combine(TestPaths.ModelsDir, "submersible", "cuboidy.json")));

        Assert.That(m.Name, Is.EqualTo("submersible"));
        Assert.That(m.Parts, Is.Not.Empty);
        Assert.That(m.Animations, Is.Not.Empty);
        foreach (var entry in m.Animations)
        {
            Assert.That(entry.Value.IsInline || entry.Value.Ref is not null, Is.True, entry.Key);
        }
    }

    [Test]
    public void EveryShippedClipFileIsAValidInlineAnimationWhenReadThroughAManifest()
    {
        // §6.3 external clips are validated with the same inline rules when the
        // project is resolved. The resolver is not here yet, so this checks the
        // rules against the files directly by wrapping each one.
        foreach (string path in Directory.GetFiles(TestPaths.ModelsDir, "*.json", SearchOption.AllDirectories))
        {
            if (Path.GetFileName(Path.GetDirectoryName(path)!) != "anims") continue;

            Result<Manifest> r = Parse(Anim(File.ReadAllText(path)));
            Assert.That(r.Ok, Is.True, () => $"{path}: {r.Code.ToWire()} — {r.Message}");
            Assert.That(r.Value.Animations["walk"].IsInline, Is.True, path);
        }
    }

    // ----- §6.2 (v0.9) rest scale ------------------------------------------

    [Test]
    public void AcceptsAPartScaleTriple()
    {
        Manifest m = Ok("{\"name\":\"m\",\"parts\":[{\"name\":\"hair\",\"scale\":[1.1,1.1,1.1]}]}");
        Assert.That(m.Parts[0].Scale, Is.EqualTo(new Vec3(1.1, 1.1, 1.1)));
    }

    [Test]
    public void AcceptsANonUniformScale()
    {
        Manifest m = Ok("{\"name\":\"m\",\"parts\":[{\"name\":\"hair\",\"scale\":[1.2,1,0.8]}]}");
        Assert.That(m.Parts[0].Scale, Is.EqualTo(new Vec3(1.2, 1, 0.8)));
    }

    [Test]
    public void LeavesScaleNullWhenOmitted()
    {
        Manifest m = Ok("{\"name\":\"m\",\"parts\":[{\"name\":\"body\"}]}");
        Assert.That(m.Parts[0].Scale, Is.Null);
    }

    // Zero collapses the part, which is `visible: false` said in a way no
    // reader expects; a negative factor mirrors it, reversing face winding.
    [Test]
    public void RejectsAZeroScaleFactor() =>
        Fails(
            "{\"name\":\"m\",\"parts\":[{\"name\":\"body\",\"scale\":[1,0,1]}]}",
            CuboidyErrorCode.InvalidValue);

    [Test]
    public void RejectsANegativeScaleFactor() =>
        Fails(
            "{\"name\":\"m\",\"parts\":[{\"name\":\"body\",\"scale\":[-1,1,1]}]}",
            CuboidyErrorCode.InvalidValue);

    [Test]
    public void RejectsAScaleWithTheWrongArity() =>
        Fails(
            "{\"name\":\"m\",\"parts\":[{\"name\":\"body\",\"scale\":[1.1,1.1]}]}",
            CuboidyErrorCode.WrongArity);

    // §6.2 + §6.5: the two scales are one operator reached twice, so a part's
    // total scale is their product and the order is unobservable.
    [Test]
    public void ComposeScaleMultipliesPerAxisAndCommutes()
    {
        Assert.That(
            Runtime.RigTransform.ComposeScale(new Vec3(2, 3, 4), new Vec3(0.5, 2, 0.25)),
            Is.EqualTo(new Vec3(1, 6, 1)));
        Assert.That(
            Runtime.RigTransform.ComposeScale(new Vec3(1.1, 2, 0.5), new Vec3(3, 0.25, 4)),
            Is.EqualTo(Runtime.RigTransform.ComposeScale(new Vec3(3, 0.25, 4), new Vec3(1.1, 2, 0.5))));
    }

    [Test]
    public void ComposeScaleLeavesTheOtherSideAloneAndStaysNullWhenNeitherIsSet()
    {
        Assert.That(Runtime.RigTransform.ComposeScale(null, new Vec3(2, 2, 2)), Is.EqualTo(new Vec3(2, 2, 2)));
        Assert.That(Runtime.RigTransform.ComposeScale(new Vec3(2, 2, 2), null), Is.EqualTo(new Vec3(2, 2, 2)));
        Assert.That(Runtime.RigTransform.ComposeScale(null, null), Is.Null);
    }

    // §7.7: scale acts on the pivot-relative offset, so the pivot is the one
    // point it leaves alone. Same numbers the reference's own test pins.
    [Test]
    public void ScaleGrowsAPartAboutItsPivot()
    {
        var world = new Runtime.Frame(new Vec3(10, 0, 0), Runtime.Quat.Identity);
        var pivot = new Vec3(3, 0, 3);

        Assert.That(
            Runtime.RigTransform.LocalPointToWorld(pivot, pivot, new Vec3(2, 2, 2), world),
            Is.EqualTo(new Vec3(10, 0, 0)));
        // The corner sits 3 out in x from the pivot, so 1.5x puts it 4.5 out.
        Assert.That(
            Runtime.RigTransform.LocalPointToWorld(new Vec3(6, 0, 3), pivot, new Vec3(1.5, 1.5, 1.5), world),
            Is.EqualTo(new Vec3(14.5, 0, 0)));
        // Per axis, on its own.
        Assert.That(
            Runtime.RigTransform.LocalPointToWorld(new Vec3(6, 2, 6), pivot, new Vec3(1, 2, 3), world),
            Is.EqualTo(new Vec3(13, 4, 9)));
        Assert.That(
            Runtime.RigTransform.LocalPointToWorld(new Vec3(6, 2, 6), pivot, null, world),
            Is.EqualTo(new Vec3(13, 2, 3)));
    }
}
