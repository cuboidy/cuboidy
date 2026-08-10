using System;
using System.IO;

namespace Cuboidy.Tests;

// Where the shared corpus lives. `fixtures/` and `models/` are the
// cross-implementation contract (docs/csharp-implementation.md, "Done means"),
// so the tests read the repository's own copies rather than a duplicate under
// csharp/ — a second copy is a second chance for the two implementations to be
// checked against different inputs.
internal static class TestPaths
{
    private static readonly Lazy<string> RepoRootLazy = new Lazy<string>(FindRepoRoot);

    public static string RepoRoot => RepoRootLazy.Value;

    public static string FixturesDir => Path.Combine(RepoRoot, "fixtures");

    public static string ModelsDir => Path.Combine(RepoRoot, "models");

    private static string FindRepoRoot()
    {
        // Walk up from the test assembly rather than hard-coding `../../..`,
        // which depends on the configuration and target framework in the
        // output path.
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "SPEC.md")) &&
                Directory.Exists(Path.Combine(dir.FullName, "fixtures")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new DirectoryNotFoundException(
            $"could not find the repository root above {AppContext.BaseDirectory} " +
            "(looking for a directory holding both SPEC.md and fixtures/)");
    }
}
