using System.Collections.Generic;
using NUnit.Framework;

namespace Cuboidy.Tests;

// Every expectation in this file is a MEASURED reference position, not a
// recomputed one — `locateJsonPath` from `@cuboidy/core` was run over the same
// documents and its line/column pairs are what these assert. Two of them were
// wrong when derived by hand, in both directions.
//
// The documents are joined with an explicit "\n" rather than written as
// multi-line literals: a column is a count of UTF-16 code units, so a source
// file checked out with CRLF would silently shift every one of them.
[TestFixture]
public class LocateTests
{
    private static readonly string Doc = string.Join("\n",
        "{",
        "  \"version\": \"0.9\",",
        "  \"palette\": [\"#FF0000\", \"#00FF00\"],",
        "  \"parts\": [",
        "    { \"name\": \"grip\", \"size\": [3, 6, 2] },",
        "    {",
        "      \"name\": \"blade\",",
        "      \"voxels\": [[\"0\"]]",
        "    }",
        "  ]",
        "}");

    private static void At(int line, int column, params PathSegment[] path)
    {
        Position? actual = Locate.LocateJsonPath(Doc, path);
        Assert.That(actual, Is.Not.Null, () => string.Join(".", path));
        Assert.That(actual!.Value, Is.EqualTo(new Position(line, column)), () => string.Join(".", path));
    }

    [Test]
    public void TheRootIsTheFirstCharacter()
    {
        At(1, 1);
    }

    [Test]
    public void AnObjectKeyResolvesToItsValue()
    {
        At(2, 14, "version");
        At(3, 14, "palette");
        At(4, 12, "parts");
    }

    [Test]
    public void AnArrayIndexResolvesToItsElement()
    {
        At(3, 15, "palette", 0);
        At(3, 26, "palette", 1);
        At(5, 5, "parts", 0);
        At(6, 5, "parts", 1);
    }

    [Test]
    public void APathDescendsThroughContainersItHasToSkipOver()
    {
        At(8, 17, "parts", 1, "voxels");
        At(5, 31, "parts", 0, "size");
    }

    [Test]
    public void AnAbsentSegmentFallsBackToItsDeepestResolvedAncestor()
    {
        // The usual case for a missing required field: `parts.1.size` on a part
        // with no `size` points at that part, which is where the author looks.
        At(6, 5, "parts", 1, "size");
        At(5, 31, "parts", 0, "size", 9);
    }

    [Test]
    public void AKeyIndexMismatchGivesUpRatherThanGuessing()
    {
        // Asking for an index inside an object, or a key inside an array, is
        // the wrong kind of container: the deepest resolved ancestor stands.
        At(4, 12, "parts", "name");
        At(2, 14, "version", 0);
    }

    [Test]
    public void ColumnsAreCountedInUtf16CodeUnitsLikeTheReference()
    {
        // Hazard S3. The reference counts UTF-16 code units because JavaScript
        // strings are UTF-16; a `Utf8JsonReader`-based port would have BYTE
        // offsets, and the two bytes `café` costs would push this column to 13.
        // A .NET string is UTF-16 too, so scanning one agrees exactly. §5 keeps
        // identifiers ASCII, but a colour name or a path need not be.
        string text = "{\n  \"n\": \"café\",\n  \"after\": 1\n}";

        Assert.That(
            Locate.LocateJsonPath(text, new PathSegment[] { "after" }),
            Is.EqualTo(new Position(3, 12)));
    }

    [Test]
    public void AnEscapedQuoteInsideAKeyDoesNotEndTheString()
    {
        // `{"a\"b": 1, "c": 2}`. A scanner that stopped at the escaped quote
        // would lose the walk entirely and land somewhere inside the first key.
        string text = "{\"a\\\"b\": 1, \"c\": 2}";

        Assert.That(
            Locate.LocateJsonPath(text, new PathSegment[] { "c" }),
            Is.EqualTo(new Position(1, 18)));
    }

    [Test]
    public void AColumnCountsFromOne()
    {
        Assert.That(Locate.PositionAt(Doc, 0), Is.EqualTo(new Position(1, 1)));
        Assert.That(Locate.PositionAt("ab\ncd", 3), Is.EqualTo(new Position(2, 1)));
        Assert.That(Locate.PositionAt("ab\ncd", 4), Is.EqualTo(new Position(2, 2)));
    }

    [Test]
    public void AnOffsetOutsideTheTextIsClampedRatherThanRaising()
    {
        Assert.That(Locate.PositionAt("abc", -5), Is.EqualTo(new Position(1, 1)));
        Assert.That(Locate.PositionAt("abc", 99), Is.EqualTo(new Position(1, 4)));
    }

    [Test]
    public void AnEmptyDocumentHasNoPosition()
    {
        Assert.That(Locate.LocateJsonPath("", new List<PathSegment>()), Is.Null);
        Assert.That(Locate.LocateJsonPath("   ", new List<PathSegment>()), Is.Null);
    }
}
