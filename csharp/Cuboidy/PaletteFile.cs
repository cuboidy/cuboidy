// Port of ts/packages/core/src/palette-file.ts.
//
// SPEC §6.10 (v0.7): external palette file — a shareable palette bound to a
// model via a §7.4 reference or the manifest's top-level `palette`. The entry
// grammar, 64-color maximum and index assignment (`0-9a-zA-Z$%`) are the same as
// the inline geometry palette (§7.4); only the container differs. Object form
// (not a bare array) so the format has room for metadata — named colors and
// the like — without a breaking change.
//
//   { "colors": ["#1a1a1a", { "color": "#f4c9a0", "metallic": 1 }, …] }
//
// The entry reader is `GeometrySchema.ReadPaletteEntry`, shared rather than
// restated: a shared palette that the geometry files could not express would
// be a poor kind of shared.

using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Cuboidy;

public static class PaletteFileReader
{
    public static Result<IReadOnlyList<PaletteEntry>> ParsePaletteFile(JsonElement json)
    {
        try
        {
            DocPath at = DocPath.Root;
            ObjectFields fields = JsonRead.Fields(json, at, "colors");

            DocPath colorsAt = at.Add("colors");
            JsonElement colorsEl = JsonRead.ArrayValue(fields.Required("colors"), colorsAt);
            int count = colorsEl.GetArrayLength();
            if (count < 1 || count > PaletteCodec.MaxPalette)
            {
                throw JsonRead.Fail(
                    CuboidyErrorCode.WrongArity,
                    $"expected 1..{PaletteCodec.MaxPalette} colors, got {count}",
                    colorsAt);
            }

            var entries = new List<PaletteEntryDoc>(count);
            int i = 0;
            foreach (JsonElement entryEl in colorsEl.EnumerateArray())
            {
                entries.Add(GeometrySchema.ReadPaletteEntry(entryEl, colorsAt.Add(i)));
                i++;
            }

            return Result.Ok(GeometryReader.ColorsToPalette(entries));
        }
        catch (ReaderException e)
        {
            return e.ToResult<IReadOnlyList<PaletteEntry>>();
        }
    }

    // The same thing from TEXT. Three callers in the reference had each wrapped
    // the reader in their own `JSON.parse` + try/catch, and all three swallowed
    // a malformed document into a bare `null` — indistinguishable from "no such
    // file" at the call site, so none of them could report what was actually
    // wrong.
    public static Result<IReadOnlyList<PaletteEntry>> ParsePaletteFileText(string text)
    {
        if (text is null) throw new ArgumentNullException(nameof(text));

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(text);
        }
        catch (JsonException e)
        {
            // Wording preserved from the reference, which preserved it in turn
            // from the reader it replaced — it is what the CLIs have always
            // printed, and a diagnostic's text is user-facing whether or not
            // anything parses it.
            return Result.Err<IReadOnlyList<PaletteEntry>>(
                CuboidyErrorCode.InvalidValue, $"JSON parse: {e.Message}");
        }

        using (document)
        {
            return ParsePaletteFile(document.RootElement);
        }
    }
}
