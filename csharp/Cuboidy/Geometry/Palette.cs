// Port of ts/packages/core/src/geometry/palette.ts — the reading half.
//
// `serializeColor`, `isMatte` and `serializePaletteEntry` are NOT ported. They
// are the canonical WRITER's half of the codec, and this library reads;
// `geometry/serialize.ts`, their only consumer inside core, is not ported
// either.

using System;
using System.Text.RegularExpressions;

namespace Cuboidy;

// SPEC §7.4: the colour codec, shared by a geometry file's own palette and the
// external palette file (§6.10) — both use the same grammar and the same
// 64-slot index space.
public static class PaletteCodec
{
    public const int MaxPalette = 64;

    // The material an entry has when it says nothing: a plain matte
    // dielectric. These exact numbers are what every model rendered as before
    // §7.4 gained materials, and they are three.js MeshStandardMaterial's own
    // defaults, so "said nothing" and "said the defaults" are the same pixels.
    //
    // Note `Roughness` is 1 while `default(double)` is 0 — hazard T2. Nothing
    // may reach a `Material` except through `PaletteEntryFrom`.
    public static readonly Material Matte = new Material(0, 1, 0);

    // `\z`, not `$` — hazard S1. Measured against the reference: a palette
    // entry of `"#FF0000\n"` is rejected there, and `$` accepts it here.
    private static readonly Regex HexRegex =
        new Regex(@"^#([0-9a-fA-F]+)\z", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    // Null for anything that is not #RGB / #RGBA / #RRGGBB / #RRGGBBAA.
    public static Color? ParseHexColor(string s)
    {
        if (s is null) return null;
        Match m = HexRegex.Match(s);
        if (!m.Success) return null;
        string hex = m.Groups[1].Value;
        switch (hex.Length)
        {
            case 3:
                return new Color(Dup(hex, 0), Dup(hex, 1), Dup(hex, 2), 0xff);
            case 4:
                return new Color(Dup(hex, 0), Dup(hex, 1), Dup(hex, 2), Dup(hex, 3));
            case 6:
                return new Color(Pair(hex, 0), Pair(hex, 2), Pair(hex, 4), 0xff);
            case 8:
                return new Color(Pair(hex, 0), Pair(hex, 2), Pair(hex, 4), Pair(hex, 6));
            default:
                return null;
        }
    }

    // A validated entry from a file → the runtime shape. The single place the
    // §7.4 material defaults are applied, so no caller has to know them.
    //
    // Returns null only for a malformed colour. Range and key checks belong to
    // the reader, which has already run and can report a path.
    public static PaletteEntry? PaletteEntryFrom(PaletteEntryDoc doc)
    {
        if (doc is null) return null;
        Color? color = ParseHexColor(doc.Color);
        if (color is null) return null;
        return new PaletteEntry(
            color.Value,
            new Material(
                doc.Metallic ?? Matte.Metallic,
                doc.Roughness ?? Matte.Roughness,
                doc.Emissive ?? Matte.Emissive));
    }

    private static byte Dup(string hex, int i)
    {
        int v = Nibble(hex[i]);
        return (byte)(v * 16 + v);
    }

    private static byte Pair(string hex, int i) =>
        (byte)(Nibble(hex[i]) * 16 + Nibble(hex[i + 1]));

    // Hand-decoded rather than `Convert.ToByte(s, 16)`, which is
    // culture-independent but also accepts a leading sign and whitespace the
    // regex above has already ruled out — and rather than `char.ToLower`,
    // which folds under tr-TR (hazard S4). The regex guarantees a hex digit,
    // so no branch here is reachable with anything else.
    private static int Nibble(char c)
    {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        throw new ArgumentOutOfRangeException(nameof(c), c, "not a hex digit");
    }
}

// A palette entry as it appears in a FILE, before defaults are applied.
//
// SPEC §7.4 gives it two forms: a bare colour string, or an object carrying
// that colour plus how it responds to light. TypeScript needs a union to say
// so, and hazard T1 warns that `A | B` has no source-generated form in C#.
// Neither applies here, because the two forms carry the same information: a
// bare `"#FF0000"` is exactly this record with all three material fields
// absent, and `PaletteEntryFrom` maps both through one path. The reader
// records which form it read and nothing downstream asks.
//
// The three material fields are NULLABLE and defaulted in one place —
// hazard T2. A non-nullable `double Roughness` would read
// `{ "color": "#C0C4CC", "emissive": 0.4 }` as a mirror instead of a diffuse
// surface, and move the entry in §7.4's normative material order.
// `models/submersible/palette.json` has entries shaped exactly like that.
public sealed record PaletteEntryDoc(
    string Color,
    double? Metallic,
    double? Roughness,
    double? Emissive)
{
    public PaletteEntryDoc(string color) : this(color, null, null, null)
    {
    }
}
