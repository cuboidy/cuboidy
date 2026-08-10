// Port of ts/packages/core/src/project.ts.
//
// Shared project-resolution layer (SPEC §6.9, §6.10, §6.13, §7.4): manifest →
// geometry files → external palette → external animation → every manifest part
// bound to a shape. PURE — the caller supplies file TEXTS; this module never
// touches IO, which is exactly why `PackageLoader` can sit on top of it and an
// in-memory or archive-backed caller can sit beside it.
//
// `resolveProject`'s `overrides` option is NOT ported. It lets a caller
// substitute a live geometry AST for a file's text so the editor keeps
// rendering the last good shape while the file it came from does not parse. Its
// only caller anywhere is the editor. A library has no mid-edit state to
// preserve — and it is the door through which an unvalidated `Part` reaches
// `BuildMesh`, which is why `VoxelAt` bounds-checks the arrays as well as the
// declared size.
//
// PALETTE INDEX RANGE is deliberately absent. §11.6 makes an index past the end
// of its resolved palette an error and the check lives in lint, which is not
// ported; a runtime that only draws has the answer it needs from §7.4 — an
// index no palette defines renders as opaque magenta. Do not go looking for it
// here.

using System;
using System.Collections.Generic;

namespace Cuboidy;

public sealed record GeometryFile(string Path, Geometry Geometry);

// A diagnostic tagged with the package-relative path it belongs to.
public sealed record ProjectDiagnostic(string File, ResolutionDiagnostic Diag);

public sealed record ProjectPaths(
    // Geometry refs (§6.9) with the ["voxels.json"] default applied,
    // normalized. List order is preserved (the first entry is the model's
    // primary file).
    IReadOnlyList<string> Geometry,
    // Normalized §6.3 external animation refs (deduped — two clips may share
    // one file).
    IReadOnlyList<string> Animations);

// A manifest part whose shape could not be found. Carries the explanation
// rather than a formatted diagnostic so the reporting layer decides where it
// is attributed (§11.6 puts it with the other cross-file findings).
public sealed record UnresolvedPart(string Name, string Message);

// SPEC §11.6: one part name defined by more than one file of the `geometry`
// list, which makes the by-`name` lookup ambiguous. Unlike `UnresolvedPart`
// this IS a resolution failure.
public sealed record DuplicatePartName(string Name, IReadOnlyList<string> Files);

// Where a shape was WRITTEN: the geometry file and the name the part has
// *there*. Null on a `ResolvedPart` when it is inline in the manifest (§6.13).
//
// Both halves are needed. `Part` differs from the rig's name whenever
// `geometry.part` renames it or two rig parts share one shape, and without it
// a consumer cannot say which definition in the file this came from.
public sealed record PartSource(string File, string Part);

// SPEC §6.13: one manifest part's shape, wherever it was written. Every
// consumer downstream of resolution reads this instead of joining manifest
// parts to geometry parts by name — that join is the resolver's job, and doing
// it once is what makes the three forms indistinguishable.
public sealed record ResolvedPart(
    // The §7.5 shape, with `Name` set from the manifest part in every form.
    Part Part,
    // What this part's voxel indices mean. Empty when nothing supplied a
    // palette.
    IReadOnlyList<PaletteEntry> Palette,
    PartSource? Source);

public sealed record ExternalAnimation(string Path, InlineAnimation Anim);

public sealed record ResolvedProject(
    // Geometry files that parsed, in manifest list order. A file that declared
    // a §7.4 palette REFERENCE has had it resolved: `Geometry.Palette` holds
    // the colors and `Geometry.PaletteRef` records where they came from, so
    // consumers never branch on which form the author used.
    IReadOnlyList<GeometryFile> Geometries,
    // SPEC §6.13: every manifest part's shape, keyed by part name, IN MANIFEST
    // ORDER (hazard C1). A part whose geometry could not be resolved is ABSENT
    // and has an entry in `Unresolved` instead.
    OrderedMap<ResolvedPart> Parts,
    IReadOnlyList<UnresolvedPart> Unresolved,
    IReadOnlyList<DuplicatePartName> Duplicates,
    // Resolved §6.3 external animations, keyed by CLIP name (two clips may
    // reference the same file). Only entries that loaded and validated.
    OrderedMap<ExternalAnimation> ExternalAnims,
    IReadOnlyList<ProjectDiagnostic> Diagnostics,
    // True when `Diagnostics` is empty: every referenced file loaded and
    // parsed. Callers gate downstream validation on this — validating a
    // partially-resolved project only piles noise on top of what is already
    // reported.
    //
    // Deliberately NOT affected by `Unresolved`. A part that found no shape is
    // a fault in the model rather than in loading it, and §11.6 is where it
    // gets reported — which requires this flag to stay true, or the report
    // would gate off the reporting.
    bool Complete,
    // True when `Complete` AND every manifest part is bound to a shape AND no
    // part name was ambiguous. This is the question a consumer that DRAWS has:
    // is there a shape for every part I am about to place?
    //
    // Read THIS, not `Complete`. The two exist because they answer different
    // questions and only one of them can gate lint. Splitting them is what
    // stopped this from being a documented behavioural difference between the
    // two implementations — an earlier plan told the C# side to refuse a model
    // TypeScript loads, and two implementations disagreeing about which
    // packages load is the one thing a second implementation exists to
    // prevent. `fixtures/project/` pins both cases.
    bool Resolved);

public sealed record GeometryStage(
    IReadOnlyList<GeometryFile> Geometries,
    IReadOnlyList<ProjectDiagnostic> Diagnostics);

public static class Project
{
    // SPEC §3: the fixed name of the package anchor.
    public const string ManifestFile = "cuboidy.json";

    // SPEC §8: a reference resolves relative to **the file that contains it**.
    // Everything the manifest writes — the geometry list, animation refs, its
    // own §6.13 palette, a part's `geometry.path` — is contained by
    // `cuboidy.json` at the package root, so for those the ref as written is
    // already the package-relative path. A geometry file's §7.4 palette is the
    // one reference written somewhere else, and it is the one this exists for:
    // `gear/body.json` naming `palette.json` means `gear/palette.json`, not a
    // `palette.json` at the root.
    public static string ResolveRefFrom(string fromFile, string reference)
    {
        int i = fromFile.LastIndexOf('/');
        string dir = i == -1 ? string.Empty : fromFile.Substring(0, i + 1);
        return NormalizeRefPath(dir + reference);
    }

    // Each geometry file's §7.4 palette reference, resolved against that file
    // (§8). Only discoverable AFTER the geometry files are read, so callers
    // that stage IO in one pass need this second round.
    public static IReadOnlyList<string> PalettePathsOf(IReadOnlyList<GeometryFile> geometries)
    {
        var paths = new List<string>();
        foreach (GeometryFile g in geometries)
        {
            if (g.Geometry.PaletteRef is null) continue;
            paths.Add(ResolveRefFrom(g.Path, g.Geometry.PaletteRef));
        }

        return Distinct(paths);
    }

    // SPEC §6.9 + §6.13: the geometry files a model actually reads. Two sources
    // — the top-level `geometry` list, and each part's own `geometry.path`.
    public static IReadOnlyList<string> GeometryPaths(Manifest? manifest)
    {
        if (manifest is null) return new[] { "voxels.json" };
        var paths = new List<string>(ListedGeometryPaths(manifest));
        foreach (ManifestPart p in manifest.Parts)
        {
            if (p.Geometry?.Path is { } path) paths.Add(NormalizeRefPath(path));
        }

        return Distinct(paths);
    }

    // SPEC §6.9: the files the by-`name` lookup searches — the manifest's
    // `geometry` list, with its default applied only when some part actually
    // needs the lookup.
    //
    // The DEFAULT `["voxels.json"]` is supplied only when some part still needs
    // the by-`name` lookup. This is what lets a model be a single file: an
    // all-inline manifest never looks in the list, and demanding a
    // `voxels.json` beside it would make the one-file form impossible (§6.9).
    // An explicitly written list is always read, even if nothing resolves to
    // it, so a stale entry still surfaces as the §11.6 `unknown` warning rather
    // than being dropped in silence.
    //
    // A file reached ONLY by an explicit §6.13 `geometry.path` is deliberately
    // not in it. That form binds by path, and §11.6 says such files "do not
    // take part" in the name-uniqueness check — so they must not be searched by
    // name either, or a name they happen to share would bind without ever being
    // checked for being ambiguous.
    private static List<string> ListedGeometryPaths(Manifest manifest)
    {
        var paths = new List<string>();
        if (manifest.Geometry is not null)
        {
            foreach (string p in manifest.Geometry) paths.Add(NormalizeRefPath(p));
            return paths;
        }

        bool someNeedsLookup = false;
        foreach (ManifestPart p in manifest.Parts)
        {
            if (p.Geometry is null)
            {
                someNeedsLookup = true;
                break;
            }
        }

        if (!someNeedsLookup) return paths;
        foreach (string p in ManifestReader.ManifestGeometry(manifest)) paths.Add(NormalizeRefPath(p));
        return paths;
    }

    // The package-relative files a project references. Callers read these into
    // the map handed to `ResolveProject`.
    public static ProjectPaths ProjectFilePaths(Manifest? manifest)
    {
        IReadOnlyList<string> geometry = GeometryPaths(manifest);
        var animations = new List<string>();
        if (manifest is not null)
        {
            foreach (KeyValuePair<string, Animation> entry in manifest.Animations)
            {
                if (entry.Value.Ref is { } reference) animations.Add(NormalizeRefPath(reference));
            }
        }

        // NOTE: palettes are absent here on purpose — a §7.4 reference lives
        // INSIDE a geometry file, so it is only discoverable once those are
        // read. Callers that stage IO up front do a second round via
        // `PalettePathsOf`.
        return new ProjectPaths(geometry, Distinct(animations));
    }

    // Phase one of `ResolveProject`: parse the manifest's geometry files.
    // Exposed because §7.4 palette references live INSIDE those files, so a
    // caller that stages its IO up front has to parse geometry before it knows
    // which palette files to fetch. Cheap enough to run twice — a package holds
    // a handful of small files.
    public static GeometryStage ResolveGeometries(
        Manifest? manifest,
        IReadOnlyDictionary<string, string> files)
    {
        var diagnostics = new List<ProjectDiagnostic>();
        var geometries = new List<GeometryFile>();
        foreach (string reference in ProjectFilePaths(manifest).Geometry)
        {
            if (!files.TryGetValue(reference, out string? text))
            {
                diagnostics.Add(Missing(reference, $"cannot read {reference}"));
                continue;
            }

            Result<Geometry> r = GeometryReader.ParseGeometryText(text);
            if (!r.Ok)
            {
                diagnostics.Add(new ProjectDiagnostic(
                    reference, new ResolutionDiagnostic(r.Code, Severity.Error, r.Message)));
                continue;
            }

            geometries.Add(new GeometryFile(reference, r.Value));
        }

        return new GeometryStage(geometries, diagnostics);
    }

    public static ResolvedProject ResolveProject(
        Manifest? manifest,
        IReadOnlyDictionary<string, string> files)
    {
        if (files is null) throw new ArgumentNullException(nameof(files));

        GeometryStage stage = ResolveGeometries(manifest, files);
        var parsed = new List<GeometryFile>(stage.Geometries);
        var diagnostics = new List<ProjectDiagnostic>(stage.Diagnostics);

        // §7.4 palette references, resolved per geometry file. Filling
        // `Palette` in HERE is what keeps every consumer downstream free of
        // "inline or reference?" branches. Cached by path so two files sharing
        // one palette read it once and report at most one diagnostic.
        var paletteCache = new Dictionary<string, IReadOnlyList<PaletteEntry>?>(StringComparer.Ordinal);
        for (int i = 0; i < parsed.Count; i++)
        {
            GeometryFile g = parsed[i];
            if (g.Geometry.PaletteRef is null) continue;
            // §8: relative to the geometry file that wrote it, not to the
            // package root — two files in different directories may name
            // `palette.json` and mean different files.
            string path = ResolveRefFrom(g.Path, g.Geometry.PaletteRef);
            IReadOnlyList<PaletteEntry>? palette = ReadPaletteCached(path, files, diagnostics, paletteCache);
            if (palette is not null)
            {
                parsed[i] = g with { Geometry = g.Geometry with { Palette = palette } };
            }
        }

        // External animations (§6.3 string refs): each names a JSON file
        // holding ONE inline-animation object, validated with the same reader
        // (and semantic rules) as inline clips. Going through the SAME reader
        // is the point: hand-building the diagnostic with the code hardcoded is
        // how the identical mistake came to report one code written in the
        // manifest and another written in a file beside it.
        var externalAnims = new List<KeyValuePair<string, ExternalAnimation>>();
        if (manifest is not null)
        {
            foreach (KeyValuePair<string, Animation> entry in manifest.Animations)
            {
                if (entry.Value.Ref is not { } reference) continue;
                string clip = entry.Key;
                string path = NormalizeRefPath(reference);

                if (!files.TryGetValue(path, out string? text))
                {
                    diagnostics.Add(Missing(path, $"cannot read {path} (animation '{clip}')"));
                    continue;
                }

                Result<InlineAnimation> r = ReadExternalAnimation(text);
                if (!r.Ok)
                {
                    diagnostics.Add(new ProjectDiagnostic(
                        path,
                        new ResolutionDiagnostic(
                            r.Code, Severity.Error, $"animation '{clip}': {r.Message}")));
                    continue;
                }

                externalAnims.Add(new KeyValuePair<string, ExternalAnimation>(
                    clip, new ExternalAnimation(path, r.Value)));
            }
        }

        // §6.13 part binding, last: it needs the geometry files parsed AND
        // their palette references filled in above, because a referenced part
        // takes its colors from the file it lives in.
        OrderedMap<ResolvedPart> parts;
        IReadOnlyList<UnresolvedPart> unresolved;
        IReadOnlyList<DuplicatePartName> duplicates;
        if (manifest is null)
        {
            parts = OrderedMap<ResolvedPart>.Empty;
            unresolved = System.Array.Empty<UnresolvedPart>();
            duplicates = System.Array.Empty<DuplicatePartName>();
        }
        else
        {
            PartBinding bound = ResolvePartGeometry(
                manifest,
                parsed,
                path => ReadPaletteCached(path, files, diagnostics, paletteCache));
            parts = bound.Parts;
            unresolved = bound.Unresolved;
            duplicates = bound.Duplicates;
        }

        // §11.6's name-uniqueness rule is NOT a diagnostic here. Resolution's
        // part in it is the refusal to bind, and that is already done in
        // `ResolvePartGeometry`. Reporting it here too would set
        // `Complete: false`, which gates cross-file validation off entirely —
        // so one ambiguous name would hide every other §11.6 finding for the
        // model, including ones about unrelated files.
        return new ResolvedProject(
            parsed,
            parts,
            unresolved,
            duplicates,
            OrderedMap<ExternalAnimation>.From(externalAnims),
            diagnostics,
            Complete: diagnostics.Count == 0,
            Resolved: diagnostics.Count == 0 && unresolved.Count == 0 && duplicates.Count == 0);
    }

    public sealed record PartBinding(
        OrderedMap<ResolvedPart> Parts,
        IReadOnlyList<UnresolvedPart> Unresolved,
        IReadOnlyList<DuplicatePartName> Duplicates);

    // SPEC §6.13: bind every manifest part to its shape. Three forms, one
    // output — which is the point of doing it here rather than leaving each
    // consumer to work it out:
    //
    //   geometry absent   → the part of the same name among the listed files
    //   geometry.path     → that file's part, named by `part` (default: this name)
    //   inline            → the manifest's own object
    //
    // A part that does not resolve is left OUT of `Parts` and described in
    // `Unresolved` — it is not a project diagnostic, on purpose. Diagnostics
    // gate cross-file validation off entirely, so reporting a misnamed part
    // here would suppress every other cross-file rule for the model.
    public static PartBinding ResolvePartGeometry(
        Manifest manifest,
        IReadOnlyList<GeometryFile> geometries,
        Func<string, IReadOnlyList<PaletteEntry>?> readPalette)
    {
        var byPath = new Dictionary<string, GeometryFile>(StringComparer.Ordinal);
        foreach (GeometryFile g in geometries) byPath[g.Path] = g;

        // SPEC §11.6 / §11.8 phase 4: "the same part name defined in more than
        // one file of the `geometry` list" is an error, and §5 uniqueness being
        // model-wide is exactly what makes the by-`name` lookup unambiguous.
        //
        // The lookup used to take the first file silently and leave the report
        // to lint. That left a runtime — which is what this library is, and it
        // carries no lint — binding an ambiguous name to whichever file it
        // happened to see first, a choice that depends on collection ordering
        // rather than on the model. Resolution refuses instead.
        var listed = new HashSet<string>(ListedGeometryPaths(manifest), StringComparer.Ordinal);
        var byName = new Dictionary<string, GeometryFile>(StringComparer.Ordinal);
        var definedIn = new List<KeyValuePair<string, List<string>>>();
        var definedInByName = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (GeometryFile g in geometries)
        {
            if (!listed.Contains(g.Path)) continue;
            foreach (Part p in g.Geometry.Parts)
            {
                if (!definedInByName.TryGetValue(p.Name, out List<string>? prior))
                {
                    prior = new List<string> { g.Path };
                    definedInByName[p.Name] = prior;
                    definedIn.Add(new KeyValuePair<string, List<string>>(p.Name, prior));
                    byName[p.Name] = g;
                }
                else if (!prior.Contains(g.Path))
                {
                    prior.Add(g.Path);
                }
            }
        }

        var duplicates = new List<DuplicatePartName>();
        foreach (KeyValuePair<string, List<string>> entry in definedIn)
        {
            if (entry.Value.Count <= 1) continue;
            duplicates.Add(new DuplicatePartName(entry.Key, entry.Value));
            // And the name binds to NOTHING. Reporting the ambiguity while
            // still handing back the first file's part would leave the very
            // non-determinism the refusal exists to remove: which file is
            // "first" is a fact about the loader's collections. Two
            // implementations must not disagree about which shape a name
            // means — so neither of them gets to answer.
            byName.Remove(entry.Key);
        }

        // The manifest's default palette for inline parts (§6.13), resolved
        // once.
        IReadOnlyList<PaletteEntry>? modelPalette = manifest.Palette switch
        {
            null => null,
            { Colors: { } colors } => GeometryReader.ColorsToPalette(colors),
            { Ref: { } reference } => readPalette(NormalizeRefPath(reference)),
            _ => null,
        };

        var bound = new List<KeyValuePair<string, ResolvedPart>>();
        var unresolved = new List<UnresolvedPart>();
        foreach (ManifestPart mp in manifest.Parts)
        {
            PartGeometry? g = mp.Geometry;

            // Inline (§6.13): the shape is right here. Its colors are its own,
            // else the model's — never a geometry file's, since it belongs to
            // none.
            if (g is not null && g.Path is null)
            {
                // The reader guarantees these when `path` is absent.
                if (g.Size is not { } size || g.Voxels is not { } voxels) continue;
                IReadOnlyList<PaletteEntry> palette = g.Palette switch
                {
                    null => modelPalette ?? System.Array.Empty<PaletteEntry>(),
                    { Colors: { } colors } => GeometryReader.ColorsToPalette(colors),
                    { Ref: { } reference } =>
                        readPalette(NormalizeRefPath(reference)) ?? System.Array.Empty<PaletteEntry>(),
                    _ => System.Array.Empty<PaletteEntry>(),
                };

                bound.Add(new KeyValuePair<string, ResolvedPart>(mp.Name, new ResolvedPart(
                    GeometryReader.InlinePartToAst(
                        new GeometryDocPart(
                            mp.Name, size, g.Pivot, g.Sockets ?? System.Array.Empty<Socket>(), voxels),
                        mp.Name),
                    palette,
                    null)));
                continue;
            }

            // Reference (§6.13) or the by-name lookup. Both end at a part in a
            // file, so both take that file's palette (§7.4) — the manifest's
            // never applies.
            string wanted = g?.Part ?? mp.Name;
            GeometryFile? file;
            if (g?.Path is { } explicitPath) byPath.TryGetValue(NormalizeRefPath(explicitPath), out file);
            else byName.TryGetValue(mp.Name, out file);

            if (file is null)
            {
                // An unreadable or unparsable path already has its own
                // `missing` from `ResolveGeometries`; saying it twice helps
                // nobody.
                if (g?.Path is null)
                {
                    bool ambiguous = definedInByName.TryGetValue(mp.Name, out List<string>? files)
                                     && files.Count > 1;
                    unresolved.Add(new UnresolvedPart(
                        mp.Name,
                        ambiguous
                            ? $"part '{mp.Name}' is defined in more than one geometry file " +
                              $"({string.Join(", ", definedInByName[mp.Name])}), so the by-name lookup has no answer"
                            : $"part '{mp.Name}' is in the manifest but defined in no geometry file"));
                }

                continue;
            }

            Part? found = null;
            foreach (Part p in file.Geometry.Parts)
            {
                if (string.Equals(p.Name, wanted, StringComparison.Ordinal))
                {
                    found = p;
                    break;
                }
            }

            if (found is null)
            {
                unresolved.Add(new UnresolvedPart(
                    mp.Name,
                    $"part '{mp.Name}' points at '{wanted}' in {file.Path}, which defines no such part"));
                continue;
            }

            bound.Add(new KeyValuePair<string, ResolvedPart>(mp.Name, new ResolvedPart(
                // The rig knows this part by the MANIFEST's name; under an
                // explicit `part` the two differ on purpose (one shape, two rig
                // slots). The name it has in the FILE survives in `Source`.
                string.Equals(found.Name, mp.Name, StringComparison.Ordinal)
                    ? found
                    : found with { Name = mp.Name },
                file.Geometry.Palette,
                new PartSource(file.Path, found.Name))));
        }

        return new PartBinding(
            OrderedMap<ResolvedPart>.From(bound), unresolved, duplicates);
    }

    // Minimal posix-style normalize for SPEC §8 reference paths and package
    // file paths: resolves `.` / `..` segments and collapses empty ones.
    // Leading `..` segments are preserved (they mean "outside the package").
    //
    // This is NOT `Path.GetFullPath` — hazard H5 in the plan document's
    // ancestry, and worth restating. `GetFullPath` anchors on the process's
    // current directory, produces a drive letter and backslashes, and would
    // turn every map key into something no §8 reference can name.
    public static string NormalizeRefPath(string path)
    {
        if (path is null) throw new ArgumentNullException(nameof(path));
        var segments = new List<string>();
        foreach (string segment in path.Split('/'))
        {
            if (segment.Length == 0 || segment == ".") continue;
            if (segment == ".." && segments.Count > 0 && segments[segments.Count - 1] != "..")
            {
                segments.RemoveAt(segments.Count - 1);
            }
            else
            {
                segments.Add(segment);
            }
        }

        return string.Join("/", segments);
    }

    // ----- helpers ---------------------------------------------------------

    // Read + validate one referenced palette file (§6.10). Returns null and
    // records a diagnostic when it is missing or malformed; the referring
    // geometry then keeps its empty palette.
    private static IReadOnlyList<PaletteEntry>? ReadPaletteCached(
        string path,
        IReadOnlyDictionary<string, string> files,
        List<ProjectDiagnostic> diagnostics,
        Dictionary<string, IReadOnlyList<PaletteEntry>?> cache)
    {
        if (cache.TryGetValue(path, out IReadOnlyList<PaletteEntry>? cached)) return cached;

        IReadOnlyList<PaletteEntry>? palette;
        if (!files.TryGetValue(path, out string? text))
        {
            diagnostics.Add(Missing(path, $"cannot read {path}"));
            palette = null;
        }
        else
        {
            Result<IReadOnlyList<PaletteEntry>> r = PaletteFileReader.ParsePaletteFileText(text);
            if (r.Ok)
            {
                palette = r.Value;
            }
            else
            {
                diagnostics.Add(new ProjectDiagnostic(
                    path, new ResolutionDiagnostic(r.Code, Severity.Error, r.Message)));
                palette = null;
            }
        }

        cache[path] = palette;
        return palette;
    }

    // §6.3: an external clip file holds ONE inline-animation object, read by
    // exactly the code an inline clip goes through.
    private static Result<InlineAnimation> ReadExternalAnimation(string text)
    {
        System.Text.Json.JsonDocument document;
        try
        {
            document = System.Text.Json.JsonDocument.Parse(text);
        }
        catch (System.Text.Json.JsonException e)
        {
            return Result.Err<InlineAnimation>(
                CuboidyErrorCode.InvalidValue, $"JSON parse: {e.Message}");
        }

        using (document)
        {
            try
            {
                return Result.Ok(AnimationSchema.ReadInlineAnimation(document.RootElement, DocPath.Root));
            }
            catch (ReaderException e)
            {
                return e.ToResult<InlineAnimation>();
            }
        }
    }

    private static ProjectDiagnostic Missing(string file, string message) =>
        new ProjectDiagnostic(
            file, new ResolutionDiagnostic(CuboidyErrorCode.Missing, Severity.Error, message));

    // `[...new Set(xs)]` — dedup that PRESERVES ORDER, which is what fixes the
    // geometry list order and therefore what every ordered output contains
    // (hazard C1). `Enumerable.Distinct` documents its order as unspecified.
    private static List<string> Distinct(IEnumerable<string> values)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var output = new List<string>();
        foreach (string value in values)
        {
            if (seen.Add(value)) output.Add(value);
        }

        return output;
    }
}
