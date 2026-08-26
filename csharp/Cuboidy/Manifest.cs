// Port of ts/packages/core/src/manifest.ts.
//
// SPEC §6: what a valid `cuboidy.json` is. Same two-phase structure as the
// geometry reader, for the same §11.8 reason — `Read` is phase 2 and
// `CheckCrossFields` is phase 3 — and the inline-geometry cross-field checks
// go through `GeometrySchema.CheckPartFields`, the very same code a geometry
// file's part goes through. A second copy would be a second opinion about what
// a valid part is.

using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Cuboidy;

// SPEC §6.13: where a part's shape comes from. Two forms in one object, told
// apart by whether `Path` is present:
//
//   { "path": "voxels.json" }                    a part in a file
//   { "path": "caps.json", "part": "beret" }     …under a different name
//   { "size": …, "voxels": …, … }                written out here
//
// ONE record rather than a union, which is the reference's decision and its
// reasoning carries over unchanged: the SPEC asks for `missing` on an
// incomplete inline object and `unknown` on a field belonging to the other
// form, and a union would land every mistake on the catch-all `invalid-value`.
//
// The inline half is a geometry part minus `name` (the enclosing part already
// has one — a second copy is a field that can disagree with another) plus
// §7.4's palette, with `Size` and `Voxels` nullable here and required back in
// the form check, since they are required only when the form is inline.
public sealed record PartGeometry(
    string? Path,
    string? Part,
    Size? Size,
    Pivot? Pivot,
    IReadOnlyList<Socket>? Sockets,
    IReadOnlyList<IReadOnlyList<string>>? Voxels,
    PaletteField? Palette);

public sealed record ManifestPart(
    string Name,
    string? Parent,
    Vec3? Position,
    // SPEC §6.2 (v0.9): rest rotation in parent space, Euler degrees ZXY (§4),
    // applied around the part's pivot on top of the geometry-side `pivot.rot`
    // (q_rest = q_rotation · q_pivot, §7.7). Absent → identity.
    Vec3? Rotation,
    // SPEC §6.2 (v0.9): rest scale, per-axis multipliers on this part's own
    // voxels around its pivot. Multiplies with the keyframe `scale` of §6.5
    // (S_total = scale ⊙ anim.scale) and, like that one, does NOT reach the
    // part's children (§7.7). Absent → [1, 1, 1].
    Vec3? Scale,
    // SPEC §6.13. Absent → the by-`name` lookup among the files in the
    // top-level `geometry` list, which is what every pre-v0.9 model uses.
    PartGeometry? Geometry);

// SPEC §6.12: one entry of the manifest's `sockets` map — a published name
// (the map key) aliasing a socket declared on a part in geometry (§7.8). Pure
// aliasing: no offset of its own, so the frame is exactly §7.8's.
public sealed record PublishedSocket(string Part, string Socket);

public sealed record Manifest(
    string Name,
    string? Version,
    // SPEC §6.9: the model's geometry files. Absent → the default
    // ["voxels.json"] (use `ManifestReader.ManifestGeometry` to read with the
    // default applied). Part names are unique across ALL listed files.
    IReadOnlyList<string>? Geometry,
    // SPEC §6.1 / §6.13: the palette INLINE part geometry falls back to.
    // Scoped, unlike v0.7's field of the same name: it never reaches into a
    // geometry file, so a referenced part still means what its own file says
    // (§7.4) and there is nothing to shadow.
    PaletteField? Palette,
    IReadOnlyList<ManifestPart> Parts,
    // SPEC §6.12: the attachment points this model offers to consumers. Keys
    // are §5 identifiers and are unique model-wide by virtue of being object
    // keys — a socket name is only unique WITHIN its part (§7.8), so
    // publication is what gives an attachment point an unambiguous name.
    // Absent → the model publishes none, which is the empty map rather than
    // null so no caller needs the branch.
    OrderedMap<PublishedSocket> Sockets,
    OrderedMap<Animation> Animations);

public static class ManifestReader
{
    public static Result<Manifest> ParseManifest(JsonElement json)
    {
        try
        {
            Manifest manifest = Read(json);   // phase 2
            CheckCrossFields(manifest);       // phase 3
            return Result.Ok(manifest);
        }
        catch (ReaderException e)
        {
            return e.ToResult<Manifest>();
        }
    }

    // New surface, not a port: the reference's callers each run their own
    // `JSON.parse` before `parseManifest`, and both of them live in `cli/`,
    // which is dropped. The loader needs exactly this — and having it here
    // rather than in the loader is what lets a manifest failure carry a line
    // number, the same way a geometry failure already does.
    public static Result<Manifest> ParseManifestText(string text)
    {
        if (text is null) throw new ArgumentNullException(nameof(text));

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(text);
        }
        catch (JsonException e)
        {
            return Result.Err<Manifest>(CuboidyErrorCode.InvalidValue, $"invalid JSON: {e.Message}");
        }

        using (document)
        {
            Result<Manifest> result = ParseManifest(document.RootElement);
            if (result.Ok || result.Path is null || result.Path.Count == 0) return result;
            Position? at = Locate.LocateJsonPath(text, result.Path);
            if (at is null) return result;
            return Result.Err<Manifest>(
                result.Code, $"line {at.Value.Line}: {result.Message}", result.Path);
        }
    }

    // SPEC §6.9: `geometry` with its default applied.
    public static IReadOnlyList<string> ManifestGeometry(Manifest manifest) =>
        manifest.Geometry ?? DefaultGeometry;

    private static readonly string[] DefaultGeometry = { "voxels.json" };

    // ----- phase 2: each field considered on its own ---------------------

    internal static Manifest Read(JsonElement root)
    {
        DocPath at = DocPath.Root;
        ObjectFields fields = JsonRead.Fields(
            root, at, "name", "version", "geometry", "palette", "parts", "sockets", "animations");

        string name = JsonRead.IdentifierValue(fields.Required("name"), at.Add("name"));

        string? version = fields.TryGet("version", out JsonElement versionEl)
            ? JsonRead.String(versionEl, at.Add("version"))
            : null;

        IReadOnlyList<string>? geometry = fields.TryGet("geometry", out JsonElement geometryEl)
            ? ReadGeometryList(geometryEl, at.Add("geometry"))
            : null;

        PaletteField? palette = fields.TryGet("palette", out JsonElement paletteEl)
            ? GeometrySchema.ReadPaletteField(paletteEl, at.Add("palette"))
            : null;

        IReadOnlyList<ManifestPart> parts = ReadParts(fields.Required("parts"), at.Add("parts"));

        OrderedMap<PublishedSocket> sockets = fields.TryGet("sockets", out JsonElement socketsEl)
            ? ReadPublishedSockets(socketsEl, at.Add("sockets"))
            : OrderedMap<PublishedSocket>.Empty;

        OrderedMap<Animation> animations = fields.TryGet("animations", out JsonElement animationsEl)
            ? AnimationSchema.ReadAnimations(animationsEl, at.Add("animations"))
            : OrderedMap<Animation>.Empty;

        return new Manifest(name, version, geometry, palette, parts, sockets, animations);
    }

    private static IReadOnlyList<string> ReadGeometryList(JsonElement e, DocPath at)
    {
        JsonRead.ArrayValue(e, at);
        if (e.GetArrayLength() == 0)
        {
            // §11.5 groups "duplicate or empty `geometry` list" under
            // `invalid-value`, where §11.2 puts a palette's 0-or-over-62 under
            // `wrong-arity`. Two arrays spelled the same way, coded
            // differently, so this is stated rather than derived.
            throw JsonRead.Fail(
                CuboidyErrorCode.InvalidValue, "expected at least one geometry file", at);
        }

        var paths = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        int i = 0;
        foreach (JsonElement item in e.EnumerateArray())
        {
            string path = JsonRead.RefPathValue(item, at.Add(i), ".json");
            if (!seen.Add(path))
            {
                throw JsonRead.Fail(CuboidyErrorCode.InvalidValue, "duplicate geometry entry", at.Add(i));
            }

            paths.Add(path);
            i++;
        }

        return paths;
    }

    private static IReadOnlyList<ManifestPart> ReadParts(JsonElement e, DocPath at)
    {
        JsonRead.ArrayValue(e, at);
        if (e.GetArrayLength() == 0)
        {
            throw JsonRead.Fail(CuboidyErrorCode.Missing, "expected at least one part", at);
        }

        var parts = new List<ManifestPart>();
        int i = 0;
        foreach (JsonElement item in e.EnumerateArray())
        {
            parts.Add(ReadPart(item, at.Add(i)));
            i++;
        }

        return parts;
    }

    private static ManifestPart ReadPart(JsonElement e, DocPath at)
    {
        ObjectFields fields = JsonRead.Fields(e, at, "name", "parent", "position", "rotation", "scale", "geometry");
        return new ManifestPart(
            JsonRead.IdentifierValue(fields.Required("name"), at.Add("name")),
            fields.TryGet("parent", out JsonElement parentEl)
                ? JsonRead.IdentifierValue(parentEl, at.Add("parent"))
                : null,
            fields.TryGet("position", out JsonElement positionEl)
                ? JsonRead.Vec3Value(positionEl, at.Add("position"))
                : (Vec3?)null,
            fields.TryGet("rotation", out JsonElement rotationEl)
                ? JsonRead.Vec3Value(rotationEl, at.Add("rotation"))
                : (Vec3?)null,
            fields.TryGet("scale", out JsonElement scaleEl)
                ? JsonRead.ScaleValue(scaleEl, at.Add("scale"))
                : (Vec3?)null,
            fields.TryGet("geometry", out JsonElement geometryEl)
                ? ReadPartGeometry(geometryEl, at.Add("geometry"))
                : null);
    }

    private static PartGeometry ReadPartGeometry(JsonElement e, DocPath at)
    {
        ObjectFields fields = JsonRead.Fields(
            e, at, "size", "pivot", "sockets", "voxels", "palette", "path", "part");

        // Every present field is validated on its own FIRST — a malformed
        // `size` outranks the form check below, the way a `.strict()` object
        // parse outranks its own refinement in the reference.
        Size? size = fields.TryGet("size", out JsonElement sizeEl)
            ? GeometrySchema.ReadSize(sizeEl, at.Add("size"))
            : (Size?)null;
        Pivot? pivot = fields.TryGet("pivot", out JsonElement pivotEl)
            ? GeometrySchema.ReadPlacement(pivotEl, at.Add("pivot"))
            : (Pivot?)null;
        IReadOnlyList<Socket>? sockets = fields.TryGet("sockets", out JsonElement socketsEl)
            ? GeometrySchema.ReadSockets(socketsEl, at.Add("sockets"))
            : null;
        IReadOnlyList<IReadOnlyList<string>>? voxels = fields.TryGet("voxels", out JsonElement voxelsEl)
            ? GeometrySchema.ReadVoxels(voxelsEl, at.Add("voxels"))
            : null;
        PaletteField? palette = fields.TryGet("palette", out JsonElement paletteEl)
            ? GeometrySchema.ReadPaletteField(paletteEl, at.Add("palette"))
            : null;
        string? path = fields.TryGet("path", out JsonElement pathEl)
            ? JsonRead.RefPathValue(pathEl, at.Add("path"), ".json")
            : null;
        string? part = fields.TryGet("part", out JsonElement partEl)
            ? JsonRead.IdentifierValue(partEl, at.Add("part"))
            : null;

        if (path is not null)
        {
            RejectInlineField(at, "size", size is not null);
            RejectInlineField(at, "pivot", pivot is not null);
            RejectInlineField(at, "sockets", sockets is not null);
            RejectInlineField(at, "voxels", voxels is not null);
            RejectInlineField(at, "palette", palette is not null);
            return new PartGeometry(path, part, null, null, null, null, null);
        }

        // Inline form. `part` names which part of a REFERENCED file to bind,
        // so it is meaningless without `path` — SPEC §6.13 says the inline
        // object is exactly a §7.5 part minus `name` plus `palette`, and §11.5
        // codes anything else `unknown`. That is also the shape of the actual
        // authoring slip: naming the part and forgetting the file.
        if (part is not null)
        {
            throw JsonRead.Fail(
                CuboidyErrorCode.Unknown,
                "`part` names a part inside a referenced file; inline geometry has no file to name " +
                "(did you mean to add `path`?)",
                at.Add("part"));
        }

        if (size is null)
        {
            throw JsonRead.Fail(CuboidyErrorCode.Missing, "required field is missing", at.Add("size"));
        }

        if (voxels is null)
        {
            throw JsonRead.Fail(CuboidyErrorCode.Missing, "required field is missing", at.Add("voxels"));
        }

        // Everything above is §11.8 phase 2 — each field considered on its own.
        // The cross-field rules for an inline part (voxel arity against `size`,
        // palette index range, socket-name uniqueness) are phase 3, and a
        // phase runs only if every earlier one passed. They therefore CANNOT
        // live here: this runs during the document's own structural parse, so
        // a bad row width on one part would be reported ahead of an absent
        // `name` on the next. They run from `CheckCrossFields`.
        return new PartGeometry(null, null, size, pivot, sockets, voxels, palette);
    }

    private static void RejectInlineField(DocPath at, string key, bool present)
    {
        if (!present) return;
        throw JsonRead.Fail(
            CuboidyErrorCode.Unknown,
            $"`{key}` belongs to inline geometry; a reference has only `path` and `part`",
            at.Add(key));
    }

    private static OrderedMap<PublishedSocket> ReadPublishedSockets(JsonElement e, DocPath at)
    {
        JsonRead.ObjectValue(e, at);
        var entries = new List<KeyValuePair<string, PublishedSocket>>();
        foreach (JsonProperty property in e.EnumerateObject())
        {
            DocPath entryAt = at.Add(property.Name);
            if (!Identifier.IsIdentifier(property.Name))
            {
                throw JsonRead.Fail(
                    CuboidyErrorCode.InvalidValue,
                    "published socket name must match the identifier regex " +
                    "(letters/digits/_/-, no leading digit or hyphen) and not be a reserved keyword",
                    entryAt);
            }

            ObjectFields fields = JsonRead.Fields(property.Value, entryAt, "part", "socket");
            entries.Add(new KeyValuePair<string, PublishedSocket>(
                property.Name,
                new PublishedSocket(
                    JsonRead.IdentifierValue(fields.Required("part"), entryAt.Add("part")),
                    JsonRead.IdentifierValue(fields.Required("socket"), entryAt.Add("socket")))));
        }

        return OrderedMap<PublishedSocket>.From(entries);
    }

    // ----- phase 3: rules needing more than one field at a time ----------

    // SPEC §11.5 hierarchy rules: duplicate part names, parents that name no
    // part, and parent cycles are manifest errors.
    internal static void CheckCrossFields(Manifest manifest)
    {
        // §11.8 phase 3: "parts are examined in document order; within a part"
        // duplicate name, then the arity levels, then palette indices, then
        // sockets — which is why the inline-geometry check sits inside this
        // loop rather than after it, and is the order a geometry file's parts
        // are already examined in.
        var names = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < manifest.Parts.Count; i++)
        {
            ManifestPart part = manifest.Parts[i];
            if (!names.Add(part.Name))
            {
                throw JsonRead.Fail(
                    CuboidyErrorCode.Duplicate,
                    $"duplicate part name \"{part.Name}\"",
                    DocPath.Root.Add("parts", i, "name"));
            }

            // SPEC §6.13 inline geometry, by the same code a geometry file's
            // part goes through. The index range is checked only against a
            // palette written out HERE; a reference — or the manifest's
            // default — defers to §11.6 "even when the manifest's palette is an
            // array in the same document, so that where the colors are written
            // never changes when an error is reported" (§11.8).
            PartGeometry? geometry = part.Geometry;
            if (geometry?.Size is { } size && geometry.Voxels is { } voxels)
            {
                GeometrySchema.CheckPartFields(
                    new GeometryDocPart(
                        part.Name,
                        size,
                        geometry.Pivot,
                        geometry.Sockets ?? System.Array.Empty<Socket>(),
                        voxels),
                    DocPath.Root.Add("parts", i, "geometry"),
                    geometry.Palette?.Colors?.Count);
            }
        }

        for (int i = 0; i < manifest.Parts.Count; i++)
        {
            ManifestPart part = manifest.Parts[i];
            if (part.Parent is not null && !names.Contains(part.Parent))
            {
                throw JsonRead.Fail(
                    CuboidyErrorCode.InvalidValue,
                    $"parent \"{part.Parent}\" is not a part in this manifest",
                    DocPath.Root.Add("parts", i, "parent"));
            }
        }

        // §6.12: a published socket's host part must be a part of this model.
        // The other half of the contract — that the part actually DECLARES a
        // socket by that name — needs the geometry files, so it lives in
        // cross-file validation (§11.6).
        foreach (KeyValuePair<string, PublishedSocket> entry in manifest.Sockets)
        {
            if (!names.Contains(entry.Value.Part))
            {
                throw JsonRead.Fail(
                    CuboidyErrorCode.InvalidValue,
                    $"published socket \"{entry.Key}\" names part \"{entry.Value.Part}\", " +
                    "which is not a part in this manifest",
                    DocPath.Root.Add("sockets", entry.Key, "part"));
            }
        }

        // Cycle check: walk each part's parent chain. With duplicate names the
        // chain is ambiguous, so only run on a clean name set — which the
        // duplicate check above has already guaranteed by raising, but the
        // guard stays because it is what the rule depends on.
        if (names.Count != manifest.Parts.Count) return;

        var parentOf = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (ManifestPart part in manifest.Parts) parentOf[part.Name] = part.Parent;

        var cleared = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < manifest.Parts.Count; i++)
        {
            ManifestPart part = manifest.Parts[i];
            var seen = new HashSet<string>(StringComparer.Ordinal);
            string? current = part.Name;
            while (current is not null && !cleared.Contains(current))
            {
                if (!seen.Add(current))
                {
                    throw JsonRead.Fail(
                        CuboidyErrorCode.InvalidValue,
                        $"parent chain of \"{part.Name}\" contains a cycle",
                        DocPath.Root.Add("parts", i, "parent"));
                }

                parentOf.TryGetValue(current, out current);
            }

            foreach (string s in seen) cleared.Add(s);
        }
    }
}
