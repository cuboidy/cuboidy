// Port of ts/packages/core/src/geometry/locate.ts.
//
// Maps a document path — object keys and array indices from the root — back to
// a position in the source text.
//
// The retired `.cvox` reader reported `line N:` on every error because its
// tokenizer carried line numbers. A JSON reader gets its errors from the
// schema instead, which knows the path (`parts.2.size`) but nothing about
// bytes. This closes that gap so an error can still say WHERE.
//
// This scans a `string`, deliberately, which is where hazard S3 goes: the
// reference counts UTF-16 code units, and a `Utf8JsonReader`-based port would
// have BYTE offsets, so any non-ASCII earlier in the file would shift the
// reported line and column. A .NET `string` is UTF-16 too, so a scanner over
// one agrees with the reference character for character. §5 keeps identifiers
// ASCII, but a colour name or a path need not be.
//
// The scanner is deliberately minimal: it only needs to find the offset a
// value begins at, so it skips over values rather than building them. It
// assumes the text already parsed as JSON — every caller has run a parse
// first — which is why malformed input has no error path here; it simply stops
// and reports the deepest position it did reach.

using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Cuboidy;

// Both 1-based, matching how editors and the old geometry errors count.
public readonly record struct Position(int Line, int Column);

public static class Locate
{
    // Resolves `path` to a position. When a segment does not exist — the usual
    // case for a missing required field — the deepest ancestor that DOES exist
    // is used, so `parts.2.size` on a part with no `size` points at that part.
    public static Position? LocateJsonPath(string text, IReadOnlyList<PathSegment> path)
    {
        int? offset = OffsetAtPath(text, path);
        return offset is null ? null : PositionAt(text, offset.Value);
    }

    public static Position PositionAt(string text, int offset)
    {
        int clamped = Math.Max(0, Math.Min(offset, text.Length));
        int line = 1;
        int lineStart = 0;
        for (int i = 0; i < clamped; i++)
        {
            if (text[i] == '\n')
            {
                line++;
                lineStart = i + 1;
            }
        }

        return new Position(line, clamped - lineStart + 1);
    }

    private static int? OffsetAtPath(string text, IReadOnlyList<PathSegment> path)
    {
        int at = SkipWs(text, 0);
        if (at >= text.Length) return null;
        foreach (PathSegment segment in path)
        {
            int? child = ChildOffset(text, at, segment);
            // Absent segment: the deepest resolved ancestor is the best answer.
            if (child is null) return at;
            at = child.Value;
        }

        return at;
    }

    // Offset of `segment` within the container starting at `start`, or null if
    // the container is the wrong kind or the segment is not there.
    private static int? ChildOffset(string text, int start, PathSegment segment)
    {
        char open = start < text.Length ? text[start] : '\0';
        if (segment.IsIndex)
        {
            if (open != '[') return null;
            int i = SkipWs(text, start + 1);
            for (int index = 0; i < text.Length && text[i] != ']'; index++)
            {
                if (index == segment.AsIndex) return i;
                i = SkipWs(text, SkipValue(text, i));
                if (i < text.Length && text[i] == ',') i = SkipWs(text, i + 1);
            }

            return null;
        }

        if (open != '{') return null;
        int j = SkipWs(text, start + 1);
        while (j < text.Length && text[j] != '}')
        {
            if (text[j] != '"') return null;
            int keyEnd = SkipString(text, j);
            string key = ReadString(text, j, keyEnd);
            j = SkipWs(text, keyEnd);
            if (j >= text.Length || text[j] != ':') return null;
            j = SkipWs(text, j + 1);
            if (string.Equals(key, segment.AsKey, StringComparison.Ordinal)) return j;
            j = SkipWs(text, SkipValue(text, j));
            if (j < text.Length && text[j] == ',') j = SkipWs(text, j + 1);
        }

        return null;
    }

    // ----- scanning primitives ------------------------------------------

    private static int SkipWs(string text, int i)
    {
        int at = i;
        while (at < text.Length)
        {
            char c = text[at];
            // space, tab, LF, CR — the only whitespace JSON allows.
            if (c != ' ' && c != '\t' && c != '\n' && c != '\r') break;
            at++;
        }

        return at;
    }

    // Index just past the value starting at `i`.
    private static int SkipValue(string text, int i)
    {
        if (i >= text.Length) return i;
        char c = text[i];
        if (c == '"') return SkipString(text, i);
        if (c == '{' || c == '[') return SkipContainer(text, i);
        // Literal or number: runs until a structural character or whitespace.
        int at = i;
        while (at < text.Length && !IsValueTerminator(text[at])) at++;
        return at;
    }

    private static bool IsValueTerminator(char c) =>
        c == ',' || c == ']' || c == '}' || c == ':' ||
        c == ' ' || c == '\t' || c == '\n' || c == '\r';

    private static int SkipContainer(string text, int i)
    {
        char close = text[i] == '{' ? '}' : ']';
        int at = SkipWs(text, i + 1);
        while (at < text.Length && text[at] != close)
        {
            // Object keys are strings and `:` is skipped as a lone structural
            // character, so one loop handles both container kinds.
            if (text[at] == ':' || text[at] == ',')
            {
                at = SkipWs(text, at + 1);
                continue;
            }

            at = SkipWs(text, SkipValue(text, at));
        }

        return at < text.Length ? at + 1 : at;
    }

    // Index just past the closing quote of the string starting at `i`.
    private static int SkipString(string text, int i)
    {
        int at = i + 1;
        while (at < text.Length)
        {
            char c = text[at];
            if (c == '\\')
            {
                at += 2;
                continue;
            }

            if (c == '"') return at + 1;
            at++;
        }

        return at;
    }

    // The decoded value of the string token spanning [start, end).
    private static string ReadString(string text, int start, int end)
    {
        string raw = text.Substring(start, Math.Min(end, text.Length) - start);
        try
        {
            using JsonDocument doc = JsonDocument.Parse(raw);
            return doc.RootElement.GetString() ?? raw;
        }
        catch (JsonException)
        {
            // Unreachable for text that already parsed; degrade to the raw
            // slice rather than throwing out of a diagnostic helper.
            return raw.Length >= 2 ? raw.Substring(1, raw.Length - 2) : raw;
        }
    }
}
