// Port of ts/packages/core/src/forest.ts.
//
// `buildForest` and `ForestNode` are NOT ported. They turn the hierarchy into
// a tree of nodes for a display layer — the editor's rig view and the
// workspace's scene tree. A consumer of this library that wants a tree builds
// it from `Hierarchy.ParentOf` and `Hierarchy.Order`, which is what `Order`
// exists for: every item follows its effective parent, so one pass places
// each node under a parent that already exists.

using System;
using System.Collections.Generic;

namespace Cuboidy;

// Why an item's declared parent was not used.
public enum DroppedEdge
{
    Self,
    Unknown,
    Cycle,
}

public sealed class Hierarchy
{
    internal Hierarchy(
        IReadOnlyDictionary<string, string?> parentOf,
        IReadOnlyDictionary<string, DroppedEdge> dropped,
        IReadOnlyList<string> order)
    {
        ParentOf = parentOf;
        Dropped = dropped;
        Order = order;
    }

    // Effective parent per id: null when the item is a root. Every chain of
    // these terminates.
    //
    // TypeScript's map holds `string | undefined` and its comment allows an id
    // to be absent OR present-with-undefined; this one always has an entry per
    // id, with a null value for a root, which is the same answer for every
    // caller (both spell "no parent").
    public IReadOnlyDictionary<string, string?> ParentOf { get; }

    // Ids whose declared parent was dropped, and why. Renderers ignore this;
    // a reporting layer can say which edge it lost.
    public IReadOnlyDictionary<string, DroppedEdge> Dropped { get; }

    // Ids in an order where every item follows its effective parent, stable
    // with respect to input order. A caller composing transforms down the
    // chain can walk this once instead of recursing.
    public IReadOnlyList<string> Order { get; }
}

// Cycle-safe hierarchy resolution: items that name a parent by id become a
// tree, and an edge that would close a cycle is dropped so its item stays a
// root. The rig view (parts naming parents), the world-transform chain and
// the workspace's scene tree (instances naming hosts) all need it, because
// malformed input — a hand-edited file, a not-yet-rejected manifest — must
// not hang a renderer or make both members of a cycle silently vanish.
//
// This is the LENIENT policy, and it is one policy in one place. The strict
// counterpart is the manifest reader's §11.5 refusal; validation and display
// want different answers and always will. What they must not have is
// different answers to "who is this part's parent".
public static class Forest
{
    public static Hierarchy ResolveHierarchy<T>(
        IReadOnlyList<T> items,
        Func<T, string> idOf,
        Func<T, string?> parentOf)
    {
        if (items is null) throw new ArgumentNullException(nameof(items));
        if (idOf is null) throw new ArgumentNullException(nameof(idOf));
        if (parentOf is null) throw new ArgumentNullException(nameof(parentOf));

        // First id wins, matching every other by-name lookup in the codebase.
        var declared = new Dictionary<string, string?>(StringComparer.Ordinal);
        var ids = new List<string>();
        foreach (T item in items)
        {
            string id = idOf(item);
            if (declared.ContainsKey(id)) continue;
            declared[id] = parentOf(item);
            ids.Add(id);
        }

        var effective = new Dictionary<string, string?>(StringComparer.Ordinal);
        var dropped = new Dictionary<string, DroppedEdge>(StringComparer.Ordinal);
        foreach (string id in ids)
        {
            string? parent = declared[id];
            if (parent is null)
            {
                effective[id] = null;
                continue;
            }

            if (string.Equals(parent, id, StringComparison.Ordinal))
            {
                effective[id] = null;
                dropped[id] = DroppedEdge.Self;
                continue;
            }

            if (!declared.ContainsKey(parent))
            {
                effective[id] = null;
                dropped[id] = DroppedEdge.Unknown;
                continue;
            }

            // Walking up from the proposed parent must terminate; revisiting a
            // name already on the walk means this edge cannot be followed, so
            // drop it and let the item be a root.
            //
            // The walk reads DECLARED parents, never the effective ones decided
            // so far, which is what makes the answer independent of input
            // order: every member of a cycle reaches the same verdict about its
            // own edge, so all of them become roots and reversing the list
            // changes nothing.
            //
            // A chain LEADING INTO a cycle is dropped too, and reported as
            // `Cycle` though its own edge closes nothing — the walk from it
            // never terminates either. The whole subtree above a bad edge
            // detaches.
            var seen = new HashSet<string>(StringComparer.Ordinal) { id };
            string? cur = parent;
            bool closes = false;
            while (cur is not null)
            {
                if (seen.Contains(cur))
                {
                    closes = true;
                    break;
                }

                seen.Add(cur);
                declared.TryGetValue(cur, out cur);
            }

            if (closes)
            {
                effective[id] = null;
                dropped[id] = DroppedEdge.Cycle;
            }
            else
            {
                effective[id] = parent;
            }
        }

        var order = new List<string>();
        var placed = new HashSet<string>(StringComparer.Ordinal);

        void Place(string id)
        {
            if (placed.Contains(id)) return;
            string? parent = effective[id];
            if (parent is not null) Place(parent);
            placed.Add(id);
            order.Add(id);
        }

        foreach (string id in ids) Place(id);

        return new Hierarchy(effective, dropped, order);
    }
}
