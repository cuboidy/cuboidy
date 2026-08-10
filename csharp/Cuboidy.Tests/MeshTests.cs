using System;
using System.Collections.Generic;
using System.Linq;
using Cuboidy.Runtime;
using NUnit.Framework;

namespace Cuboidy.Tests;

// The parity file covers the nine shipped models exhaustively. These pin the
// rules no VALID model can exercise, and the ones the models happen not to
// contain — starting with the §7.4 magenta fallback, which is LIVE in this
// library rather than defensive: the checks that refuse a short palette live in
// lint and the assembler, both dropped, so it is exactly what a caller gets for
// handing `BuildMesh` a part the reader never validated.
[TestFixture]
public class MeshTests
{
    private static Part PartOf(int w, int h, int d, params string[] rows)
    {
        // rows are given layer by layer, D rows per layer.
        var voxels = new List<IReadOnlyList<IReadOnlyList<int>>>();
        int at = 0;
        for (int y = 0; y < h; y++)
        {
            var layer = new List<IReadOnlyList<int>>();
            for (int z = 0; z < d; z++)
            {
                layer.Add(rows[at++].Select(c => VoxelRow.CharToIndex(c)!.Value).ToArray());
            }

            voxels.Add(layer);
        }

        return new Part("p", new Size(w, h, d), new Pivot(new Vec3(0, 0, 0), null),
            System.Array.Empty<Socket>(), voxels);
    }

    private static PaletteEntry Entry(byte r, byte g, byte b, byte a = 255, Material? material = null) =>
        new PaletteEntry(new Color(r, g, b, a), material ?? PaletteCodec.Matte);

    private static (float R, float G, float B, float A) FirstVertexColor(MeshData mesh) =>
        (mesh.Colors[0], mesh.Colors[1], mesh.Colors[2], mesh.Alphas[0]);

    // ----- §7.4: an index no palette defines --------------------------------

    [Test]
    public void AnIndexNoPaletteDefinesRendersAsOpaqueMagenta()
    {
        // Not defensive. §11.6 makes this an error, the check for it lives in
        // code this port drops, and a runtime that only draws still needs an
        // answer — so the answer is a defined conspicuous colour rather than a
        // crash or a skipped voxel. A port that indexed its palette and threw
        // would differ from the reference on exactly the input a lint-free
        // runtime is most likely to be handed.
        MeshData mesh = Mesh.BuildMesh(PartOf(1, 1, 1, "5"), new[] { Entry(0x10, 0x20, 0x30) });

        Assert.That(mesh.Positions.Length / 12, Is.EqualTo(6), "a lone voxel is six faces");
        Assert.That(FirstVertexColor(mesh), Is.EqualTo((1f, 0f, 1f, 1f)));
        // …and matte, since there is no entry to read a material from.
        Assert.That(mesh.Materials, Is.EqualTo(new[] { new MeshMaterial(PaletteCodec.Matte, false) }));
    }

    [Test]
    public void AnEmptyPaletteStillMeshes()
    {
        MeshData mesh = Mesh.BuildMesh(PartOf(1, 1, 1, "0"), System.Array.Empty<PaletteEntry>());

        Assert.That(FirstVertexColor(mesh), Is.EqualTo((1f, 0f, 1f, 1f)));
    }

    // ----- hazard N1: the channel divide ------------------------------------

    [Test]
    public void ColourChannelsAreDividedAsFloatsNotAsIntegers()
    {
        // `Color.R` is a byte. `R / 255` is integer division and makes every
        // channel below 255 exactly black — six faces of it, silently.
        MeshData mesh = Mesh.BuildMesh(PartOf(1, 1, 1, "0"), new[] { Entry(182, 128, 1) });

        Assert.That(mesh.Colors[0], Is.EqualTo(182f / 255f));
        Assert.That(mesh.Colors[1], Is.EqualTo(128f / 255f));
        Assert.That(mesh.Colors[2], Is.EqualTo(1f / 255f));
        Assert.That(mesh.Colors[2], Is.Not.EqualTo(0f));
    }

    [Test]
    public void AlphaComesFromThePaletteEntryAndIsConstantAcrossAFace()
    {
        MeshData mesh = Mesh.BuildMesh(PartOf(1, 1, 1, "0"), new[] { Entry(1, 2, 3, 0xB4) });

        Assert.That(mesh.Alphas.Distinct().ToArray(), Is.EqualTo(new[] { 0xB4 / 255f }));
        Assert.That(mesh.Materials[0].Translucent, Is.True);
        Assert.That(mesh.OpaqueIndexCount, Is.EqualTo(0), "nothing opaque to draw first");
    }

    // ----- §7.4 culling ------------------------------------------------------

    [Test]
    public void AnOpaqueNeighbourHidesTheFaceBetweenThem()
    {
        // Two voxels side by side: 12 faces minus the two they share.
        MeshData mesh = Mesh.BuildMesh(PartOf(2, 1, 1, "00"), new[] { Entry(1, 1, 1) });

        Assert.That(mesh.Positions.Length / 12, Is.EqualTo(10));
    }

    [Test]
    public void ATranslucentNeighbourDoesNotHideAnOpaqueFace()
    {
        // Or the wall behind a pane of glass loses the face you look at and the
        // glass opens onto a hole. Index 0 is opaque, index 1 is not.
        var palette = new[] { Entry(1, 1, 1), Entry(2, 2, 2, 0x80) };

        MeshData mesh = Mesh.BuildMesh(PartOf(2, 1, 1, "01"), palette);

        // The opaque voxel keeps all six; the translucent one loses none either,
        // since an opaque neighbour DOES hide its face — 6 + 5 = 11.
        Assert.That(mesh.Positions.Length / 12, Is.EqualTo(11));
    }

    [Test]
    public void ARunOfOneTranslucentColourIsOneSurfaceInTheDirectionYouLookThrough()
    {
        // "Same index on both sides means a run of one translucent colour is
        // one surface whatever its thickness — three voxels of water read
        // exactly as one does." Along X that means TWO faces, one at each end,
        // for a run of any length. The sides are four per voxel either way;
        // they are not what you look through.
        var palette = new[] { Entry(2, 2, 2, 0x80) };

        Assert.That(XFaces(Mesh.BuildMesh(PartOf(1, 1, 1, "0"), palette)), Is.EqualTo(2));
        Assert.That(XFaces(Mesh.BuildMesh(PartOf(3, 1, 1, "000"), palette)), Is.EqualTo(2));

        // The control: two DIFFERENT translucent colours in the run keep every
        // boundary, so the same three voxels give four.
        var two = new[] { Entry(2, 2, 2, 0x80), Entry(3, 3, 3, 0x80) };
        Assert.That(XFaces(Mesh.BuildMesh(PartOf(3, 1, 1, "010"), two)), Is.EqualTo(6));

        static int XFaces(MeshData mesh)
        {
            int faces = 0;
            for (int f = 0; f < mesh.Normals.Length / 12; f++)
            {
                if (Math.Abs(mesh.Normals[f * 12]) == 1f) faces++;
            }

            return faces;
        }
    }

    [Test]
    public void TwoDifferentTranslucentColoursBothKeepTheirFace()
    {
        // Two quads on one rectangle at one depth, pointing opposite ways.
        // Back-face culling leaves exactly one standing from any viewpoint —
        // the near one, the one whose colour you are looking through. Keeping
        // only one makes the boundary visible from one side and gone from the
        // other.
        var palette = new[] { Entry(1, 1, 1, 0x80), Entry(2, 2, 2, 0x80) };

        MeshData mesh = Mesh.BuildMesh(PartOf(2, 1, 1, "01"), palette);

        Assert.That(mesh.Positions.Length / 12, Is.EqualTo(12), "neither loses its face");
    }

    [Test]
    public void AFullyEnclosedVoxelEmitsNothingAndAdvertisesNoMaterial()
    {
        // Creating its bucket anyway advertised a material no visible triangle
        // uses: two materials for a model with one finish, which flipped the
        // renderer to a material array plus groups, compiled a shader nothing
        // drew with, and issued a zero-count draw call.
        var palette = new[]
        {
            Entry(1, 1, 1),
            Entry(2, 2, 2, 255, new Material(1, 0.2, 0.5)),
        };

        // 3×3×3 shell of index 0 with index 1 buried at the centre.
        var rows = new List<string>();
        for (int y = 0; y < 3; y++)
        {
            for (int z = 0; z < 3; z++)
            {
                rows.Add(y == 1 && z == 1 ? "010" : "000");
            }
        }

        MeshData mesh = Mesh.BuildMesh(PartOf(3, 3, 3, rows.ToArray()), palette);

        Assert.That(mesh.Materials.Count, Is.EqualTo(1));
        Assert.That(mesh.Materials[0], Is.EqualTo(new MeshMaterial(PaletteCodec.Matte, false)));
    }

    // ----- §7.4 material ordering -------------------------------------------

    [Test]
    public void TheMaterialListIsOrderedByValueAndNotByTheVoxelWalk()
    {
        // `MeshGroup.Material` is an index into this list, so two
        // implementations walking differently would hand the same face to
        // different materials while both emitting the right rectangles.
        // Walk order here is shiny, matte, translucent; value order is matte,
        // shiny, translucent.
        var palette = new[]
        {
            Entry(1, 1, 1, 255, new Material(1, 0.2, 0)),   // 0: shiny
            Entry(2, 2, 2, 255, PaletteCodec.Matte),        // 1: matte
            Entry(3, 3, 3, 0x80, PaletteCodec.Matte),       // 2: translucent
        };

        MeshData mesh = Mesh.BuildMesh(PartOf(3, 1, 3, "012", "...", "..."), palette);

        Assert.That(mesh.Materials.Select(m => (m.Metallic, m.Roughness, m.Translucent)), Is.EqualTo(new[]
        {
            (0.0, 1.0, false), // matte, opaque
            (1.0, 0.2, false), // shiny, opaque
            (0.0, 1.0, true),  // translucent last
        }));
    }

    [Test]
    public void OpaqueIndicesComeFirstAndTheSplitIsWhereTheyEnd()
    {
        var palette = new[] { Entry(1, 1, 1), Entry(2, 2, 2, 0x80) };

        MeshData mesh = Mesh.BuildMesh(PartOf(3, 1, 1, "0.1"), palette);

        Assert.That(mesh.OpaqueIndexCount, Is.GreaterThan(0));
        Assert.That(mesh.OpaqueIndexCount, Is.LessThan(mesh.Indices.Length));
        MeshGroup opaque = mesh.Groups[0];
        MeshGroup translucent = mesh.Groups[1];
        Assert.That(opaque.Start + opaque.Count, Is.EqualTo(mesh.OpaqueIndexCount));
        Assert.That(translucent.Start, Is.EqualTo(mesh.OpaqueIndexCount));
        Assert.That(mesh.Materials[translucent.Material].Translucent, Is.True);
    }

    [Test]
    public void CompareMaterialsReturnsASignAndNotADifference()
    {
        // Hazard N7. The three fields are 0..1, so a `Comparison<T>` returning
        // `a.Metallic - b.Metallic` truncates every real difference to 0: every
        // material compares equal, the sort is a no-op, and the list silently
        // falls back to walk order.
        var a = new MeshMaterial(0.1, 1, 0, false);
        var b = new MeshMaterial(0.9, 1, 0, false);

        Assert.That(Mesh.CompareMaterials(a, b), Is.EqualTo(-1));
        Assert.That(Mesh.CompareMaterials(b, a), Is.EqualTo(1));
        Assert.That((int)(a.Metallic - b.Metallic), Is.EqualTo(0), "the control");
    }

    [Test]
    public void TranslucentSortsLastWhateverItsMaterialSays()
    {
        var opaque = new MeshMaterial(1, 1, 1, false);
        var translucent = new MeshMaterial(0, 0, 0, true);

        Assert.That(Mesh.CompareMaterials(opaque, translucent), Is.EqualTo(-1));
        Assert.That(Mesh.CompareMaterials(translucent, opaque), Is.EqualTo(1));
    }

    [Test]
    public void ANaNFieldFallsThroughRatherThanReportingAMaterialGreaterThanItself()
    {
        var nan = new MeshMaterial(double.NaN, 1, 0, false);

        Assert.That(Mesh.CompareMaterials(nan, nan), Is.EqualTo(0));
        // And the buckets agree with the comparator: NaN groups with NaN,
        // because structural equality uses `EqualityComparer<double>` where
        // `==` would say they differ.
        Assert.That(nan, Is.EqualTo(new MeshMaterial(double.NaN, 1, 0, false)));
    }

    // ----- hazard A1: reading past the end -----------------------------------

    [Test]
    public void AVoxelOutsideThePartIsAirRatherThanARaise()
    {
        Part part = PartOf(1, 1, 1, "0");

        Assert.That(Mesh.VoxelAt(part, -1, 0, 0), Is.EqualTo(VoxelRow.Air));
        Assert.That(Mesh.VoxelAt(part, 0, 0, 5), Is.EqualTo(VoxelRow.Air));
        Assert.That(Mesh.VoxelAt(part, 0, 0, 0), Is.EqualTo(0));
    }

    [Test]
    public void ARaggedPartMeshesRatherThanRaising()
    {
        // "Shorter than it says" has to mean the same thing as "outside it
        // says", or two implementations disagree about a model neither should
        // have been given. `BuildMesh` is public and takes a caller-supplied
        // `Part`; a 2-wide part with a 1-wide row read `undefined` in the
        // reference, compared it against AIR, decided it was solid and painted
        // it magenta — 40 vertices where a single voxel is 24 — while the
        // literal C# raises on the same input.
        var ragged = new Part("p", new Size(2, 1, 1), new Pivot(new Vec3(0, 0, 0), null),
            System.Array.Empty<Socket>(),
            new[] { new[] { new[] { 0 } } });

        MeshData mesh = Mesh.BuildMesh(ragged, new[] { Entry(1, 1, 1) });

        Assert.That(mesh.Positions.Length / 12, Is.EqualTo(6), "the absent cell is AIR, not solid");
    }

    [Test]
    public void APartWithFewerLayersOrRowsThanItDeclaresMeshesToo()
    {
        // The other two levels of the same guard. `Size` says two layers of two
        // rows; the arrays hold one of each, and every level has to answer AIR
        // rather than index past its end.
        var shortLayers = new Part("p", new Size(1, 2, 1), new Pivot(new Vec3(0, 0, 0), null),
            System.Array.Empty<Socket>(),
            new[] { new[] { new[] { 0 } } });
        var shortRows = new Part("p", new Size(1, 1, 2), new Pivot(new Vec3(0, 0, 0), null),
            System.Array.Empty<Socket>(),
            new[] { new[] { new[] { 0 } } });

        Assert.That(Mesh.BuildMesh(shortLayers, new[] { Entry(1, 1, 1) }).Positions.Length / 12,
            Is.EqualTo(6));
        Assert.That(Mesh.BuildMesh(shortRows, new[] { Entry(1, 1, 1) }).Positions.Length / 12,
            Is.EqualTo(6));
        Assert.That(Mesh.VoxelAt(shortLayers, 0, 1, 0), Is.EqualTo(VoxelRow.Air));
        Assert.That(Mesh.VoxelAt(shortRows, 0, 0, 1), Is.EqualTo(VoxelRow.Air));
    }

    // ----- buffers ------------------------------------------------------------

    [Test]
    public void EveryBufferHasFourVerticesPerFaceAndSixIndices()
    {
        MeshData mesh = Mesh.BuildMesh(PartOf(1, 1, 1, "0"), new[] { Entry(1, 1, 1) });

        int faces = mesh.Positions.Length / 12;
        Assert.That(faces, Is.EqualTo(6));
        Assert.That(mesh.Normals.Length, Is.EqualTo(mesh.Positions.Length));
        Assert.That(mesh.Colors.Length, Is.EqualTo(mesh.Positions.Length));
        Assert.That(mesh.Alphas.Length, Is.EqualTo(faces * 4));
        Assert.That(mesh.Indices.Length, Is.EqualTo(faces * 6));
        Assert.That(mesh.Use32BitIndices, Is.False);
        Assert.That(mesh.Groups.Sum(g => g.Count), Is.EqualTo(mesh.Indices.Length),
            "groups cover the whole buffer");
    }

    [Test]
    public void AnEmptyPartIsAnEmptyMesh()
    {
        MeshData mesh = Mesh.BuildMesh(PartOf(1, 1, 1, "."), new[] { Entry(1, 1, 1) });

        Assert.That(mesh.Positions, Is.Empty);
        Assert.That(mesh.Materials, Is.Empty);
        Assert.That(mesh.Groups, Is.Empty);
        Assert.That(mesh.OpaqueIndexCount, Is.EqualTo(0));
    }

    [Test]
    public void TheMeshComesOutInPartLocalSpace()
    {
        // `scale` and the world transform are the CALLER's, per part, because
        // scale does not propagate to children (§7.7).
        var part = new Part("p", new Size(1, 1, 1), new Pivot(new Vec3(0.5, 0, 0.5), null),
            System.Array.Empty<Socket>(), new[] { new[] { new[] { 0 } } });

        MeshData mesh = Mesh.BuildMesh(part, new[] { Entry(1, 1, 1) });

        // Corner coordinates are 0 or 1 — the pivot has not been subtracted.
        Assert.That(mesh.Positions.All(p => p is 0f or 1f), Is.True);
    }
}
