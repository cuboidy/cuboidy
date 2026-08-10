// Port of ts/packages/core/src/result.ts.

using System;
using System.Collections.Generic;
using System.Globalization;

namespace Cuboidy;

// Structural error taxonomy (SPEC §11). Per-keyword codes are intentionally
// avoided; the keyword/context lives in the message string.
public enum CuboidyErrorCode
{
    // A required structural element is absent (e.g. a part with no `size` or no
    // `voxels`, a manifest with no `name`, an empty `parts`).
    Missing,

    // A unique-constraint violation: something that must be unique in its scope
    // is not (duplicate part name, duplicate socket within a part).
    Duplicate,

    // An unrecognized name appears where the spec defines a closed set of names
    // (e.g. an unrecognised field in `voxels.json` or in the manifest).
    Unknown,

    // A value is present but malformed: bad hex color, voxel-row character
    // outside the palette alphabet, palette index out of range, identifier
    // failing the §5 regex, size dimension out of range, etc.
    InvalidValue,

    // An incorrect number of items: a coordinate triple that is not a triple,
    // voxel-row width not matching `W`, row count per layer not matching `D`,
    // layer count not matching `H`, palette exceeding 62 colors.
    WrongArity,
}

public static class CuboidyErrorCodeExtensions
{
    // The spelling SPEC §11.2 uses, which is also what `fixtures/` names its
    // directories after — the corpus is matched by this string, so it is part
    // of the cross-implementation contract rather than a display detail.
    public static string ToWire(this CuboidyErrorCode code)
    {
        switch (code)
        {
            case CuboidyErrorCode.Missing: return "missing";
            case CuboidyErrorCode.Duplicate: return "duplicate";
            case CuboidyErrorCode.Unknown: return "unknown";
            case CuboidyErrorCode.InvalidValue: return "invalid-value";
            case CuboidyErrorCode.WrongArity: return "wrong-arity";
            default:
                throw new ArgumentOutOfRangeException(nameof(code), code, "unknown error code");
        }
    }

    public static bool TryParseWire(string wire, out CuboidyErrorCode code)
    {
        // Ordinal, never the current culture — hazard S4.
        switch (wire)
        {
            case "missing": code = CuboidyErrorCode.Missing; return true;
            case "duplicate": code = CuboidyErrorCode.Duplicate; return true;
            case "unknown": code = CuboidyErrorCode.Unknown; return true;
            case "invalid-value": code = CuboidyErrorCode.InvalidValue; return true;
            case "wrong-arity": code = CuboidyErrorCode.WrongArity; return true;
            default: code = default; return false;
        }
    }
}

// One step of a document path: an object key or an array index. TypeScript
// spells this `string | number`; C# has no union, and the two cases are told
// apart everywhere the path is consumed (`LocateJsonPath` walks an object for
// one and an array for the other), so collapsing them into a string would
// lose information the locator needs.
public readonly struct PathSegment : IEquatable<PathSegment>
{
    private readonly string? _key;
    private readonly int _index;

    private PathSegment(string? key, int index)
    {
        _key = key;
        _index = index;
    }

    public static PathSegment Key(string key)
    {
        if (key is null) throw new ArgumentNullException(nameof(key));
        return new PathSegment(key, 0);
    }

    public static PathSegment Index(int index)
    {
        return new PathSegment(null, index);
    }

    public bool IsIndex => _key is null;

    public string AsKey =>
        _key ?? throw new InvalidOperationException("path segment is an array index, not an object key");

    public int AsIndex =>
        _key is null ? _index : throw new InvalidOperationException("path segment is an object key, not an array index");

    public static implicit operator PathSegment(string key) => Key(key);

    public static implicit operator PathSegment(int index) => Index(index);

    public bool Equals(PathSegment other)
    {
        if (_key is null) return other._key is null && _index == other._index;
        return string.Equals(_key, other._key, StringComparison.Ordinal);
    }

    public override bool Equals(object? obj) => obj is PathSegment other && Equals(other);

    public override int GetHashCode() =>
        _key is null ? _index : StringComparer.Ordinal.GetHashCode(_key);

    // Invariant culture, always — hazard N2. A path segment ends up in
    // diagnostic messages, which are compared across implementations.
    public override string ToString() =>
        _key ?? _index.ToString(CultureInfo.InvariantCulture);
}

public readonly struct Result<T>
{
    private readonly T _value;
    private readonly string? _message;

    private Result(bool ok, T value, CuboidyErrorCode code, string? message, IReadOnlyList<PathSegment>? path)
    {
        Ok = ok;
        _value = value;
        Code = code;
        _message = message;
        Path = path;
    }

    public bool Ok { get; }

    public CuboidyErrorCode Code { get; }

    public string Message => _message ?? string.Empty;

    // Where in the document the problem is, as object keys and array indices
    // from the root. Present for readers of structured formats (the geometry
    // and manifest schemas); null when the position is meaningless or unknown.
    // Callers holding the source text can turn this into a line/column with
    // `Locate.LocateJsonPath`.
    public IReadOnlyList<PathSegment>? Path { get; }

    public T Value =>
        Ok
            ? _value
            : throw new InvalidOperationException(
                $"Result is an error ({Code.ToWire()}): {_message}");

    public bool TryGetValue(out T value)
    {
        value = _value;
        return Ok;
    }

    // Carry an error across a type change. TypeScript propagates a failed
    // `Result<A>` into a `Result<B>` position by returning it unchanged, which
    // its structural typing allows and C#'s does not.
    public Result<TOther> ToError<TOther>()
    {
        if (Ok) throw new InvalidOperationException("Result is ok; there is no error to carry");
        return Result.Err<TOther>(Code, Message, Path);
    }

    internal static Result<T> Success(T value) =>
        new Result<T>(true, value, default, null, null);

    internal static Result<T> Failure(CuboidyErrorCode code, string message, IReadOnlyList<PathSegment>? path) =>
        new Result<T>(false, default!, code, message, path);
}

public static class Result
{
    public static Result<T> Ok<T>(T value) => Result<T>.Success(value);

    public static Result<T> Err<T>(
        CuboidyErrorCode code,
        string message,
        IReadOnlyList<PathSegment>? path = null) =>
        Result<T>.Failure(code, message, path);
}
