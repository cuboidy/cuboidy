using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Cuboidy.Runtime;
using NUnit.Framework;

namespace Cuboidy.Tests;

// The facade is the one piece of this library with no reference implementation
// to check against, which is why the plan document says to write its test
// first. These pin the CONTRACT — that it composes the six documented calls in
// the required order, and that the two things easy to miss are handled here
// rather than left to the caller:
//
//   the part's OWN palette, not a merged one
//   part-local vertex data, with scale applied about the pivot, per part
//
// The last test proves the composition end to end: it rebuilds the acceptance
// contract's own mesh line for models/sword using ONLY facade calls, and
// compares it to what the reference printed.
[TestFixture]
public class CuboidyModelTests
{
    private static CuboidyModel Load(string model)
    {
        Result<CuboidyModel> r = CuboidyModel.Load(Path.Combine(TestPaths.ModelsDir, model));
        Assert.That(r.Ok, Is.True, () => $"{model}: {r.Message}");
        return r.Value;
    }

    [Test]
    public void EveryShippedModelLoadsThroughTheFacade()
    {
        foreach (string dir in Directory.GetDirectories(TestPaths.ModelsDir))
        {
            CuboidyModel model = Load(Path.GetFileName(dir));
            Assert.That(model.Resolved, Is.True, model.Name);
            Assert.That(model.Name, Is.EqualTo(model.Manifest.Name));
            Assert.That(model.Placements().Count, Is.EqualTo(model.Project.Parts.Count), model.Name);
        }
    }

    [Test]
    public void AnAbsentPackageFailsWithMissing()
    {
        Result<CuboidyModel> r = CuboidyModel.Load(
            Path.Combine(TestPaths.ModelsDir, "no-such-model"));

        Assert.That(r.Ok, Is.False);
        Assert.That(r.Code, Is.EqualTo(CuboidyErrorCode.Missing));
    }

    // ----- §6.3 clips, both forms, one map --------------------------------

    [Test]
    public void InlineAndExternalClipsLookTheSame()
    {
        CuboidyModel model = Load("submersible");

        Assert.That(model.Clips, Is.Not.Empty);
        foreach (KeyValuePair<string, InlineAnimation> clip in model.Clips)
        {
            Assert.That(clip.Value.Duration, Is.GreaterThan(0), clip.Key);
        }

        // Every §6.3 reference in the manifest is in the map under its CLIP
        // name, not its path.
        foreach (KeyValuePair<string, Animation> entry in model.Manifest.Animations)
        {
            Assert.That(model.Clips.ContainsKey(entry.Key), Is.True, entry.Key);
        }
    }

    [Test]
    public void AnUnknownClipNamesTheOnesTheModelHas()
    {
        CuboidyModel model = Load("sword");

        Assert.That(() => model.Pose("nope", 0), Throws.InstanceOf<KeyNotFoundException>());
        Assert.That(model.TryPose("nope", 0, out OrderedMap<Pose> poses), Is.False);
        Assert.That(poses, Is.Empty);
    }

    // ----- the rest pose IS no poses ---------------------------------------

    [Test]
    public void TheRestPoseIsTheSameCallWithNothingSampled()
    {
        // One implementation of the hierarchy math. If these ever diverge, a
        // still renderer and an animated one have started disagreeing about
        // §7.7 — which is the failure the reference's optional `poses`
        // parameter exists to prevent.
        CuboidyModel model = Load("fox");

        OrderedMap<Frame> implicitRest = model.WorldTransforms();
        OrderedMap<Frame> explicitRest = model.WorldTransforms(CuboidyModel.RestPose);

        Assert.That(implicitRest.Keys, Is.EqualTo(explicitRest.Keys));
        foreach (KeyValuePair<string, Frame> entry in implicitRest)
        {
            Assert.That(explicitRest[entry.Key], Is.EqualTo(entry.Value), entry.Key);
        }
    }

    [Test]
    public void AtRestEveryPartIsVisibleAndUnscaled()
    {
        foreach (Placement p in Load("windmill").Placements())
        {
            Assert.That(p.Visible, Is.True, p.Name);
            Assert.That(p.Scale, Is.EqualTo(new Vec3(1, 1, 1)), p.Name);
        }
    }

    // ----- the order the calls have to be made in --------------------------

    [Test]
    public void PlacementsFollowTheHierarchySoParentsComeFirst()
    {
        CuboidyModel model = Load("fox");
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var byName = model.Manifest.Parts.ToDictionary(p => p.Name, StringComparer.Ordinal);

        foreach (Placement p in model.Placements())
        {
            string? parent = byName[p.Name].Parent;
            if (parent is not null && byName.ContainsKey(parent))
            {
                Assert.That(seen.Contains(parent), Is.True, $"{p.Name} came before {parent}");
            }

            seen.Add(p.Name);
        }
    }

    [Test]
    public void PlacementsCarryThePivotTheMeshIsMeasuredFrom()
    {
        CuboidyModel model = Load("sword");

        foreach (Placement p in model.Placements())
        {
            Assert.That(p.Pivot, Is.EqualTo(model.Project.Parts[p.Name].Part.Pivot.Pos), p.Name);
        }

        // `guard` declares no pivot and is 11 wide — the §7.7 default lands on
        // a half voxel, which is hazard N1 arriving through the facade.
        Assert.That(model.Placements().Single(p => p.Name == "guard").Pivot,
            Is.EqualTo(new Vec3(5.5, 0, 2)));
    }

    [Test]
    public void AMeshUsesThePartsOwnPaletteAndNotAMergedOne()
    {
        // Every model, because most of them cannot see the difference:
        // `submersible`'s three geometry files all point at ONE shared palette,
        // so a concatenation of them still has the right colours at indices
        // 0..11 and the mesh comes out identical either way.
        //
        // `orrery` is the one that catches it. Its inline part takes the
        // manifest's palette (#3B2F2F, #8A6E4B, #C9A227) while its file parts
        // take `parts/palette.json` (#CCC, #8AF8, #1A1A1AFF) — different
        // colours, and one of them translucent, so a merge changes both the
        // pixels and the material list.
        foreach (string dir in Directory.GetDirectories(TestPaths.ModelsDir))
        {
            CuboidyModel model = Load(Path.GetFileName(dir));
            foreach (Placement p in model.Placements())
            {
                ResolvedPart resolved = model.Project.Parts[p.Name];
                MeshData viaFacade = model.BuildMesh(p.Name);
                MeshData direct = Mesh.BuildMesh(resolved.Part, resolved.Palette);

                Assert.That(viaFacade.Positions, Is.EqualTo(direct.Positions), $"{model.Name}/{p.Name}");
                Assert.That(viaFacade.Colors, Is.EqualTo(direct.Colors), $"{model.Name}/{p.Name}");
                Assert.That(viaFacade.Alphas, Is.EqualTo(direct.Alphas), $"{model.Name}/{p.Name}");
                Assert.That(viaFacade.Materials, Is.EqualTo(direct.Materials), $"{model.Name}/{p.Name}");
            }
        }
    }

    [Test]
    public void AMeshComesOutInPartLocalSpace()
    {
        // Scale and the world transform are the caller's, per part, because
        // scale does not propagate to children (§7.7). A facade that folded
        // them in would make a part of a rotated parent impossible to place.
        CuboidyModel model = Load("sword");
        MeshData mesh = model.BuildMesh("blade");
        Part part = model.Project.Parts["blade"].Part;

        for (int i = 0; i < mesh.Positions.Length; i += 3)
        {
            Assert.That(mesh.Positions[i], Is.InRange(0f, part.Size.W));
            Assert.That(mesh.Positions[i + 1], Is.InRange(0f, part.Size.H));
            Assert.That(mesh.Positions[i + 2], Is.InRange(0f, part.Size.D));
        }
    }

    [Test]
    public void AnUnresolvedPartHasNoMeshAndNoPlacement()
    {
        CuboidyPackage pkg = PackageLoader.LoadDirectory(
            Path.Combine(TestPaths.FixturesDir, "project", "missing", "part-in-no-file")).Value;
        CuboidyModel model = CuboidyModel.From(pkg);

        Assert.That(model.Resolved, Is.False);
        Assert.That(model.Placements().Select(p => p.Name), Is.EqualTo(new[] { "head" }));
        Assert.That(() => model.BuildMesh("tail"), Throws.InstanceOf<KeyNotFoundException>());
        Assert.That(model.TryBuildMesh("tail", out _), Is.False);
    }

    // ----- §6.12 sockets ----------------------------------------------------

    [Test]
    public void PublishedSocketsAgreeBetweenTheOneAndTheMany()
    {
        // The per-name entry point re-derives the whole rig chain; the map form
        // computes it once. They must not drift.
        foreach (string dir in Directory.GetDirectories(TestPaths.ModelsDir))
        {
            CuboidyModel model = Load(Path.GetFileName(dir));
            OrderedMap<Frame> all = model.SocketFrames();
            foreach (KeyValuePair<string, Frame> entry in all)
            {
                Assert.That(model.PublishedSocketFrame(entry.Key), Is.EqualTo(entry.Value),
                    $"{model.Name}/{entry.Key}");
            }
        }
    }

    [Test]
    public void ASocketOnAnAnimatedHostMovesWithIt()
    {
        CuboidyModel model = Load("knight");
        if (model.SocketFrames().Count == 0) Assert.Ignore("knight publishes no sockets");

        string clip = model.Clips.Keys.First();
        OrderedMap<Frame> rest = model.SocketFrames();
        OrderedMap<Frame> mid = model.SocketFrames(model.Pose(clip, model.Clips[clip].Duration / 3));

        Assert.That(mid.Keys, Is.EqualTo(rest.Keys));
        Assert.That(mid.Any(e => e.Value != rest[e.Key]), Is.True,
            "at least one published frame must move");
    }

    [Test]
    public void AnUnpublishedNameIsNullRatherThanAnError()
    {
        // §11.6's consumer-side `unknown`: the package is well-formed and the
        // name simply is not in its `sockets` object.
        Assert.That(Load("sword").PublishedSocketFrame("nope"), Is.Null);
    }

    // ----- the whole composition, end to end --------------------------------

    // `sword rest` is the plain case. The other three are clips that animate
    // §6.5 `scale`, which the rest pose cannot see at all: at rest every scale
    // is (1,1,1), so a facade that dropped scale entirely — or applied it in
    // world axes after the rotation instead of about the pivot before it —
    // reproduces the rest line exactly.
    [TestCase("sword", null, 0)]
    [TestCase("orrery", "turning", 7)]
    [TestCase("owl", "launch", 13)]
    [TestCase("windmill", "turning", 19)]
    public void TheFacadeReproducesTheAcceptanceContractsOwnMeshLine(string name, string? clip, int k)
    {
        // Rebuilds `mesh faces=N digest=X` using ONLY facade calls —
        // Placements, BuildMesh, Placement.ToWorld — and compares it to what
        // `cuboidy-query --mesh` printed. If the facade composed the six calls
        // in the wrong order, applied scale in the wrong frame, or handed
        // `BuildMesh` a merged palette, this line moves.
        CuboidyModel model = Load(name);
        string label = clip is null ? $"{name} rest" : $"{name} {clip} k={k}";
        OrderedMap<Pose> poses = clip is null
            ? CuboidyModel.RestPose
            : model.Pose(clip, (k * model.Clips[clip].Duration) / 24);

        string expected = File
            .ReadLines(Path.Combine(TestContext.CurrentContext.TestDirectory, "parity", "mesh.txt"))
            .SkipWhile(l => l.TrimEnd('\r') != $"## {label}")
            .Skip(1)
            .First()
            .TrimEnd('\r');

        var faces = new List<string>();
        foreach (Placement placement in model.Placements(poses))
        {
            if (!placement.Visible) continue;
            MeshData mesh = model.BuildMesh(placement.Name);
            int quads = mesh.Positions.Length / 12;
            int[] matOfQuad = QuadMaterials(mesh, quads);

            for (int f = 0; f < quads; f++)
            {
                var corners = new string[4];
                for (int c = 0; c < 4; c++)
                {
                    int at = (f * 4 + c) * 3;
                    Vec3 p = placement.ToWorld(new Vec3(
                        mesh.Positions[at], mesh.Positions[at + 1], mesh.Positions[at + 2]));
                    corners[c] = $"{ParityFormat.Num(p.X)},{ParityFormat.Num(p.Y)},{ParityFormat.Num(p.Z)}";
                }

                int n0 = f * 12;
                Vec3 n = RigTransform.QuatRotateVec3(placement.World.Quat,
                    new Vec3(mesh.Normals[n0], mesh.Normals[n0 + 1], mesh.Normals[n0 + 2]));
                MeshMaterial m = mesh.Materials[matOfQuad[f]];

                faces.Add(
                    $"face n={ParityFormat.Num(n.X)},{ParityFormat.Num(n.Y)},{ParityFormat.Num(n.Z)} " +
                    $"{string.Join(" ", Rotate(corners))} " +
                    $"rgb={Ch(mesh.Colors[n0])},{Ch(mesh.Colors[n0 + 1])},{Ch(mesh.Colors[n0 + 2])} " +
                    $"a={Ch(mesh.Alphas[f * 4])} " +
                    $"metallic={ParityFormat.Num(m.Metallic)} roughness={ParityFormat.Num(m.Roughness)} " +
                    $"emissive={ParityFormat.Num(m.Emissive)}");
            }
        }

        faces.Sort(StringComparer.Ordinal);
        Assert.That($"mesh faces={faces.Count} digest={Fnv1a(faces)}", Is.EqualTo(expected));

        static string Ch(float v) => ParityFormat.Num(Math.Round(v * 255.0) / 255);

        static string[] Rotate(string[] corners)
        {
            int at = 0;
            for (int i = 1; i < corners.Length; i++)
            {
                if (string.CompareOrdinal(corners[i], corners[at]) < 0) at = i;
            }

            return Enumerable.Range(0, corners.Length).Select(i => corners[(at + i) % corners.Length]).ToArray();
        }

        static int[] QuadMaterials(MeshData mesh, int quads)
        {
            var of = new int[quads];
            foreach (MeshGroup g in mesh.Groups)
            {
                for (int i = g.Start; i < g.Start + g.Count; i++) of[mesh.Indices[i] / 4] = g.Material;
            }

            return of;
        }

        static string Fnv1a(IReadOnlyList<string> lines)
        {
            uint h = 0x811c9dc5;
            foreach (string line in lines)
            {
                foreach (char c in line)
                {
                    h ^= c;
                    h = unchecked(h * 0x01000193);
                }

                h ^= 10;
                h = unchecked(h * 0x01000193);
            }

            return h.ToString("x8", System.Globalization.CultureInfo.InvariantCulture);
        }
    }

    [Test]
    public void WorldBoundsCoverEveryPlacedPart()
    {
        CuboidyModel model = Load("knight");
        Bounds bounds = model.WorldBounds();

        Assert.That(bounds.Min.X, Is.LessThan(bounds.Max.X));
        Assert.That(bounds.Min.Y, Is.LessThan(bounds.Max.Y));
        foreach (Placement p in model.Placements())
        {
            Assert.That(p.World.Pos.X, Is.InRange(bounds.Min.X, bounds.Max.X), p.Name);
            Assert.That(p.World.Pos.Y, Is.InRange(bounds.Min.Y, bounds.Max.Y), p.Name);
            Assert.That(p.World.Pos.Z, Is.InRange(bounds.Min.Z, bounds.Max.Z), p.Name);
        }
    }
}
