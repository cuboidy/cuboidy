using NUnit.Framework;

namespace Cuboidy.Tests;

[TestFixture]
public class PaletteCodecTests
{
    [Test]
    public void ShortFormsExpandByDuplicatingEachNibble()
    {
        Assert.That(PaletteCodec.ParseHexColor("#F00"), Is.EqualTo(new Color(0xFF, 0x00, 0x00, 0xFF)));
        Assert.That(PaletteCodec.ParseHexColor("#1234"), Is.EqualTo(new Color(0x11, 0x22, 0x33, 0x44)));
    }

    [Test]
    public void LongFormsReadPairsAndDefaultAlphaToOpaque()
    {
        Assert.That(PaletteCodec.ParseHexColor("#C0C4CC"), Is.EqualTo(new Color(0xC0, 0xC4, 0xCC, 0xFF)));
        Assert.That(PaletteCodec.ParseHexColor("#FFD07AB4"), Is.EqualTo(new Color(0xFF, 0xD0, 0x7A, 0xB4)));
    }

    [Test]
    public void CaseDoesNotMatterForAHexDigit()
    {
        Assert.That(PaletteCodec.ParseHexColor("#abcdef"), Is.EqualTo(PaletteCodec.ParseHexColor("#ABCDEF")));
    }

    [TestCase("")]
    [TestCase("#")]
    [TestCase("FF0000")]
    [TestCase("#12345")]
    [TestCase("#1234567")]
    [TestCase("#123456789")]
    [TestCase("#GG0000")]
    [TestCase("#FF 0000")]
    [TestCase("#FF0000\n")]
    public void AnythingOutsideTheFourFormsIsNotAColor(string s)
    {
        Assert.That(PaletteCodec.ParseHexColor(s), Is.Null);
    }

    [Test]
    [NonParallelizable]
    public void HexDigitsAreFoldedInvariantly()
    {
        // Hazard S4: the Turkish dotless ı. `#ABCDEF` decodes the same
        // everywhere because the nibble mapping never folds case at all.
        using (new CultureScope(CultureScope.DotlessI))
        {
            Assert.That(PaletteCodec.ParseHexColor("#abcdef"), Is.EqualTo(new Color(0xAB, 0xCD, 0xEF, 0xFF)));
            Assert.That(PaletteCodec.ParseHexColor("#ABCDEF"), Is.EqualTo(new Color(0xAB, 0xCD, 0xEF, 0xFF)));
        }
    }

    [Test]
    public void AnEntryThatSaysNothingIsMatte()
    {
        PaletteEntry? entry = PaletteCodec.PaletteEntryFrom(new PaletteEntryDoc("#FF0000"));

        Assert.That(entry, Is.Not.Null);
        Assert.That(entry!.Value.Material, Is.EqualTo(PaletteCodec.Matte));
        Assert.That(PaletteCodec.Matte, Is.EqualTo(new Material(0, 1, 0)));
    }

    [Test]
    public void TheBareStringFormAndAnObjectWithNoMaterialAreTheSameEntry()
    {
        // Which is why the two §7.4 forms collapse into one DTO here rather
        // than needing the hand-written union converter hazard T1 warns about.
        PaletteEntry? bare = PaletteCodec.PaletteEntryFrom(new PaletteEntryDoc("#FF0000"));
        PaletteEntry? spelled = PaletteCodec.PaletteEntryFrom(new PaletteEntryDoc("#FF0000", null, null, null));

        Assert.That(bare, Is.EqualTo(spelled));
    }

    [Test]
    public void EachMaterialFieldDefaultsOnItsOwn()
    {
        // Hazard T2 in isolation: `roughness` defaults to 1 and the other two
        // to 0, so an entry that sets only `emissive` must not come back as a
        // mirror.
        PaletteEntry? entry = PaletteCodec.PaletteEntryFrom(new PaletteEntryDoc("#FFE9A8", null, null, 1));

        Assert.That(entry!.Value.Material, Is.EqualTo(new Material(0, 1, 1)));
    }

    [Test]
    public void AMalformedColorIsTheOnlyReasonAnEntryFails()
    {
        Assert.That(PaletteCodec.PaletteEntryFrom(new PaletteEntryDoc("#12345")), Is.Null);
    }

    [Test]
    public void TheIndexSpaceIsSixtyTwoWide()
    {
        Assert.That(PaletteCodec.MaxPalette, Is.EqualTo(62));
    }
}
