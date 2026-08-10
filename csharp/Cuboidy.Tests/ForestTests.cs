using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace Cuboidy.Tests;

[TestFixture]
public class ForestTests
{
    private sealed record Item(string Id, string? Parent);

    private static Hierarchy Resolve(params Item[] items) =>
        Forest.ResolveHierarchy(items, i => i.Id, i => i.Parent);

    [Test]
    public void ARootHasNoParent()
    {
        Hierarchy h = Resolve(new Item("root", null));

        Assert.That(h.ParentOf["root"], Is.Null);
        Assert.That(h.Dropped, Is.Empty);
        Assert.That(h.Order, Is.EqualTo(new[] { "root" }));
    }

    [Test]
    public void EveryItemFollowsItsEffectiveParentInOrder()
    {
        // Declared child-first, so a caller walking `Order` would compose a
        // transform before its parent had one if the order were input order.
        Hierarchy h = Resolve(
            new Item("hand", "arm"),
            new Item("arm", "torso"),
            new Item("torso", null));

        Assert.That(h.Order, Is.EqualTo(new[] { "torso", "arm", "hand" }));
    }

    [Test]
    public void OrderIsStableWithRespectToInputOrder()
    {
        Hierarchy h = Resolve(
            new Item("torso", null),
            new Item("arm-l", "torso"),
            new Item("arm-r", "torso"),
            new Item("head", "torso"));

        Assert.That(h.Order, Is.EqualTo(new[] { "torso", "arm-l", "arm-r", "head" }));
    }

    [Test]
    public void ASelfParentBecomesARoot()
    {
        Hierarchy h = Resolve(new Item("head", "head"));

        Assert.That(h.ParentOf["head"], Is.Null);
        Assert.That(h.Dropped["head"], Is.EqualTo(DroppedEdge.Self));
    }

    [Test]
    public void AnUnknownParentBecomesARoot()
    {
        Hierarchy h = Resolve(new Item("head", "ghost"));

        Assert.That(h.ParentOf["head"], Is.Null);
        Assert.That(h.Dropped["head"], Is.EqualTo(DroppedEdge.Unknown));
        Assert.That(h.Order, Is.EqualTo(new[] { "head" }));
    }

    [Test]
    public void MakesEveryMemberOfACycleARootSymmetrically()
    {
        // The walk reads DECLARED parents, never the effective ones decided so
        // far, which is what makes the answer independent of input order.
        var forward = Resolve(new Item("a", "b"), new Item("b", "c"), new Item("c", "a"));
        var reversed = Resolve(new Item("c", "a"), new Item("b", "c"), new Item("a", "b"));

        foreach (Hierarchy h in new[] { forward, reversed })
        {
            foreach (string id in new[] { "a", "b", "c" })
            {
                Assert.That(h.ParentOf[id], Is.Null, id);
                Assert.That(h.Dropped[id], Is.EqualTo(DroppedEdge.Cycle), id);
            }
        }

        Assert.That(forward.Order.OrderBy(x => x, System.StringComparer.Ordinal),
            Is.EqualTo(reversed.Order.OrderBy(x => x, System.StringComparer.Ordinal)));
    }

    [Test]
    public void AChainLeadingIntoACycleDetachesToo()
    {
        // `tip`'s own edge closes nothing, but the walk from it never
        // terminates either, so the whole subtree above the bad edge detaches.
        Hierarchy h = Resolve(
            new Item("a", "b"),
            new Item("b", "a"),
            new Item("tip", "a"));

        Assert.That(h.ParentOf["tip"], Is.Null);
        Assert.That(h.Dropped["tip"], Is.EqualTo(DroppedEdge.Cycle));
    }

    [Test]
    public void FirstIdWins()
    {
        Hierarchy h = Resolve(
            new Item("torso", null),
            new Item("head", "torso"),
            new Item("head", null));

        Assert.That(h.ParentOf["head"], Is.EqualTo("torso"));
        Assert.That(h.Order, Is.EqualTo(new[] { "torso", "head" }));
    }

    [Test]
    public void EveryIdHasAnEntryEvenWhenItIsARoot()
    {
        Hierarchy h = Resolve(new Item("a", null), new Item("b", "a"));

        Assert.That(h.ParentOf.Count, Is.EqualTo(2));
        Assert.That(h.ParentOf.ContainsKey("a"), Is.True);
        Assert.That(h.ParentOf["a"], Is.Null);
    }

    [Test]
    public void AnEmptyInputIsAnEmptyHierarchy()
    {
        Hierarchy h = Forest.ResolveHierarchy(new List<Item>(), i => i.Id, i => i.Parent);

        Assert.That(h.Order, Is.Empty);
        Assert.That(h.ParentOf, Is.Empty);
        Assert.That(h.Dropped, Is.Empty);
    }

    [Test]
    [NonParallelizable]
    public void IdentityIsOrdinalNotCultural()
    {
        // Hazard S4/S6: `Dictionary<string, T>` with the default comparer is
        // already ordinal, but the lookups here are spelled with
        // StringComparer.Ordinal so that a later change cannot make two §5
        // identifiers that differ only in case collapse into one part.
        using (new CultureScope(CultureScope.DotlessI))
        {
            Hierarchy h = Resolve(new Item("Arm", null), new Item("arm", "Arm"));

            Assert.That(h.Order, Is.EqualTo(new[] { "Arm", "arm" }));
            Assert.That(h.ParentOf["arm"], Is.EqualTo("Arm"));
            Assert.That(h.Dropped, Is.Empty);
        }
    }
}
