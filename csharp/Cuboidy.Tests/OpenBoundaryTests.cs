using System;
using System.Collections.Generic;
using System.Linq;
using Cuboidy.Runtime;
using NUnit.Framework;

namespace Cuboidy.Tests;

// SPEC §6.14, the same cases `ts/packages/core/test/open-boundary.test.ts`
// pins, because "the two implementations omit the same faces" is the whole
// contract: Tropalm bakes a block through `CuboidyModel.BuildMesh` and looks at
// it through `cuboidy-snap`, and a seam that is closed in one and open in the
// other is worse than a seam that is open in both.
[TestFixture]
public class OpenBoundaryTests
{
    // A 2-wide, 3-deep slab with the middle Z layer knocked out. The hole makes
    // the interesting case reachable: the voxels at z=0 have an EXPOSED +z face
    // at z=1, a `+z` face that is NOT on the boundary and must survive.
    private static Part Slab() =>
        new Part(
            "slab",
            new Size(2, 1, 3),
            new Pivot(new Vec3(0, 0, 0), null),
            Array.Empty<Socket>(),
            new[]
            {
                new IReadOnlyList<int>[] { new[] { 0, 0 }, new[] { -1, -1 }, new[] { 0, 0 } },
            });

    private static readonly PaletteEntry[] Palette =
        { new PaletteEntry(new Color(255, 0, 0, 255), PaletteCodec.Matte) };

    private static readonly Frame AtOrigin = new Frame(new Vec3(0, 0, 0), Quat.Identity);

    private static readonly OpenPlane PlusZAt3 = new OpenPlane(BoundaryFace.PlusZ, 2, true, 3);

    private sealed record Quad(Vec3 Normal, IReadOnlyList<Vec3> Corners);

    private static List<Quad> QuadsOf(MeshData mesh)
    {
        var quads = new List<Quad>();
        for (int q = 0; q * 12 < mesh.Positions.Length; q++)
        {
            var corners = new List<Vec3>();
            for (int c = 0; c < 4; c++)
            {
                int at = (q * 12) + (c * 3);
                corners.Add(new Vec3(mesh.Positions[at], mesh.Positions[at + 1], mesh.Positions[at + 2]));
            }

            quads.Add(new Quad(
                new Vec3(mesh.Normals[q * 12], mesh.Normals[(q * 12) + 1], mesh.Normals[(q * 12) + 2]),
                corners));
        }

        return quads;
    }

    private static List<Quad> Facing(IEnumerable<Quad> quads, double nx, double ny, double nz) =>
        quads.Where(q => q.Normal == new Vec3(nx, ny, nz)).ToList();

    private static OpenBoundaryCull Cull(params OpenPlane[] planes) =>
        new OpenBoundaryCull(planes, AtOrigin, null);

    [Test]
    public void OmitsThePlusZFacesOnThePlaneAndKeepsTheInteriorOne()
    {
        List<Quad> closed = QuadsOf(Mesh.BuildMesh(Slab(), Palette));
        List<Quad> open = QuadsOf(Mesh.BuildMesh(Slab(), Palette, Cull(PlusZAt3)));

        Assert.That(closed, Has.Count.EqualTo(20));
        Assert.That(open, Has.Count.EqualTo(18), "two voxels lose their +z face");

        List<Quad> plusZ = Facing(open, 0, 0, 1);
        Assert.That(plusZ, Has.Count.EqualTo(2));
        // The survivors are the INTERIOR +z faces, at the hole (z = 1), not the
        // ones that were on the boundary plane (z = 3).
        foreach (Quad q in plusZ)
        {
            Assert.That(q.Corners.Select(c => c.Z), Is.All.EqualTo(1.0));
        }

        Assert.That(Facing(closed, 0, 0, 1), Has.Count.EqualTo(4));
    }

    [Test]
    public void LeavesEveryOtherPlaneIntact()
    {
        List<Quad> closed = QuadsOf(Mesh.BuildMesh(Slab(), Palette));
        List<Quad> open = QuadsOf(Mesh.BuildMesh(Slab(), Palette, Cull(PlusZAt3)));

        foreach ((double x, double y, double z) in new[]
                 {
                     (-1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, -1.0, 0.0),
                     (0.0, 0.0, -1.0),
                 })
        {
            Assert.That(
                Facing(open, x, y, z), Has.Count.EqualTo(Facing(closed, x, y, z).Count),
                $"faces of normal ({x}, {y}, {z})");
        }

        // The four −z faces sit at z = 0 and z = 2 and are untouched: the
        // declaration names one plane, not an axis.
        Assert.That(Facing(open, 0, 0, -1), Has.Count.EqualTo(4));
    }

    [Test]
    public void KeepsTheFacesOfAPartThatDoesNotReachThePlane()
    {
        // The same slab with the plane one voxel beyond it. Nothing lies on it,
        // so nothing is dropped — the test is equality, not proximity.
        MeshData open = Mesh.BuildMesh(
            Slab(), Palette, Cull(new OpenPlane(BoundaryFace.PlusZ, 2, true, 4)));
        Assert.That(QuadsOf(open), Has.Count.EqualTo(20));
    }

    [Test]
    public void KeepsAMinusZFaceThatLiesOnAPlusZPlane()
    {
        // A face ON the plane but pointing back into the package is the inside
        // of a hollow, not a seam: the neighbouring package never covers it.
        List<Quad> open = QuadsOf(Mesh.BuildMesh(
            Slab(), Palette, Cull(new OpenPlane(BoundaryFace.MinusZ, 2, false, 0))));
        Assert.That(Facing(open, 0, 0, -1), Has.Count.EqualTo(2), "the pair at z = 2 survives");
        Assert.That(Facing(open, 0, 0, 1), Has.Count.EqualTo(4), "+z untouched");
    }

    // ----- the declaration, end to end through CuboidyModel ------------------

    // The same slab twice, all inline: `head` at the origin and `foot` behind
    // it, so the package's +z bound is `head`'s and `foot` is interior to it.
    private static string TwoPart(string packageExtra = "", string footExtra = "") =>
        $$"""
        {
          "name": "bed",
          "palette": ["#FF0000"],
          {{packageExtra}}
          "parts": [
            {
              "name": "head",
              "geometry": {
                "size": [2, 1, 3],
                "pivot": { "pos": [0, 0, 0] },
                "voxels": [["00", "..", "00"]]
              }
            },
            {
              "name": "foot",
              "position": [0, 0, -3],
              {{footExtra}}
              "geometry": {
                "size": [2, 1, 3],
                "pivot": { "pos": [0, 0, 0] },
                "voxels": [["00", "..", "00"]]
              }
            }
          ]
        }
        """;

    private static CuboidyModel ModelOf(string manifestText)
    {
        Result<Manifest> manifest = ManifestReader.ParseManifestText(manifestText);
        Assert.That(manifest.Ok, Is.True, manifest.Message);
        var files = new Dictionary<string, string>(StringComparer.Ordinal);
        ResolvedProject project = Project.ResolveProject(manifest.Value, files);
        Assert.That(project.Resolved, Is.True);
        return CuboidyModel.From(new CuboidyPackage(".", manifest.Value, project, files));
    }

    [Test]
    public void AManifestLevelDeclarationOpensThePackageBoundForEveryPart()
    {
        CuboidyModel model = ModelOf(TwoPart("\"openBoundaries\": [\"+z\"],"));

        // `head` reaches z = 3, the package bound, and loses its two +z faces.
        Assert.That(QuadsOf(model.BuildMesh("head")), Has.Count.EqualTo(18));
        // `foot` carries the same plane and simply has no face on it — which is
        // what makes a package-level declaration one statement rather than a
        // list of faces.
        Assert.That(QuadsOf(model.BuildMesh("foot")), Has.Count.EqualTo(20));
    }

    [Test]
    public void APartLevelDeclarationOpensThatPartsOwnBound()
    {
        CuboidyModel model = ModelOf(TwoPart(footExtra: "\"openBoundaries\": [\"-z\"],"));

        Assert.That(QuadsOf(model.BuildMesh("head")), Has.Count.EqualTo(20));
        // `foot` spans z ∈ [−3, 0]; its own −z bound is −3, not the package's.
        Assert.That(QuadsOf(model.BuildMesh("foot")), Has.Count.EqualTo(18));
    }

    [Test]
    public void APackageThatDeclaresNothingKeepsEveryFace()
    {
        CuboidyModel model = ModelOf(TwoPart());
        Assert.That(QuadsOf(model.BuildMesh("head")), Has.Count.EqualTo(20));
        Assert.That(QuadsOf(model.BuildMesh("foot")), Has.Count.EqualTo(20));
    }

    [Test]
    public void ADeclarationRoundTripsThroughTheReader()
    {
        Result<Manifest> manifest = ManifestReader.ParseManifestText(
            TwoPart("\"openBoundaries\": [\"+z\", \"-x\"],", "\"openBoundaries\": [\"-z\"],"));
        Assert.That(manifest.Ok, Is.True, manifest.Message);
        Assert.That(
            manifest.Value.OpenBoundaries,
            Is.EqualTo(new[] { BoundaryFace.PlusZ, BoundaryFace.MinusX }));
        Assert.That(manifest.Value.Parts[0].OpenBoundaries, Is.Null);
        Assert.That(
            manifest.Value.Parts[1].OpenBoundaries,
            Is.EqualTo(new[] { BoundaryFace.MinusZ }));
    }
}
