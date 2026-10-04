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

    // ----- posing every frame -------------------------------------------------

    // The kept forms — `TryPose(clip, time, into)` and `Placements(poses, into,
    // sockets)` — against the forms that build their answer new, over every
    // shipped model, every clip and the 27 parity sample times, with ONE set of
    // kept storage carried across all of them: a list grown on `windmill` and
    // handed to `sword`, a socket list `knight` filled and `fox` publishes
    // nothing into. Compared bit for bit, not within a tolerance — the kept
    // forms are the same arithmetic, so there is nothing for a tolerance to
    // absorb, and what they could get wrong (a stale entry, a frame composed
    // under the wrong parent, a socket found on the wrong part) is exactly the
    // kind of thing a tolerance might hide.
    //
    // The placements oracle is assembled here from `WorldTransforms`, which is
    // `RigTransform.ComputeWorldTransforms` — the function the parity sweep
    // checks against the reference — and the sockets oracle is `SocketFrames`,
    // which is `SocketFrame.PublishedSocketFrames`; neither goes through the
    // plan the kept forms keep.
    //
    // Two models beside the shipped ones, for what none of those has: a part
    // that did not resolve (the `project/` fixture), and a socket on a part
    // with a §6.2 rest scale, published next to a name its part does not
    // declare (`ScaledHost` below). Without the second, a kept socket that
    // dropped the host's rest scale passed everything.
    [Test]
    public void TheKeptFormsGiveTheNumbersTheNewOnesDoBitForBit()
    {
        var keptPoses = new Dictionary<string, Pose>(StringComparer.Ordinal);
        var keptPlacements = new List<Placement>();
        var keptSockets = new List<KeyValuePair<string, Frame>>();
        int compared = 0;

        var models = Directory.GetDirectories(TestPaths.ModelsDir)
            .OrderByDescending(d => d, StringComparer.Ordinal)
            .Select(d => Load(Path.GetFileName(d)))
            .ToList();
        models.Add(CuboidyModel.From(PackageLoader.LoadDirectory(
            Path.Combine(TestPaths.FixturesDir, "project", "missing", "part-in-no-file")).Value));
        models.Add(ScaledHost());

        foreach (CuboidyModel model in models)
        {
            var samples = new List<(string? Clip, double Time)> { (null, 0) };
            foreach (KeyValuePair<string, InlineAnimation> clip in model.Clips)
            {
                for (int k = -1; k <= 25; k++) samples.Add((clip.Key, (k * clip.Value.Duration) / 24));
            }

            foreach ((string? clip, double time) in samples)
            {
                string at = $"{model.Name} {clip ?? "rest"} t={time:R}";
                OrderedMap<Pose> fresh = CuboidyModel.RestPose;
                IReadOnlyDictionary<string, Pose>? kept = null;
                if (clip is not null)
                {
                    fresh = model.Pose(clip, time);
                    Assert.That(model.TryPose(clip, time, keptPoses), Is.True, at);
                    Assert.That(keptPoses.Keys.OrderBy(n => n, StringComparer.Ordinal),
                        Is.EqualTo(fresh.Keys.OrderBy(n => n, StringComparer.Ordinal)), at);
                    foreach (KeyValuePair<string, Pose> entry in fresh)
                    {
                        AssertSame(keptPoses[entry.Key], entry.Value, $"{at} pose {entry.Key}");
                    }

                    kept = keptPoses;
                }

                model.Placements(kept, keptPlacements, keptSockets);

                var expected = new List<Placement>();
                foreach (KeyValuePair<string, Frame> entry in model.WorldTransforms(fresh))
                {
                    if (!model.Project.Parts.TryGetValue(entry.Key, out ResolvedPart? resolved)) continue;
                    Pose p = fresh.TryGetValue(entry.Key, out Pose pose) ? pose : Pose.Default;
                    Vec3? rest = model.Manifest.Parts.Last(mp => mp.Name == entry.Key).Scale;
                    expected.Add(new Placement(
                        entry.Key, entry.Value, resolved.Part.Pivot.Pos,
                        RigTransform.ComposeScale(rest, p.Scale) ?? new Vec3(1, 1, 1), p.Visible));
                }

                Assert.That(keptPlacements.Select(p => p.Name), Is.EqualTo(expected.Select(p => p.Name)), at);
                for (int i = 0; i < expected.Count; i++)
                {
                    AssertSame(keptPlacements[i], expected[i], $"{at} placement {expected[i].Name}");
                    compared++;
                }

                OrderedMap<Frame> sockets = model.SocketFrames(fresh);
                Assert.That(keptSockets.Select(s => s.Key), Is.EqualTo(sockets.Keys), at);
                for (int i = 0; i < sockets.Count; i++)
                {
                    AssertSame(keptSockets[i].Value, sockets[i].Value, $"{at} socket {sockets[i].Key}");
                    compared++;
                }
            }
        }

        TestContext.Out.WriteLine($"{compared} placements and socket frames, bit for bit");
    }

    // An arm with a §6.2 rest scale and a turn, hung off a body, holding a
    // socket away from its pivot so the scale moves it; a clip that turns the
    // arm and scales it again, so the socket rides both terms; and a second
    // published name the arm declares no socket for, which both forms leave
    // out.
    private static CuboidyModel ScaledHost()
    {
        const string text = """
            {
              "version": "0.9",
              "name": "scaled-host",
              "palette": ["#C9A227"],
              "parts": [
                {
                  "name": "body",
                  "geometry": { "size": [2, 2, 2], "voxels": [["00", "00"], ["00", "00"]] }
                },
                {
                  "name": "arm",
                  "parent": "body",
                  "position": [1, 2, 0],
                  "rotation": [0, 0, 30],
                  "scale": [2, 3, 0.5],
                  "geometry": {
                    "size": [1, 4, 1],
                    "pivot": { "pos": [0.5, 0, 0.5] },
                    "sockets": [{ "name": "grip", "pos": [0.5, 4, 0.5], "rot": [-90, 0, 0] }],
                    "voxels": [["0"], ["0"], ["0"], ["0"]]
                  }
                }
              ],
              "sockets": {
                "hand": { "part": "arm", "socket": "grip" },
                "nowhere": { "part": "arm", "socket": "absent" }
              },
              "animations": {
                "swing": {
                  "duration": 1,
                  "loop": true,
                  "parts": {
                    "arm": {
                      "0.0": { "rot": [0, 0, 0], "scale": [1, 1, 1] },
                      "0.5": { "rot": [40, 0, 0], "scale": [1.5, 1, 1] }
                    }
                  }
                }
              }
            }
            """;
        Result<Manifest> manifest = ManifestReader.ParseManifestText(text);
        Assert.That(manifest.Ok, Is.True, manifest.Message);
        var files = new Dictionary<string, string>(StringComparer.Ordinal);
        ResolvedProject project = Project.ResolveProject(manifest.Value, files);
        Assert.That(project.Resolved, Is.True);
        CuboidyModel model = CuboidyModel.From(new CuboidyPackage(".", manifest.Value, project, files));
        Assert.That(model.SocketFrames().Keys, Is.EqualTo(new[] { "hand" }));
        return model;
    }

    // The point of the kept forms: a model posed before is posed again with
    // nothing allocated, sampled and placed, sockets included. Counted on this
    // thread around a loop of poses that alternates two instants and ends on
    // the first, and then checked against what the first pose gave, so the
    // loop cannot pass by writing nothing.
    //
    // Measured on the library before these forms existed (Debug, net8.0, the
    // same counter, bytes per pose: `TryPose(clip, time, out poses)` and a walk
    // over its keys, then `Placements(poses)` and, where the model publishes
    // any, `SocketFrames(poses)`): `sword` at rest 0 + 7,136, `orrery`
    // 5,176 + 14,736, `knight` 43,472 + 68,584, `windmill` 23,488 + 39,096.
    [TestCase("sword", null)]
    [TestCase("orrery", "turning")]
    [TestCase("knight", "walk")]
    [TestCase("windmill", "turning")]
    public void PosingAModelPosedBeforeAllocatesNothing(string name, string? clip)
    {
        const int Poses = 1000;
        CuboidyModel model = Load(name);
        double first = clip is null ? 0 : model.Clips[clip].Duration / 3;
        double second = clip is null ? 0 : model.Clips[clip].Duration * 0.7;

        var poses = new Dictionary<string, Pose>(StringComparer.Ordinal);
        var placements = new List<Placement>();
        var sockets = new List<KeyValuePair<string, Frame>>();

        void PoseAt(double time)
        {
            IReadOnlyDictionary<string, Pose>? sampled = null;
            if (clip is not null && model.TryPose(clip, time, poses)) sampled = poses;
            model.Placements(sampled, placements, sockets);
        }

        PoseAt(first);
        Placement[] once = placements.ToArray();
        KeyValuePair<string, Frame>[] onceSockets = sockets.ToArray();
        for (int i = 0; i < 50; i++) PoseAt(i % 2 == 0 ? second : first);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i <= Poses; i++) PoseAt(i % 2 == 0 ? first : second);
        PoseAt(first);
        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        TestContext.Out.WriteLine(
            $"{name}: {allocated} bytes over {Poses + 2} poses of {placements.Count} parts " +
            $"and {sockets.Count} sockets");
        Assert.That(allocated, Is.EqualTo(0));

        Assert.That(placements.Count, Is.EqualTo(once.Length));
        for (int i = 0; i < once.Length; i++) AssertSame(placements[i], once[i], once[i].Name);
        Assert.That(sockets.Count, Is.EqualTo(onceSockets.Length));
        for (int i = 0; i < onceSockets.Length; i++)
        {
            Assert.That(sockets[i].Key, Is.EqualTo(onceSockets[i].Key));
            AssertSame(sockets[i].Value, onceSockets[i].Value, onceSockets[i].Key);
        }

        // And what the first pose gave is what the forms that build anew give.
        OrderedMap<Pose> fresh = clip is null ? CuboidyModel.RestPose : model.Pose(clip, first);
        IReadOnlyList<Placement> anew = model.Placements(fresh);
        for (int i = 0; i < once.Length; i++) AssertSame(once[i], anew[i], once[i].Name);
    }

    // Bit for bit: `double.Equals` holds -0 equal to 0, and a record's equality
    // is built from it.
    private static void AssertSame(double actual, double expected, string what)
    {
        if (BitConverter.DoubleToInt64Bits(actual) != BitConverter.DoubleToInt64Bits(expected))
        {
            Assert.Fail($"{what}: {actual:R} is not {expected:R}, bit for bit");
        }
    }

    private static void AssertSame(Vec3 actual, Vec3 expected, string what)
    {
        AssertSame(actual.X, expected.X, what + ".x");
        AssertSame(actual.Y, expected.Y, what + ".y");
        AssertSame(actual.Z, expected.Z, what + ".z");
    }

    private static void AssertSame(Frame actual, Frame expected, string what)
    {
        AssertSame(actual.Pos, expected.Pos, what + " pos");
        AssertSame(actual.Quat.X, expected.Quat.X, what + " quat.x");
        AssertSame(actual.Quat.Y, expected.Quat.Y, what + " quat.y");
        AssertSame(actual.Quat.Z, expected.Quat.Z, what + " quat.z");
        AssertSame(actual.Quat.W, expected.Quat.W, what + " quat.w");
    }

    private static void AssertSame(Pose actual, Pose expected, string what)
    {
        AssertSame(actual.Rot, expected.Rot, what + " rot");
        AssertSame(actual.Pos, expected.Pos, what + " pos");
        AssertSame(actual.Scale, expected.Scale, what + " scale");
        Assert.That(actual.Visible, Is.EqualTo(expected.Visible), what + " visible");
    }

    private static void AssertSame(Placement actual, Placement expected, string what)
    {
        Assert.That(actual.Name, Is.EqualTo(expected.Name), what);
        AssertSame(actual.World, expected.World, what + " world");
        AssertSame(actual.Pivot, expected.Pivot, what + " pivot");
        AssertSame(actual.Scale, expected.Scale, what + " scale");
        Assert.That(actual.Visible, Is.EqualTo(expected.Visible), what + " visible");
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
