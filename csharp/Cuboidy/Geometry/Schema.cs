// Port of ts/packages/core/src/geometry/schema.ts.
//
// SPEC §7: what a valid geometry file (`voxels.json`) is. The reference states
// it as a Zod schema, which is one artifact serving both the runtime reader
// and the published JSON Schema; this states it as a reader, because
// `json-schema.ts` is not ported and a hand-written validator can say directly
// what Zod has to be asked.
//
// The §11.2 code for each failure is decided HERE rather than inferred from a
// validation library's issue shape. `core/src/zod-diagnostic.ts` exists on the
// TypeScript side precisely because Zod's shapes have to be mapped back onto
// the spec's five codes, and its own comment says a second implementation
// should read §11.2's table instead of porting its branches. That is what this
// file does; there is no C# counterpart to that module.
//
// §11.8's PHASE ORDER is the structure of this file, and it is a MUST: a phase
// runs only if every earlier phase passed.
//
//   phase 2  `Read`             — each field considered on its own
//   phase 3  `CheckCrossFields` — rules needing more than one field at a time
//
// Splitting them is not a style choice. A pre-port audit found inline geometry
// reporting a phase-3 violation ahead of a phase-2 one, against §11.8's
// explicit prohibition, and that is exactly what a reader which validated each
// part completely before moving to the next would do.

using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Cuboidy;

// SPEC §7.4: EITHER a spelled-out list of colors, OR a §8 reference to a
// palette file (§6.10) shared with other geometry. One field with two forms —
// the same shape the manifest's `animations` values already use (§6.3) — so
// there is no precedence rule to define.
//
// Hazard T1 names this as one of three union-shaped fields with no
// source-generated form. It is read by `ReadPaletteField`, which dispatches on
// `JsonValueKind` — the reader walks the document anyway, so the union costs a
// branch rather than a converter.
//
// Public because the manifest carries one too (§6.1 / §6.13) and `Manifest` is
// what a consumer of this library holds.
public sealed record PaletteField(
    IReadOnlyList<PaletteEntryDoc>? Colors,
    string? Ref);

// A part as it appears in a FILE. Phase 3 needs the voxel rows as STRINGS —
// their lengths are what it checks against `size` — so the decode to palette
// indices belongs after it, in `Parse`, not here.
internal sealed record GeometryDocPart(
    string Name,
    Size Size,
    Pivot? Pivot,
    IReadOnlyList<Socket> Sockets,
    IReadOnlyList<IReadOnlyList<string>> Voxels);

internal sealed record GeometryDoc(
    string? Version,
    PaletteField? Palette,
    IReadOnlyList<GeometryDocPart> Parts);

internal static class GeometrySchema
{
    // SPEC §7.6: positive integers per axis, capped for tractability.
    public const int SizeMax = 1024;

    // SPEC §7.10. `\z`, not `$` — hazard S1, and measured: the reference
    // rejects a row of `"0\n"`, which `$` would accept.
    private static readonly Regex VoxelRowRegex =
        new Regex(@"^[.0-9a-zA-Z$%]*\z", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    // ----- phase 2: each field considered on its own ---------------------

    public static GeometryDoc Read(JsonElement root)
    {
        DocPath at = DocPath.Root;
        ObjectFields fields = JsonRead.Fields(root, at, "version", "palette", "parts");

        // Spec version string, same field and semantics as the manifest's.
        string? version = fields.TryGet("version", out JsonElement versionEl)
            ? JsonRead.String(versionEl, at.Add("version"))
            : null;

        // SPEC §7.4. Absent → every voxel is air.
        PaletteField? palette = fields.TryGet("palette", out JsonElement paletteEl)
            ? ReadPaletteField(paletteEl, at.Add("palette"))
            : null;

        DocPath partsAt = at.Add("parts");
        JsonElement partsEl = JsonRead.ArrayValue(fields.Required("parts"), partsAt);
        int count = partsEl.GetArrayLength();
        if (count == 0)
        {
            // §11.2 files this under `missing`, not `wrong-arity`: "no `parts`,
            // or `parts` present but empty" — an empty array reads as "nothing
            // declared", not as a bad count.
            throw JsonRead.Fail(CuboidyErrorCode.Missing, "expected at least one part", partsAt);
        }

        var parts = new List<GeometryDocPart>(count);
        int i = 0;
        foreach (JsonElement partEl in partsEl.EnumerateArray())
        {
            parts.Add(ReadPart(partEl, partsAt.Add(i)));
            i++;
        }

        return new GeometryDoc(version, palette, parts);
    }

    public static GeometryDocPart ReadPart(JsonElement e, DocPath at)
    {
        ObjectFields fields = JsonRead.Fields(e, at, "name", "size", "pivot", "sockets", "voxels");
        return ReadPartBody(fields, at, JsonRead.IdentifierValue(fields.Required("name"), at.Add("name")));
    }

    // Everything about a part except where its name came from. SPEC §6.13
    // writes a part INLINE in the manifest with no `name` of its own — it
    // takes the enclosing manifest part's — so the manifest reader supplies
    // the name and calls this. Exactly one definition of what a part's fields
    // are; a second would be a second opinion about what a valid part is.
    public static GeometryDocPart ReadPartBody(ObjectFields fields, DocPath at, string name)
    {
        Size size = ReadSize(fields.Required("size"), at.Add("size"));

        // Absent → the §7.7 default, filled in during AST construction.
        Pivot? pivot = fields.TryGet("pivot", out JsonElement pivotEl)
            ? ReadPlacement(pivotEl, at.Add("pivot"))
            : (Pivot?)null;

        IReadOnlyList<Socket> sockets = fields.TryGet("sockets", out JsonElement socketsEl)
            ? ReadSockets(socketsEl, at.Add("sockets"))
            : System.Array.Empty<Socket>();

        IReadOnlyList<IReadOnlyList<string>> voxels =
            ReadVoxels(fields.Required("voxels"), at.Add("voxels"));

        return new GeometryDocPart(name, size, pivot, sockets, voxels);
    }

    public static Size ReadSize(JsonElement e, DocPath at)
    {
        JsonElement[] items = JsonRead.Tuple(e, at, 3);
        return new Size(Dim(items[0], at.Add(0)), Dim(items[1], at.Add(1)), Dim(items[2], at.Add(2)));
    }

    // SPEC §7.7 / §7.8: a point in part-local space with an optional ZXY Euler
    // rotation in degrees. Fractional values are allowed; out-of-bounds
    // positions are a lint warning (W01), not a reader error.
    public static Pivot ReadPlacement(JsonElement e, DocPath at)
    {
        ObjectFields fields = JsonRead.Fields(e, at, "pos", "rot");
        Vec3 pos = JsonRead.Vec3Value(fields.Required("pos"), at.Add("pos"));
        Vec3? rot = fields.TryGet("rot", out JsonElement rotEl)
            ? JsonRead.Vec3Value(rotEl, at.Add("rot"))
            : (Vec3?)null;
        return new Pivot(pos, rot);
    }

    public static IReadOnlyList<Socket> ReadSockets(JsonElement e, DocPath at)
    {
        JsonRead.ArrayValue(e, at);
        var sockets = new List<Socket>();
        int i = 0;
        foreach (JsonElement socketEl in e.EnumerateArray())
        {
            sockets.Add(ReadSocket(socketEl, at.Add(i)));
            i++;
        }

        return sockets;
    }

    public static Socket ReadSocket(JsonElement e, DocPath at)
    {
        ObjectFields fields = JsonRead.Fields(e, at, "name", "pos", "rot");
        string name = JsonRead.IdentifierValue(fields.Required("name"), at.Add("name"));
        Vec3 pos = JsonRead.Vec3Value(fields.Required("pos"), at.Add("pos"));
        Vec3? rot = fields.TryGet("rot", out JsonElement rotEl)
            ? JsonRead.Vec3Value(rotEl, at.Add("rot"))
            : (Vec3?)null;
        return new Socket(name, pos, rot);
    }

    // [Y][Z] — H layers of D rows, each row W characters. Arity is phase 3;
    // the alphabet is phase 2, because one row can be judged on its own.
    public static IReadOnlyList<IReadOnlyList<string>> ReadVoxels(JsonElement e, DocPath at)
    {
        JsonRead.ArrayValue(e, at);
        var layers = new List<IReadOnlyList<string>>();
        int y = 0;
        foreach (JsonElement layerEl in e.EnumerateArray())
        {
            DocPath layerAt = at.Add(y);
            JsonRead.ArrayValue(layerEl, layerAt);
            var rows = new List<string>();
            int z = 0;
            foreach (JsonElement rowEl in layerEl.EnumerateArray())
            {
                DocPath rowAt = layerAt.Add(z);
                string row = JsonRead.String(rowEl, rowAt);
                if (!VoxelRowRegex.IsMatch(row))
                {
                    throw JsonRead.Fail(
                        CuboidyErrorCode.InvalidValue, "voxel rows use only [.0-9a-zA-Z$%]", rowAt);
                }

                rows.Add(row);
                z++;
            }

            layers.Add(rows);
            y++;
        }

        return layers;
    }

    public static PaletteField ReadPaletteField(JsonElement e, DocPath at)
    {
        if (e.ValueKind == JsonValueKind.Array)
        {
            int count = e.GetArrayLength();
            if (count < 1 || count > PaletteCodec.MaxPalette)
            {
                // §11.2 `wrong-arity`: "an inline palette with 0 colors or more
                // than 62". Note §11.5 codes the manifest's `geometry` list the
                // other way for the same shape — that one is `invalid-value`.
                throw JsonRead.Fail(
                    CuboidyErrorCode.WrongArity,
                    $"expected 1..{PaletteCodec.MaxPalette} colors, got {count}",
                    at);
            }

            var entries = new List<PaletteEntryDoc>(count);
            int i = 0;
            foreach (JsonElement entryEl in e.EnumerateArray())
            {
                entries.Add(ReadPaletteEntry(entryEl, at.Add(i)));
                i++;
            }

            return new PaletteField(entries, null);
        }

        // Anything that is not an array is the §8 reference form; a value that
        // is neither an array nor a string reports "expected string", which is
        // what the reference reports for `"palette": 7`.
        return new PaletteField(null, JsonRead.RefPathValue(e, at, ".json"));
    }

    // SPEC §7.4: a palette entry is EITHER a bare colour, OR an object
    // carrying that colour plus how it responds to light. The object form is
    // additive — every palette written before materials existed is still the
    // string form.
    public static PaletteEntryDoc ReadPaletteEntry(JsonElement e, DocPath at)
    {
        if (e.ValueKind == JsonValueKind.String)
        {
            return new PaletteEntryDoc(Hex(e, at));
        }

        ObjectFields fields = JsonRead.Fields(e, at, "color", "metallic", "roughness", "emissive");
        return new PaletteEntryDoc(
            Hex(fields.Required("color"), at.Add("color")),
            Unit(fields, at, "metallic"),
            Unit(fields, at, "roughness"),
            Unit(fields, at, "emissive"));
    }

    // ----- phase 3: rules needing more than one field at a time ----------

    public static void CheckCrossFields(GeometryDoc doc)
    {
        // Only an INLINE palette gives the index range at parse time. A
        // reference is resolved by the project layer, so its range check moves
        // to cross-file validation (§11.6) — the same split §7.4 already had
        // for palette-less files.
        int? paletteSize = doc.Palette?.Colors?.Count;
        var names = new HashSet<string>(StringComparer.Ordinal);

        for (int i = 0; i < doc.Parts.Count; i++)
        {
            GeometryDocPart part = doc.Parts[i];
            DocPath at = DocPath.Root.Add("parts", i);

            // SPEC §5: part names are unique across the whole model; within one
            // file we can at least catch the local collision.
            if (!names.Add(part.Name))
            {
                throw JsonRead.Fail(
                    CuboidyErrorCode.Duplicate,
                    $"duplicate part name \"{part.Name}\"",
                    at.Add("name"));
            }

            CheckPartFields(part, at, paletteSize);
        }
    }

    // SPEC §7.9 / §7.4 / §7.8 — the cross-field rules for ONE part: voxel
    // arity against `size`, palette index range, socket-name uniqueness. Split
    // out so a part written INLINE in the manifest (§6.13) is checked by
    // exactly this code rather than a copy of it.
    //
    // `at` is the document path the part sits at, so failures land where the
    // author will look. `paletteSize` is null when the range is not knowable
    // at parse time (a §7.4 reference, or no palette at all) and the check
    // defers to cross-file validation (§11.6).
    //
    // The reference collects every violation and reports the first; this
    // raises at the first. Same answer, because the traversal order is the
    // same — and §11.8 leaves within-phase order implementation-defined
    // anyway, which is why every shared fixture holds exactly one error.
    public static void CheckPartFields(GeometryDocPart part, DocPath at, int? paletteSize)
    {
        int w = part.Size.W;
        int h = part.Size.H;
        int d = part.Size.D;

        // SPEC §7.9: H layers of D rows of W characters, positionally indexed.
        // Each level stops descending when it fails, so a part with the wrong
        // layer count reports that rather than a cascade of row errors.
        if (part.Voxels.Count != h)
        {
            throw JsonRead.Fail(
                CuboidyErrorCode.WrongArity,
                $"{part.Voxels.Count} layers, expected H={h}",
                at.Add("voxels"));
        }

        for (int y = 0; y < part.Voxels.Count; y++)
        {
            IReadOnlyList<string> layer = part.Voxels[y];
            if (layer.Count != d)
            {
                throw JsonRead.Fail(
                    CuboidyErrorCode.WrongArity,
                    $"{layer.Count} rows, expected D={d}",
                    at.Add("voxels", y));
            }

            for (int z = 0; z < layer.Count; z++)
            {
                string row = layer[z];
                if (row.Length != w)
                {
                    throw JsonRead.Fail(
                        CuboidyErrorCode.WrongArity,
                        $"row length {row.Length}, expected W={w}",
                        at.Add("voxels", y, z));
                }

                // SPEC §7.4: index-range validation is skipped when the range
                // is not known here — it moves to cross-file validation
                // (§11.6).
                if (paletteSize is null) continue;
                foreach (char ch in row)
                {
                    int? index = VoxelRow.CharToIndex(ch);
                    if (index is null || index == VoxelRow.Air) continue;
                    if (index >= paletteSize)
                    {
                        throw JsonRead.Fail(
                            CuboidyErrorCode.InvalidValue,
                            $"'{ch}' is palette index {index}, palette has {paletteSize}",
                            at.Add("voxels", y, z));
                    }
                }
            }
        }

        // SPEC §7.8: socket names unique within a part.
        var socketNames = new HashSet<string>(StringComparer.Ordinal);
        for (int s = 0; s < part.Sockets.Count; s++)
        {
            string name = part.Sockets[s].Name;
            if (!socketNames.Add(name))
            {
                throw JsonRead.Fail(
                    CuboidyErrorCode.Duplicate,
                    $"duplicate socket \"{name}\"",
                    at.Add("sockets", s, "name"));
            }
        }
    }

    // ----- leaves ---------------------------------------------------------

    private static int Dim(JsonElement e, DocPath at)
    {
        int value = JsonRead.Integer(e, at);
        if (value < 1 || value > SizeMax)
        {
            throw JsonRead.Fail(
                CuboidyErrorCode.InvalidValue, $"expected 1..{SizeMax}, got {value}", at);
        }

        return value;
    }

    private static string Hex(JsonElement e, DocPath at)
    {
        string value = JsonRead.String(e, at);
        if (PaletteCodec.ParseHexColor(value) is null)
        {
            throw JsonRead.Fail(
                CuboidyErrorCode.InvalidValue, "must be #RGB, #RGBA, #RRGGBB or #RRGGBBAA", at);
        }

        return value;
    }

    private static double? Unit(ObjectFields fields, DocPath at, string key) =>
        fields.TryGet(key, out JsonElement e) ? JsonRead.Unit(e, at.Add(key)) : (double?)null;
}
