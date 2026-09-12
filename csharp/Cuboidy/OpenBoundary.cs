// Port of ts/packages/core/src/open-boundary.ts.
//
// SPEC §6.14 open boundaries: the planes of a package's (or a part's) bounds
// that another package is expected to sit against, so the faces lying ON them
// are seam faces and are not baked.
//
// WHY A PLANE AND NOT A LIST OF FACES. Naming individual faces would bind the
// declaration to the shape: every edit that adds, removes or moves a voxel on
// that side invalidates the list, silently. A plane is a statement about the
// package's OUTSIDE and survives reshaping.
//
// The test is exact, with no epsilon. A face is dropped only when all four of
// its corners have the declared axis coordinate EXACTLY equal to the plane, in
// package space. That is affordable — and is the same answer the reference
// gives, which is what makes the two implementations omit the same rectangles
// — because the extreme comes from `BoundsOf`, which places a box corner
// through the very same `RigTransform.LocalPointToWorld` a face corner goes
// through. Same arithmetic, same operands, same double. Write the bounds any
// other way (`RigTransform.PartsWorldBounds` inlines its own, and does not
// take scale) and the equality becomes a coincidence that holds until a model
// uses a rest scale.

using System;
using System.Collections.Generic;
using Cuboidy.Runtime;

// `Cuboidy`, not `Cuboidy.Runtime`: §6.14 is a field of the manifest, and the
// planes it resolves to are read by `Mesh` and by `CuboidyModel`, both of which
// see this namespace without a using because theirs is nested inside it. The
// rig math goes the other way, hence the using above.
namespace Cuboidy;

// The six planes a bounds has. Spelled `+x` … `-z` in the file (§6.14).
public enum BoundaryFace
{
    PlusX,
    MinusX,
    PlusY,
    MinusY,
    PlusZ,
    MinusZ,
}

// One resolved plane: which axis it is perpendicular to, which way the faces
// it drops point, and where it sits in package coordinates. `Face` is the
// declaration it came from, kept so a diagnostic can name what the author
// wrote rather than an axis index.
public readonly record struct OpenPlane(BoundaryFace Face, int Axis, bool Positive, double At);

// A part at rest: its shape, where the rig puts it, and its total §6.2 × §6.5
// scale — the three arguments `LocalPointToWorld` needs.
public readonly record struct RestPlacement(Part Part, Frame Transform, Vec3? Scale);

public static class OpenBoundary
{
    // The wire spellings, in `BoundaryFace` order.
    private static readonly string[] Wire = { "+x", "-x", "+y", "-y", "+z", "-z" };

    public static string ToWire(this BoundaryFace face) => Wire[(int)face];

    public static bool TryParseWire(string text, out BoundaryFace face)
    {
        for (int i = 0; i < Wire.Length; i++)
        {
            if (!string.Equals(Wire[i], text, StringComparison.Ordinal)) continue;
            face = (BoundaryFace)i;
            return true;
        }

        face = default;
        return false;
    }

    public static int AxisOf(BoundaryFace face) => (int)face / 2;

    public static bool IsPositive(BoundaryFace face) => (int)face % 2 == 0;

    // The package-space box of a set of parts at rest, over the eight corners
    // of each part's declared size.
    public static Bounds BoundsOf(IEnumerable<RestPlacement> placements)
    {
        if (placements is null) throw new ArgumentNullException(nameof(placements));

        double[] min = { double.PositiveInfinity, double.PositiveInfinity, double.PositiveInfinity };
        double[] max = { double.NegativeInfinity, double.NegativeInfinity, double.NegativeInfinity };
        foreach (RestPlacement placement in placements)
        {
            Part part = placement.Part;
            Vec3 piv = part.Pivot.Pos;
            foreach (int cx in new[] { 0, part.Size.W })
            {
                foreach (int cy in new[] { 0, part.Size.H })
                {
                    foreach (int cz in new[] { 0, part.Size.D })
                    {
                        Vec3 w = RigTransform.LocalPointToWorld(
                            new Vec3(cx, cy, cz), piv, placement.Scale, placement.Transform);
                        double[] c = { w.X, w.Y, w.Z };
                        for (int i = 0; i < 3; i++)
                        {
                            if (c[i] < min[i]) min[i] = c[i];
                            if (c[i] > max[i]) max[i] = c[i];
                        }
                    }
                }
            }
        }

        return new Bounds(new Vec3(min[0], min[1], min[2]), new Vec3(max[0], max[1], max[2]));
    }

    // Which planes apply to which part, in package coordinates, at rest.
    //
    // A manifest-level declaration is a plane of the WHOLE package's bounds and
    // therefore applies to every part — an interior part simply has no face on
    // it. A part-level declaration is a plane of that part's own bounds and
    // applies to that part alone. `placements` is keyed by the rig's name for
    // each part; a part the map does not hold (unresolved shape) takes part in
    // neither the bounds nor the result.
    public static Dictionary<string, IReadOnlyList<OpenPlane>> PlanesFor(
        Manifest manifest, IReadOnlyDictionary<string, RestPlacement> placements)
    {
        if (manifest is null) throw new ArgumentNullException(nameof(manifest));
        if (placements is null) throw new ArgumentNullException(nameof(placements));

        var out_ = new Dictionary<string, IReadOnlyList<OpenPlane>>(StringComparer.Ordinal);
        IReadOnlyList<OpenPlane> shared = manifest.OpenBoundaries is { } packageFaces
            ? PlanesFrom(packageFaces, BoundsOf(placements.Values))
            : Array.Empty<OpenPlane>();

        foreach (ManifestPart mp in manifest.Parts)
        {
            if (!placements.TryGetValue(mp.Name, out RestPlacement placement)) continue;
            IReadOnlyList<OpenPlane> own = mp.OpenBoundaries is { } partFaces
                ? PlanesFrom(partFaces, BoundsOf(new[] { placement }))
                : Array.Empty<OpenPlane>();
            if (shared.Count == 0 && own.Count == 0) continue;
            var planes = new List<OpenPlane>(shared.Count + own.Count);
            planes.AddRange(shared);
            planes.AddRange(own);
            out_[mp.Name] = planes;
        }

        return out_;
    }

    private static IReadOnlyList<OpenPlane> PlanesFrom(
        IReadOnlyList<BoundaryFace> faces, Bounds bounds)
    {
        var planes = new List<OpenPlane>(faces.Count);
        double[] min = { bounds.Min.X, bounds.Min.Y, bounds.Min.Z };
        double[] max = { bounds.Max.X, bounds.Max.Y, bounds.Max.Z };
        foreach (BoundaryFace face in faces)
        {
            int axis = AxisOf(face);
            bool positive = IsPositive(face);
            planes.Add(new OpenPlane(face, axis, positive, positive ? max[axis] : min[axis]));
        }

        return planes;
    }

    // Does this face lie on an open plane? `corners` (four of them, as 12
    // consecutive doubles) and `normal` are in PACKAGE space.
    //
    // Two conditions, both exact. The normal must point OUT through the plane —
    // only the outward face of a seam is the one a neighbour package covers; a
    // face pointing back into the package at the same coordinate is the inside
    // of a hollow and nothing else draws it. And all four corners must have the
    // plane's coordinate, which is coplanarity and parallelism in one test.
    public static bool FaceOnOpenPlane(
        IReadOnlyList<OpenPlane> planes, double[] corners, Vec3 normal)
    {
        double[] n = { normal.X, normal.Y, normal.Z };
        for (int p = 0; p < planes.Count; p++)
        {
            OpenPlane plane = planes[p];
            double toward = n[plane.Axis];
            if (plane.Positive ? !(toward > 0) : !(toward < 0)) continue;
            bool on = true;
            for (int c = 0; c < 4; c++)
            {
                if (corners[c * 3 + plane.Axis] == plane.At) continue;
                on = false;
                break;
            }

            if (on) return true;
        }

        return false;
    }
}
