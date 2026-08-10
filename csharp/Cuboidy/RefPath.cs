// Port of ts/packages/core/src/ref-path.ts.
//
// `refPathPattern` is NOT ported. Its only consumer is `.meta({ pattern })`,
// which carries the rule into the generated JSON Schema for editors and
// third-party validators — and `json-schema.ts` is not ported (it builds a
// generated artifact; this reader validates structurally as it reads). Hazard
// S1 names that regex as one of six `$` sites; it is listed there so that a
// port which does carry it uses `\z`, not as an instruction to carry it.

using System;

namespace Cuboidy;

// SPEC §8 reference path, parameterized by the required extension — `.json`
// for every reference kind now that geometry is JSON too, but kept a parameter
// because the rule is about the path shape, not the suffix.
//
// Syntax-only: whether the target exists — and whether a `../` path is
// loadable at all — is the consuming tool's concern.
public static class RefPath
{
    // Null when the path is valid, otherwise the message for the first rule it
    // breaks. Separate checks (not one regex) so each violation gets a
    // specific message.
    //
    // TypeScript runs all five Zod refinements and collects every issue; this
    // stops at the first. Not observable in the cross-implementation contract:
    // all five map to the same §11.2 code, and `fixtures/` compares codes.
    public static string? Validate(string s, string ext)
    {
        if (s is null) throw new ArgumentNullException(nameof(s));
        if (ext is null) throw new ArgumentNullException(nameof(ext));

        // Ordinal everywhere. `EndsWith(string)` and `Contains(string)` on the
        // culture-sensitive overloads would fold characters this rule is
        // supposed to reject — hazard S4.
        if (!s.EndsWith(ext, StringComparison.Ordinal) || s.Length <= ext.Length)
        {
            return $"must be a relative path ending in {ext}";
        }

        if (s.IndexOf('\\') >= 0)
        {
            return "must use forward slashes";
        }

        if (s.StartsWith("/", StringComparison.Ordinal))
        {
            return "absolute paths are forbidden";
        }

        if (s.IndexOf(':') >= 0)
        {
            return "URLs and namespace:key URIs are forbidden";
        }

        foreach (string segment in s.Split('/'))
        {
            if (segment.Length == 0) return "empty path segment";
        }

        return null;
    }

    public static bool IsValid(string s, string ext) => Validate(s, ext) is null;
}
