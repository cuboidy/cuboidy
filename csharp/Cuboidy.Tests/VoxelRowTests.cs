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

    [TestCase(-2)]
    [TestCase(62)]
    public void IndexToCharRaisesOutsideTheSixtyTwoSlots(int index)
    {
        Assert.That(() => VoxelRow.IndexToChar(index), Throws.InstanceOf<ArgumentOutOfRangeException>());
    }
}
