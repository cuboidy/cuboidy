// NEW SURFACE, not a port.
//
// `ResolveProject` takes a map of file texts and never touches IO — which is
// exactly why a C# loader can reuse the decomposition, and also why nothing in
// the ported set fills that map. The reference fills it in `cli/assemble.ts`
// and again in `cli/lint-runner.ts`, both of which are dropped; the SEQUENCE is
// the contract, not that code.
//
// It is a TWO-ROUND walk, because §7.4 palette references live INSIDE geometry
// files and are not visible until those have been read and parsed:
//
//   1  read <dir>/cuboidy.json                 — absent is `missing` (§11.5)
//   2  ParseManifestText                       — stop here if it fails
//   3  ProjectFilePaths(manifest)              — §6.9 geometry + §6.3 animation
//                                                refs, already §8-normalised
//   4  read all of those into the map
//   5  ResolveGeometries(manifest, files)      — parse round one
//   6  PalettePathsOf(those geometries)        — §7.4 refs, now visible
//   7  read any of those not already in the map
//   8  ResolveProject(manifest, files)         — the real call
//
// Step 5 is a throwaway parse whose only purpose is to discover step 6, and a
// package is a handful of small files, so parsing twice is cheaper than
// threading a callback through the resolver.
//
// SPEC §13 packed `.cuboidy` archives are NOT handled here. §13 carries
// MUST-level reader rules — strip a single top-level wrapper directory, reject
// an absolute, backslashed or `..`-containing entry path as `invalid-value`,
// `duplicate` for paths that normalise alike — and the reference implements
// none of them outside the editor. An archive reader belongs above this class,
// over the consuming framework's own ZIP support, with §13's path rules taken
// from the spec rather than from TypeScript.

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Cuboidy;

public sealed record CuboidyPackage(
    // The directory the package was read from, as given.
    string Directory,
    Manifest Manifest,
    ResolvedProject Project,
    // Every package-relative path that was READ, with its text — the same map
    // `ResolveProject` was handed. Kept so a caller can re-resolve without
    // touching the disk again.
    IReadOnlyDictionary<string, string> Files);

public static class PackageLoader
{
    // Reads a package off disk and resolves it.
    //
    // The failure here is only about the MANIFEST — absent, not JSON, or not a
    // valid §6 document. Everything a manifest references that could not be
    // read comes back as a diagnostic on `Project` instead of as a failure,
    // because a package with one unreadable geometry file still has a manifest,
    // a part list and every other file, and a caller deciding what to do about
    // it needs all of them. Check `Project.Resolved` before drawing.
    public static Result<CuboidyPackage> LoadDirectory(string directory)
    {
        if (directory is null) throw new ArgumentNullException(nameof(directory));

        string manifestPath = Combine(directory, Project.ManifestFile);
        Result<string> manifestText = ReadPackageFile(manifestPath);
        if (!manifestText.Ok) return manifestText.ToError<CuboidyPackage>();

        Result<Manifest> parsed = ManifestReader.ParseManifestText(manifestText.Value);
        if (!parsed.Ok)
        {
            return Result.Err<CuboidyPackage>(
                parsed.Code, $"{manifestPath}: {parsed.Message}", parsed.Path);
        }

        Manifest manifest = parsed.Value;
        var files = new Dictionary<string, string>(StringComparer.Ordinal);

        // Round one: everything the manifest names directly.
        ProjectPaths paths = Project.ProjectFilePaths(manifest);
        foreach (string reference in paths.Geometry) Stage(directory, reference, files);
        foreach (string reference in paths.Animations) Stage(directory, reference, files);

        // Round two: the §7.4 palette references, which only became visible
        // once the geometry files above were parsed.
        GeometryStage staged = Project.ResolveGeometries(manifest, files);
        foreach (string reference in Project.PalettePathsOf(staged.Geometries))
        {
            Stage(directory, reference, files);
        }

        return Result.Ok(new CuboidyPackage(
            directory, manifest, Project.ResolveProject(manifest, files), files));
    }

    // Reads one package file into the map, or leaves it out. An unreadable
    // reference is NOT reported here: `ResolveProject` already reports an
    // absent map entry as `missing` against the package-relative path, which
    // is the path the author wrote, and duplicating it would say the same
    // thing twice in two vocabularies.
    private static void Stage(
        string directory,
        string reference,
        Dictionary<string, string> files)
    {
        if (files.ContainsKey(reference)) return;
        Result<string> text = ReadPackageFile(Combine(directory, reference));
        if (text.Ok) files[reference] = text.Value;
    }

    // UTF-8, and the BOM is NOT stripped — hazard S2, and the whole reason
    // this is not `File.ReadAllText`.
    //
    // SPEC §9 forbids a BOM. The reference enforces it only by `JSON.parse`
    // throwing on the U+FEFF it finds at the head of the text, so leaving the
    // character in the string is what makes the two implementations agree:
    // the failure then arrives from the JSON parser, with the same code and
    // against the same file. `File.ReadAllText` detects and removes it, and
    // would silently accept what the reference rejects.
    //
    // Decoding is lossy for the same reason: Node's `readFile(path, 'utf8')`
    // replaces an invalid byte with U+FFFD rather than failing, so a corrupt
    // file reaches the JSON parser in both.
    internal static Result<string> ReadPackageFile(string absolutePath)
    {
        byte[] bytes;
        try
        {
            bytes = File.ReadAllBytes(absolutePath);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException
                                      or NotSupportedException or ArgumentException)
        {
            return Result.Err<string>(CuboidyErrorCode.Missing, $"cannot read {absolutePath}");
        }

        return Result.Ok(new UTF8Encoding(false, false).GetString(bytes));
    }

    // A package-relative §8 path is forward-slashed and has no drive letter;
    // the platform separator is a fact about this machine, not about the
    // package. `Path.Combine` is enough on Windows, which accepts both, but
    // spelling it keeps the map key and the disk path visibly different things.
    //
    // A leading `..` is preserved by `NormalizeRefPath` and reaches here, which
    // means a package CAN name a file beside it. That is what §8 permits and
    // what the reference does; §13's prohibition is about archive entries, and
    // an archive reader is where it belongs.
    private static string Combine(string directory, string reference) =>
        Path.Combine(directory, reference.Replace('/', Path.DirectorySeparatorChar));
}
