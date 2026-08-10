using System;
using System.Collections.Generic;
using System.Text;

namespace Cuboidy;

// A document path under construction: object keys and array indices from the
// root, which is what a `Result` failure carries and what `Locate` turns back
// into a line and column.
//
// TypeScript builds these by spreading (`[...at, 'voxels', y]`); this copies
// for the same reason, and paths are at most about five segments deep.
internal readonly struct DocPath
{
    private static readonly PathSegment[] Empty = new PathSegment[0];

    private readonly PathSegment[]? _segments;

    private DocPath(PathSegment[] segments)
    {
        _segments = segments;
    }

    public static DocPath Root => default;

    public IReadOnlyList<PathSegment> Segments => _segments ?? Empty;

    public int Count => _segments?.Length ?? 0;

    public DocPath Add(PathSegment segment)
    {
        PathSegment[] current = _segments ?? Empty;
        var next = new PathSegment[current.Length + 1];
        Array.Copy(current, next, current.Length);
        next[current.Length] = segment;
        return new DocPath(next);
    }

    public DocPath Add(PathSegment a, PathSegment b) => Add(a).Add(b);

    public DocPath Add(PathSegment a, PathSegment b, PathSegment c) => Add(a).Add(b).Add(c);

    // How the path reads at the head of a diagnostic message: `parts.2.size`,
    // or `<root>` when there is nothing to name.
    public string Label
    {
        get
        {
            PathSegment[] segments = _segments ?? Empty;
            if (segments.Length == 0) return "<root>";
            var sb = new StringBuilder();
            for (int i = 0; i < segments.Length; i++)
            {
                if (i > 0) sb.Append('.');
                sb.Append(segments[i].ToString());
            }

            return sb.ToString();
        }
    }

    public override string ToString() => Label;
}
