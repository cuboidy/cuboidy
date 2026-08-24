// Port of ts/packages/core/src/geometry/voxel-row.ts.
//
// `maxPaletteIndex` is NOT ported. Its two callers are the assembler's
// palette-overflow check and lint's E04, both of which live in `cli/` and
// `lint/` and neither of which is ported.

using System;

namespace Cuboidy;

// SPEC §7.10: the voxel-row alphabet. A row is a string of cells; `.` is air
// and every other character is a palette index — 0-9 → 0-9, a-z → 10-35,
// A-Z → 36-61, then `$` → 62 and `%` → 63, which is where the palette caps
// (§7.4).
//
// The last two are not alphanumeric because there is no alphanumeric left. They
// were added because 62 was not a decision — it is what three runs of digits and
// letters happen to total — and it left a 64-colour palette two short of fitting
// in one file, which is a common size to be two short of. Both are dense enough
// in an ASCII grid not to be mistaken for `.`, which rules out `,` `'` and `:`,
// and neither carries a meaning elsewhere in the format, which rules out `#`.
//
// Row width and index range are validated by the reader, which has `size` and
// the palette length in hand; this is the character mapping and the
// index-space helpers, nothing more.
public static class VoxelRow
{
    public const int Air = -1;

    // Null for a character outside the alphabet.
    public static int? CharToIndex(char c)
    {
        if (c == '.') return Air;
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'z') return c - 'a' + 10;
        if (c >= 'A' && c <= 'Z') return c - 'A' + 36;
        if (c == '$') return 62;
        if (c == '%') return 63;
        return null;
    }

    // Inverse of CharToIndex. Raises on out-of-range input — the palette holds
    // at most 64 colours, so a well-formed AST never overflows this mapping.
    public static char IndexToChar(int index)
    {
        if (index == Air) return '.';
        if (index >= 0 && index <= 9) return (char)('0' + index);
        if (index >= 10 && index <= 35) return (char)('a' + index - 10);
        if (index >= 36 && index <= 61) return (char)('A' + index - 36);
        if (index == 62) return '$';
        if (index == 63) return '%';
        throw new ArgumentOutOfRangeException(
            nameof(index), index, "expected AIR or 0..63");
    }
}
