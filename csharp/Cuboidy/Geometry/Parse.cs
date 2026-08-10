// Port of ts/packages/core/src/geometry/parse.ts.
//
// SPEC §7: reads a geometry file into the same AST every downstream consumer
// already expects — the resolver, the rig and `BuildMesh` are untouched by
// where the shape was written.
//
// Validation is delegated wholly to `GeometrySchema` so there is exactly one
// definition of what a valid file is. This module's own job is the mapping
// that a schema cannot express: hex strings to `Color`, row strings to palette
// indices, and the §7.7 default pivot.

using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Cuboidy;

public static class GeometryReader
{
    // SPEC §11.8 phase 1 is the JSON parser's own business and has no Cuboidy
    // code of its own, so a caller that already holds a parsed document enters
    // here and one holding bytes enters at `ParseGeometryText`.
    public static Result<Geometry> ParseGeometry(JsonElement json)
    {
        try
        {
            GeometryDoc doc = GeometrySchema.Read(json);   // phase 2
            GeometrySchema.CheckCrossFields(doc);          // phase 3
            return Result.Ok(ToAst(doc));
        }
        catch (ReaderException e)
        {
            return e.ToResult<Geometry>();
        }
    }

    // Convenience for callers holding text rather than a parsed value. Because
    // this one HAS the text, it can resolve the document path back to a line
    // and say so — the `line N:` prefix the retired text format reported, and
    // the only navigation aid an author gets in a plain textarea.
    public static Result<Geometry> ParseGeometryText(string text)
    {
        if (text is null) throw new ArgumentNullException(nameof(text));

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(text);
        }
        catch (JsonException e)
        {
            // SPEC §11.8 phase 1. No path: the failure is about bytes, not
            // about a field. A UTF-8 BOM lands here, which is where SPEC §9
            // wants it and where the reference puts it — see the loader for
            // the other half of hazard S2, since `File.ReadAllText` strips a
            // BOM before a reader ever sees it.
            return Result.Err<Geometry>(CuboidyErrorCode.InvalidValue, $"invalid JSON: {e.Message}");
        }

        using (document)
        {
            Result<Geometry> result = ParseGeometry(document.RootElement);
            if (result.Ok || result.Path is null || result.Path.Count == 0) return result;
            Position? at = Locate.LocateJsonPath(text, result.Path);
            if (at is null) return result;
            return Result.Err<Geometry>(
                result.Code, $"line {at.Value.Line}: {result.Message}", result.Path);
        }
    }

    // ----- AST construction ----------------------------------------------

    internal static Geometry ToAst(GeometryDoc doc)
    {
        // An absent palette is an EMPTY list in the AST, not a missing field:
        // length 0 is the unambiguous "declared none" signal (§7.4).
        //
        // A reference stays UNRESOLVED here — parsing one file cannot see the
        // package around it. The project layer reads `PaletteRef` and fills
        // `Palette` in, so nothing downstream of it has to care which form the
        // author used.
        IReadOnlyList<PaletteEntry> palette = doc.Palette?.Colors is { } colors
            ? ColorsToPalette(colors)
            : System.Array.Empty<PaletteEntry>();

        var parts = new List<Part>(doc.Parts.Count);
        foreach (GeometryDocPart part in doc.Parts) parts.Add(ToPart(part));

        return new Geometry(palette, doc.Palette?.Ref, parts);
    }

    // §7.4 palette entries → the runtime palette. Shared so that inline
    // geometry and the manifest's default palette (§6.13) become entries by
    // exactly the route a geometry file's own palette takes.
    internal static IReadOnlyList<PaletteEntry> ColorsToPalette(IReadOnlyList<PaletteEntryDoc> entries)
    {
        var palette = new List<PaletteEntry>(entries.Count);
        foreach (PaletteEntryDoc entry in entries) palette.Add(ToEntry(entry));
        return palette;
    }

    // SPEC §6.13: build the runtime Part for geometry written INLINE in the
    // manifest, taking its `name` from the enclosing manifest part (the inline
    // object deliberately has none). The manifest reader has already validated
    // it against the same rules a file's part goes through — literally the
    // same `CheckPartFields` — and this is the same mapping, so downstream
    // nothing can tell an inline part from a file one. That is the whole
    // point: no consumer should branch on where a shape was written.
    internal static Part InlinePartToAst(GeometryDocPart doc, string name) =>
        ToPart(doc with { Name = name });

    private static PaletteEntry ToEntry(PaletteEntryDoc doc)
    {
        // The reader has already accepted only well-formed hex, so this cannot
        // fail; the raise documents the invariant rather than guarding a
        // reachable path.
        PaletteEntry? entry = PaletteCodec.PaletteEntryFrom(doc);
        if (entry is null)
        {
            throw new InvalidOperationException($"unreachable: reader accepted bad color {doc.Color}");
        }

        return entry.Value;
    }

    private static Part ToPart(GeometryDocPart part)
    {
        var voxels = new List<IReadOnlyList<IReadOnlyList<int>>>(part.Voxels.Count);
        foreach (IReadOnlyList<string> layer in part.Voxels)
        {
            var rows = new List<IReadOnlyList<int>>(layer.Count);
            foreach (string row in layer) rows.Add(ToRow(row));
            voxels.Add(rows);
        }

        return new Part(part.Name, part.Size, ToPivot(part.Pivot, part.Size), part.Sockets, voxels);
    }

    // SPEC §7.7: absent pivot means bottom-center of the bounding box. Filling
    // the default here rather than leaving it optional keeps every consumer
    // free of "if the pivot is missing" branches.
    private static Pivot ToPivot(Pivot? pivot, Size size)
    {
        if (pivot is not null) return pivot.Value;

        // `/ 2.0`, not `/ 2` — hazard N1, and the loudest one in the port. W
        // and D are `int`, so integer division gives a width-3 part a pivot of
        // 1 instead of 1.5, and every downstream coordinate is off by half a
        // voxel, silently and only for odd dimensions.
        return new Pivot(new Vec3(size.W / 2.0, 0, size.D / 2.0), null);
    }

    private static IReadOnlyList<int> ToRow(string row)
    {
        var cells = new int[row.Length];
        for (int i = 0; i < row.Length; i++)
        {
            int? index = VoxelRow.CharToIndex(row[i]);
            if (index is null)
            {
                throw new InvalidOperationException($"unreachable: reader accepted bad cell '{row[i]}'");
            }

            cells[i] = index.Value;
        }

        return cells;
    }
}
