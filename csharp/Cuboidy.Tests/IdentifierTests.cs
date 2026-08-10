using NUnit.Framework;

namespace Cuboidy.Tests;

[TestFixture]
public class IdentifierTests
{
    [TestCase("head")]
    [TestCase("_head")]
    [TestCase("H")]
    [TestCase("arm-l")]
    [TestCase("bone_02")]
    [TestCase("a0-_Z")]
    public void AcceptsTheSection5Shape(string s)
    {
        Assert.That(Identifier.IsIdentifier(s), Is.True);
    }

    [TestCase("")]
    [TestCase("0head")]
    [TestCase("-head")]
    [TestCase("head.l")]
    [TestCase("head l")]
    [TestCase("héad")]
    [TestCase("head/l")]
    public void RejectsWhatTheShapeForbids(string s)
    {
        Assert.That(Identifier.IsIdentifier(s), Is.False);
    }

    [TestCase("palette")]
    [TestCase("part")]
    [TestCase("size")]
    [TestCase("pivot")]
    [TestCase("socket")]
    [TestCase("voxels")]
    [TestCase("rot")]
    public void RejectsTheReservedKeywords(string s)
    {
        Assert.That(Identifier.IsIdentifier(s), Is.False);
        Assert.That(Identifier.IsReservedKeyword(s), Is.True);
    }

    [Test]
    public void TheReservedListIsExactlyTheSevenSpecNames()
    {
        Assert.That(Identifier.ReservedKeywords, Is.EqualTo(new[]
        {
            "palette", "part", "size", "pivot", "socket", "voxels", "rot",
        }));
    }

    [Test]
    public void ATrailingNewlineIsNotAnIdentifier()
    {
        // Hazard S1: .NET's `$` also matches immediately before a trailing
        // newline, so the literal translation of the reference's `/...$/`
        // accepts `"name": "head\n"` where TypeScript rejects it. The pattern
        // uses `\z` for exactly this.
        Assert.That(Identifier.IsIdentifier("head\n"), Is.False);
        Assert.That(Identifier.IsIdentifier("head\r\n"), Is.False);
        Assert.That(Identifier.IsIdentifier("\nhead"), Is.False);
    }

    [Test]
    [NonParallelizable]
    public void CaseFoldingNeverEntersTheReservedCheck()
    {
        // Hazard S4: under tr-TR, `"PART".ToLower()` is "part" only if the
        // fold is invariant — the dotless i makes `"I".ToLower()` an ı — and a
        // reserved check that folded at all would reject names §5 permits.
        // The comparison is ordinal, so case never matters in either culture.
        using (new CultureScope(CultureScope.DotlessI))
        {
            Assert.That(Identifier.IsIdentifier("PART"), Is.True);
            Assert.That(Identifier.IsIdentifier("Part"), Is.True);
            Assert.That(Identifier.IsIdentifier("SIZE"), Is.True);
            Assert.That(Identifier.IsIdentifier("part"), Is.False);
            Assert.That(Identifier.IsIdentifier("I"), Is.True);
            Assert.That(Identifier.IsIdentifier("i"), Is.True);
        }
    }
}
