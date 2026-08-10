using System;
using System.Collections;
using System.Collections.Generic;

namespace Cuboidy;

// A string-keyed map that remembers the order its keys were read in.
//
// Hazard C1: JavaScript's `Map` and `Set` preserve insertion order and
// `Dictionary` / `HashSet` guarantee none, so anywhere the reference's
// iteration order is observable, a `Dictionary` is the wrong translation. The
// three §6 maps that reach this library — the manifest's `sockets` (§6.12),
// its `animations` (§6.3), and an animation's `parts` (§6.4) — are all read in
// document order and all iterated by something that emits per entry.
//
// .NET 9 ships `System.Collections.Generic.OrderedDictionary<,>` and
// netstandard2.1 does not, which is the whole reason this exists. Read-only:
// it is built by a reader and never mutated afterwards.
// Both interfaces on purpose: an ordered walk is what the §6 maps are read
// for, and a keyed lookup is what the runtime does with the result. They agree
// on `Count` and on the element type, so neither costs the other anything.
public sealed class OrderedMap<TValue>
    : IReadOnlyList<KeyValuePair<string, TValue>>, IReadOnlyDictionary<string, TValue>
{
    private static readonly KeyValuePair<string, TValue>[] NoEntries =
        new KeyValuePair<string, TValue>[0];

    private readonly KeyValuePair<string, TValue>[] _entries;
    private readonly Dictionary<string, TValue> _byKey;

    private OrderedMap(KeyValuePair<string, TValue>[] entries, Dictionary<string, TValue> byKey)
    {
        _entries = entries;
        _byKey = byKey;
    }

    public static OrderedMap<TValue> Empty { get; } =
        new OrderedMap<TValue>(NoEntries, new Dictionary<string, TValue>(StringComparer.Ordinal));

    // Duplicate keys are LAST-WINS in the value and FIRST-WINS in the position,
    // which is what `JSON.parse` followed by an object literal gives: the
    // second assignment replaces the value and does not move the key.
    public static OrderedMap<TValue> From(IEnumerable<KeyValuePair<string, TValue>> entries)
    {
        if (entries is null) throw new ArgumentNullException(nameof(entries));

        var order = new List<string>();
        var byKey = new Dictionary<string, TValue>(StringComparer.Ordinal);
        foreach (KeyValuePair<string, TValue> entry in entries)
        {
            if (!byKey.ContainsKey(entry.Key)) order.Add(entry.Key);
            byKey[entry.Key] = entry.Value;
        }

        if (order.Count == 0) return Empty;

        var ordered = new KeyValuePair<string, TValue>[order.Count];
        for (int i = 0; i < order.Count; i++)
        {
            ordered[i] = new KeyValuePair<string, TValue>(order[i], byKey[order[i]]);
        }

        return new OrderedMap<TValue>(ordered, byKey);
    }

    public int Count => _entries.Length;

    public KeyValuePair<string, TValue> this[int index] => _entries[index];

    public TValue this[string key] => _byKey[key];

    public bool ContainsKey(string key) => _byKey.ContainsKey(key);

    public bool TryGetValue(string key, out TValue value) => _byKey.TryGetValue(key, out value!);

    public IEnumerable<string> Keys
    {
        get
        {
            foreach (KeyValuePair<string, TValue> entry in _entries) yield return entry.Key;
        }
    }

    public IEnumerable<TValue> Values
    {
        get
        {
            foreach (KeyValuePair<string, TValue> entry in _entries) yield return entry.Value;
        }
    }

    public IEnumerator<KeyValuePair<string, TValue>> GetEnumerator()
    {
        foreach (KeyValuePair<string, TValue> entry in _entries) yield return entry;
    }

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}
