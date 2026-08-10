using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;

namespace Cuboidy;

// A structural failure, raised where it is found and caught once at the reader
// boundary, where it becomes the `Result` the public API returns.
//
// TypeScript does not thread its failures either — Zod collects issues and the
// reader turns the first one into a `Result` in one place. Threading
// `Result<T>` through every field of every nested object would put a
// three-line propagation between each pair of lines that reads something, and
// the shape of the reader is the part worth keeping comparable to the
// reference. `Result<T>` stays the public contract; this type never escapes
// the assembly.
internal sealed class ReaderException : Exception
{
    public ReaderException(CuboidyErrorCode code, string message, DocPath at)
        : base(message)
    {
        Code = code;
        Path = at.Segments;
    }

    public CuboidyErrorCode Code { get; }

    public IReadOnlyList<PathSegment> Path { get; }

    public Result<T> ToResult<T>() => Result.Err<T>(Code, Message, Path);
}

// The fields of one JSON object, with the §11.2 `unknown` check already run.
internal readonly struct ObjectFields
{
    private readonly Dictionary<string, JsonElement> _fields;

    internal ObjectFields(Dictionary<string, JsonElement> fields, DocPath at)
    {
        _fields = fields;
        At = at;
    }

    public DocPath At { get; }

    // False only when the key is ABSENT. An explicit JSON `null` is a present
    // value of the wrong type, which is `invalid-value` rather than `missing` —
    // the reference draws the same line (its absence test is `=== undefined`,
    // and `null` is not).
    public bool TryGet(string key, out JsonElement value) => _fields.TryGetValue(key, out value);

    public JsonElement Required(string key)
    {
        if (_fields.TryGetValue(key, out JsonElement value)) return value;
        DocPath at = At.Add(key);
        throw new ReaderException(
            CuboidyErrorCode.Missing,
            $"{at.Label}: required field is missing",
            at);
    }
}

internal static class JsonRead
{
    // Reads an object and rejects any key outside the closed set (§11.2
    // `unknown`, reported at the OBJECT's path, which is where the reference
    // reports `.strict()` failures).
    //
    // DUPLICATE KEYS ARE LAST-WINS, matching `JSON.parse` and therefore the
    // reference — measured, not assumed: a document with `"parts": []` followed
    // by a populated `"parts"` loads (hazard C3). `System.Text.Json` keeps the
    // duplicates and enumerates them in document order, so the last assignment
    // is the one that stands.
    public static ObjectFields Fields(JsonElement e, DocPath at, params string[] allowed)
    {
        Expect(e, JsonValueKind.Object, at, "object");
        var fields = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (JsonProperty property in e.EnumerateObject())
        {
            if (Array.IndexOf(allowed, property.Name) < 0)
            {
                throw new ReaderException(
                    CuboidyErrorCode.Unknown,
                    $"{at.Label}: unrecognized key \"{property.Name}\"",
                    at);
            }

            fields[property.Name] = property.Value;
        }

        return new ObjectFields(fields, at);
    }

    // `ArrayValue`, not `Array`: a static method called `Array` would shadow
    // `System.Array` for every other member of this class.
    public static JsonElement ArrayValue(JsonElement e, DocPath at)
    {
        Expect(e, JsonValueKind.Array, at, "array");
        return e;
    }

    public static string String(JsonElement e, DocPath at)
    {
        Expect(e, JsonValueKind.String, at, "string");
        return e.GetString()!;
    }

    public static bool Bool(JsonElement e, DocPath at)
    {
        if (e.ValueKind == JsonValueKind.True) return true;
        if (e.ValueKind == JsonValueKind.False) return false;
        throw InvalidType(e, at, "boolean");
    }

    // Any §10 number. Non-finite is `invalid-value`, which is what the
    // reference reports for a coordinate of `1e400` — hazard N6, where the
    // naive C# is `GetDouble()` and throws instead of diagnosing. .NET parses
    // an overflowing literal to infinity rather than failing, so the guard is
    // the finite test, not the TryGet.
    public static double Number(JsonElement e, DocPath at)
    {
        Expect(e, JsonValueKind.Number, at, "number");
        if (!e.TryGetDouble(out double value) || double.IsNaN(value) || double.IsInfinity(value))
        {
            throw new ReaderException(
                CuboidyErrorCode.InvalidValue,
                $"{at.Label}: number is not finite",
                at);
        }

        return value;
    }

    // SPEC §10: integer and decimal literals are interchangeable in any
    // numeric field, so `3.0` is an integer here — hazard N5, where the naive
    // C# is `GetInt32()` and throws on a value the reference accepts.
    public static int Integer(JsonElement e, DocPath at)
    {
        double value = Number(e, at);
        if (value % 1 != 0 || value < int.MinValue || value > int.MaxValue)
        {
            throw new ReaderException(
                CuboidyErrorCode.InvalidValue,
                $"{at.Label}: expected an integer, got {value.ToString("R", CultureInfo.InvariantCulture)}",
                at);
        }

        return (int)value;
    }

    // A fixed-length array. The WRONG LENGTH is `wrong-arity` and a bad
    // ELEMENT is `invalid-value` — §11.2 splits them, and the reference
    // decides by whether the bound was reported against the container or
    // against one of its items.
    public static JsonElement[] Tuple(JsonElement e, DocPath at, int arity)
    {
        ArrayValue(e, at);
        int length = e.GetArrayLength();
        if (length != arity)
        {
            throw new ReaderException(
                CuboidyErrorCode.WrongArity,
                $"{at.Label}: expected {arity} items, got {length}",
                at);
        }

        var items = new JsonElement[arity];
        int i = 0;
        foreach (JsonElement item in e.EnumerateArray()) items[i++] = item;
        return items;
    }

    // SPEC §4: a coordinate triple. `Vec3Value`, not `Vec3`, for the same
    // shadowing reason as `ArrayValue`.
    public static Vec3 Vec3Value(JsonElement e, DocPath at)
    {
        JsonElement[] items = Tuple(e, at, 3);
        return new Vec3(
            Number(items[0], at.Add(0)),
            Number(items[1], at.Add(1)),
            Number(items[2], at.Add(2)));
    }

    // A number constrained to 0..1. §7.4's three material fields are the only
    // ones, and a bound on a NUMBER is never an arity — nothing was counted.
    public static double Unit(JsonElement e, DocPath at)
    {
        double value = Number(e, at);
        if (value < 0 || value > 1)
        {
            throw new ReaderException(
                CuboidyErrorCode.InvalidValue,
                $"{at.Label}: expected a number in 0..1, got {value.ToString("R", CultureInfo.InvariantCulture)}",
                at);
        }

        return value;
    }

    // SPEC §5, for a value in an identifier slot.
    public static string IdentifierValue(JsonElement e, DocPath at)
    {
        string value = String(e, at);
        if (!Identifier.IsIdentifier(value))
        {
            throw new ReaderException(
                CuboidyErrorCode.InvalidValue,
                $"{at.Label}: must match the identifier regex " +
                "(letters/digits/_/-, no leading digit or hyphen) and not be a reserved keyword",
                at);
        }

        return value;
    }

    // SPEC §8, for a value in a reference slot.
    public static string RefPathValue(JsonElement e, DocPath at, string ext)
    {
        string value = String(e, at);
        string? problem = RefPath.Validate(value, ext);
        if (problem is not null)
        {
            throw new ReaderException(CuboidyErrorCode.InvalidValue, $"{at.Label}: {problem}", at);
        }

        return value;
    }

    public static ReaderException Fail(CuboidyErrorCode code, string message, DocPath at) =>
        new ReaderException(code, $"{at.Label}: {message}", at);

    private static void Expect(JsonElement e, JsonValueKind kind, DocPath at, string wanted)
    {
        if (e.ValueKind != kind) throw InvalidType(e, at, wanted);
    }

    private static ReaderException InvalidType(JsonElement e, DocPath at, string wanted) =>
        new ReaderException(
            CuboidyErrorCode.InvalidValue,
            $"{at.Label}: expected {wanted}, got {Describe(e)}",
            at);

    private static string Describe(JsonElement e)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.Object: return "object";
            case JsonValueKind.Array: return "array";
            case JsonValueKind.String: return "string";
            case JsonValueKind.Number: return "number";
            case JsonValueKind.True:
            case JsonValueKind.False: return "boolean";
            case JsonValueKind.Null: return "null";
            default: return "nothing";
        }
    }
}
