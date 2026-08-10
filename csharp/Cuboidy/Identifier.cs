// Port of ts/packages/core/src/identifier.ts.
//
// `identifier-schema.ts` collapses into this file. It exists in TypeScript to
// wrap the rule below as a Zod schema in a leaf module, so `manifest.ts` and
// `animation.ts` can share it without an import cycle; a hand-written
// validator calls `IsIdentifier` directly and needs neither the wrapper nor
// the module.

using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Cuboidy;

// SPEC §5: the canonical identifier rule, shared by every name in the format —
// model, part, socket and animation — across both `cuboidy.json` and the
// geometry file. Two conditions: (1) the regex shape, first char a letter or
// underscore, rest letters/digits/underscores/hyphens; (2) not one of the
// reserved keywords below.
public static class Identifier
{
    // The reserved list is inherited from the text container that preceded
    // JSON: there, a bare `part part` was lexically ambiguous, so rejecting the
    // keyword as an identifier was load-bearing. JSON has no such ambiguity.
    // SPEC §5 keeps the rule anyway — it costs nothing, no model uses these
    // names, and lifting it would be a separate breaking change to a rule both
    // files currently share.
    public static readonly IReadOnlyList<string> ReservedKeywords = new[]
    {
        "palette",
        "part",
        "size",
        "pivot",
        "socket",
        "voxels",
        "rot",
    };

    private static readonly HashSet<string> ReservedKeywordSet =
        new HashSet<string>(ReservedKeywords, StringComparer.Ordinal);

    // `\z`, not `$`. .NET's `$` also matches immediately before a trailing
    // newline, so `"name": "head\n"` would be accepted here and rejected by
    // the reference — hazard S1. The character classes are ASCII literals, so
    // they do not vary by culture, but `CultureInvariant` says so out loud.
    public const string IdentifierPattern = @"^[a-zA-Z_][a-zA-Z0-9_-]*\z";

    private static readonly Regex IdentifierRegex =
        new Regex(IdentifierPattern, RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static bool IsReservedKeyword(string s) => ReservedKeywordSet.Contains(s);

    public static bool IsIdentifier(string s)
    {
        if (s is null) return false;
        if (ReservedKeywordSet.Contains(s)) return false;
        return IdentifierRegex.IsMatch(s);
    }
}
