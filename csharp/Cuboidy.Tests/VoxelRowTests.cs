using System;
using NUnit.Framework;

namespace Cuboidy.Tests;

[TestFixture]
public class VoxelRowTests
{
    [Test]
    public void TheAlphabetIsDigitsThenLowercaseThenUppercase()
    {
        Assert.That(VoxelRow.CharToIndex('.'), Is.EqualTo(VoxelRow.Air));
        Assert.That(VoxelRow.CharToIndex('0'), Is.EqualTo(0));
        Assert.That(VoxelRow.CharToIndex('9'), Is.EqualTo(9));
        Assert.That(VoxelRow.CharToIndex('a'), Is.EqualTo(10));
        Assert.That(VoxelRow.CharToIndex('z'), Is.EqualTo(35));
        Assert.That(VoxelRow.CharToIndex('A'), Is.EqualTo(36));
        Assert.That(VoxelRow.CharToIndex('Z'), Is.EqualTo(61));
    }

    [TestCase('*')]
    [TestCase(' ')]
    [TestCase('-')]
    [TestCase('_')]
    [TestCase('\n')]
    [TestCase('é')]
    public void AnythingOutsideItIsNotACell(char c)
    {
        Assert.That(VoxelRow.CharToIndex(c), Is.Null);
    }

    [Test]
    public void AirIsMinusOneAndNotAPaletteIndex()
    {
        // The value matters: `Mesh.VoxelAt` returns it for an out-of-bounds
        // read, and every palette index is >= 0.
        Assert.That(VoxelRow.Air, Is.EqualTo(-1));
    }

    [Test]
    public void IndexToCharRoundTripsTheWholeSpace()
    {
        Assert.That(VoxelRow.IndexToChar(VoxelRow.Air), Is.EqualTo('.'));
        for (int i = 0; i <= 61; i++)
        {
            char c = VoxelRow.IndexToChar(i);
            Assert.That(VoxelRow.CharToIndex(c), Is.EqualTo(i), $"index {i} round-tripped through '{c}'");
        }
    }

    [Test]
    public void TheTwoNonAlphanumericSlotsMapBothWays()
    {
        // The reason they exist: 62 is what three runs of digits and letters happen to
        // total, and it left a 64-colour palette two short of fitting in one file.
        Assert.That(VoxelRow.CharToIndex('$'), Is.EqualTo(62));
        Assert.That(VoxelRow.CharToIndex('%'), Is.EqualTo(63));
        Assert.That(VoxelRow.IndexToChar(62), Is.EqualTo('$'));
        Assert.That(VoxelRow.IndexToChar(63), Is.EqualTo('%'));
    }

    [Test]
    public void ACharacterOutsideTheAlphabetIsStillRejected()
    {
        // Widening the alphabet by two must not widen it by more: '#' looks like a
        // colour literal and '@' like a fill, and neither is an index.
        foreach (char c in new[] { '#', '@', '!', '-', ',', ' ' })
            Assert.That(VoxelRow.CharToIndex(c), Is.Null, $"'{c}' is not an index");
    }

    [TestCase(-2)]
    [TestCase(64)]
    public void IndexToCharRaisesOutsideTheSixtyFourSlots(int index)
    {
        Assert.That(() => VoxelRow.IndexToChar(index), Throws.InstanceOf<ArgumentOutOfRangeException>());
    }
}
