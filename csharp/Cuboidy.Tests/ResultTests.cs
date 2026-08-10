using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace Cuboidy.Tests;

[TestFixture]
public class ResultTests
{
    [Test]
    public void OkCarriesItsValue()
    {
        Result<int> r = Result.Ok(7);
        Assert.That(r.Ok, Is.True);
        Assert.That(r.Value, Is.EqualTo(7));
        Assert.That(r.Path, Is.Null);
    }

    [Test]
    public void ErrCarriesCodeMessageAndPath()
    {
        var path = new List<PathSegment> { "parts", 2, "size" };
        Result<int> r = Result.Err<int>(CuboidyErrorCode.WrongArity, "not a triple", path);

        Assert.That(r.Ok, Is.False);
        Assert.That(r.Code, Is.EqualTo(CuboidyErrorCode.WrongArity));
        Assert.That(r.Message, Is.EqualTo("not a triple"));
        Assert.That(r.Path, Is.EqualTo(path));
    }

    [Test]
    public void ReadingTheValueOfAnErrorRaises()
    {
        Result<int> r = Result.Err<int>(CuboidyErrorCode.Missing, "no size");
        Assert.That(() => r.Value, Throws.InstanceOf<InvalidOperationException>());
    }

    [Test]
    public void ToErrorCarriesAFailureAcrossATypeChange()
    {
        var path = new List<PathSegment> { "parts", 0 };
        Result<string> original = Result.Err<string>(CuboidyErrorCode.Duplicate, "two parts named head", path);

        Result<Geometry> carried = original.ToError<Geometry>();

        Assert.That(carried.Ok, Is.False);
        Assert.That(carried.Code, Is.EqualTo(CuboidyErrorCode.Duplicate));
        Assert.That(carried.Message, Is.EqualTo("two parts named head"));
        Assert.That(carried.Path, Is.EqualTo(path));
    }

    [Test]
    public void ToErrorOnAnOkResultRaises()
    {
        Result<int> r = Result.Ok(1);
        Assert.That(() => r.ToError<string>(), Throws.InstanceOf<InvalidOperationException>());
    }

    [Test]
    public void TryGetValueReportsBothBranches()
    {
        Assert.That(Result.Ok(3).TryGetValue(out int v), Is.True);
        Assert.That(v, Is.EqualTo(3));
        Assert.That(Result.Err<int>(CuboidyErrorCode.Missing, "x").TryGetValue(out _), Is.False);
    }

    [Test]
    public void EveryCodeHasTheWireSpellingSpecUsesAndRoundTrips()
    {
        var expected = new Dictionary<CuboidyErrorCode, string>
        {
            [CuboidyErrorCode.Missing] = "missing",
            [CuboidyErrorCode.Duplicate] = "duplicate",
            [CuboidyErrorCode.Unknown] = "unknown",
            [CuboidyErrorCode.InvalidValue] = "invalid-value",
            [CuboidyErrorCode.WrongArity] = "wrong-arity",
        };

        foreach (CuboidyErrorCode code in Enum.GetValues<CuboidyErrorCode>())
        {
            Assert.That(expected.ContainsKey(code), Is.True, $"{code} has no expected wire spelling");
            Assert.That(code.ToWire(), Is.EqualTo(expected[code]));
            Assert.That(CuboidyErrorCodeExtensions.TryParseWire(expected[code], out CuboidyErrorCode back), Is.True);
            Assert.That(back, Is.EqualTo(code));
        }
    }

    [Test]
    public void AnUnknownWireSpellingDoesNotParse()
    {
        Assert.That(CuboidyErrorCodeExtensions.TryParseWire("invalid_value", out _), Is.False);
        Assert.That(CuboidyErrorCodeExtensions.TryParseWire("", out _), Is.False);
    }

    [Test]
    public void PathSegmentTellsKeysFromIndices()
    {
        PathSegment key = "voxels";
        PathSegment index = 3;

        Assert.That(key.IsIndex, Is.False);
        Assert.That(key.AsKey, Is.EqualTo("voxels"));
        Assert.That(() => key.AsIndex, Throws.InstanceOf<InvalidOperationException>());

        Assert.That(index.IsIndex, Is.True);
        Assert.That(index.AsIndex, Is.EqualTo(3));
        Assert.That(() => index.AsKey, Throws.InstanceOf<InvalidOperationException>());
    }

    [Test]
    public void PathSegmentKeysAndIndicesAreNeverEqualToEachOther()
    {
        Assert.That(PathSegment.Key("0"), Is.Not.EqualTo(PathSegment.Index(0)));
        Assert.That(PathSegment.Key("size"), Is.EqualTo(PathSegment.Key("size")));
        Assert.That(PathSegment.Index(2), Is.EqualTo(PathSegment.Index(2)));
    }

    [Test]
    [NonParallelizable]
    public void PathSegmentFormatsAnIndexInvariantly()
    {
        // Hazard N2. A path segment reaches a diagnostic message, and messages
        // are read across implementations.
        using (new CultureScope(CultureScope.DecimalComma))
        {
            Assert.That(PathSegment.Index(1234).ToString(), Is.EqualTo("1234"));
        }
    }
}
