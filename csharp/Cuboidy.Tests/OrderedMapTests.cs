using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

[TestFixture]
public class OrderedMapTests
{
    private static OrderedMap<int> Of(params (string Key, int Value)[] entries) =>
        OrderedMap<int>.From(entries.Select(e => new KeyValuePair<string, int>(e.Key, e.Value)));

    [Test]
    public void KeysComeBackInTheOrderTheyWentIn()
    {
        // Hazard C1, and the whole reason this type exists: `Dictionary`
        // guarantees no order, and every §6 map this library reads is emitted
        // per entry by something downstream.
        OrderedMap<int> map = Of(("zap", 1), ("anchor", 2), ("mid", 3));

        Assert.That(map.Keys, Is.EqualTo(new[] { "zap", "anchor", "mid" }));
        Assert.That(map.Select(e => e.Value), Is.EqualTo(new[] { 1, 2, 3 }));
    }

    [Test]
    public void ADuplicateKeyTakesTheLastValueAndTheFirstPosition()
    {
        // What `JSON.parse` gives: the second assignment replaces the value and
        // does not move the key.
        OrderedMap<int> map = Of(("a", 1), ("b", 2), ("a", 3));

        Assert.That(map.Keys, Is.EqualTo(new[] { "a", "b" }));
        Assert.That(map["a"], Is.EqualTo(3));
        Assert.That(map.Count, Is.EqualTo(2));
    }

    [Test]
    public void LookupAndIndexingAgree()
    {
        OrderedMap<int> map = Of(("a", 1), ("b", 2));

        Assert.That(map[0].Key, Is.EqualTo("a"));
        Assert.That(map[1].Value, Is.EqualTo(2));
        Assert.That(map.ContainsKey("b"), Is.True);
        Assert.That(map.TryGetValue("b", out int v), Is.True);
        Assert.That(v, Is.EqualTo(2));
        Assert.That(map.TryGetValue("nope", out _), Is.False);
    }

    [Test]
    public void EmptyIsShared()
    {
        Assert.That(OrderedMap<int>.Empty, Is.Empty);
        Assert.That(Of(), Is.SameAs(OrderedMap<int>.Empty));
    }

    [Test]
    [NonParallelizable]
    public void KeysAreComparedOrdinally()
    {
        // Hazard S4/S6: two §5 identifiers that differ only in case are two
        // different names, in every culture.
        using (new CultureScope(CultureScope.DotlessI))
        {
            OrderedMap<int> map = Of(("Arm", 1), ("arm", 2));

            Assert.That(map.Count, Is.EqualTo(2));
            Assert.That(map["Arm"], Is.EqualTo(1));
            Assert.That(map["arm"], Is.EqualTo(2));
        }
    }
}
