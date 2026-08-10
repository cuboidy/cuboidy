using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Cuboidy.Runtime;

namespace Cuboidy.Tests;

// The C# half of the acceptance criterion's runtime check. Emits the same
// `transform` and `socket` lines `cuboidy-query --transforms --sockets` does,
// so the two can be compared number for number.
//
// This lives in the TEST assembly on purpose. `cuboidy-query` is an author's
// tool and stays TypeScript; what the library owes is the numbers, not the
// text around them.
internal static class ParityFormat
{
    // `num.ts` is not ported, and this is the one thing in it that a harness
    // needs. Hazards N3 and N4 both live in these three lines:
    //
    //   N3  JavaScript's `Math.round` is half toward +∞. C#'s `Math.Round` is
    //       banker's and `MidpointRounding.AwayFromZero` differs on negatives,
    //       so neither is a translation of it. `Math.Floor(n * 1e6 + 0.5)` is.
    //   N4  `round6` can return -0, which JavaScript prints as "0" and .NET
    //       prints as "-0". Folded before formatting.
    public static double Round6(double n) => Math.Floor(n * 1e6 + 0.5) / 1e6;

    // Every printed number goes through here: rounded to the 1e-6 grid the
    // world coordinates already use, with -0 folded to 0, and a fixed 6
    // decimals so the text form never switches to exponent notation.
    // InvariantCulture, always — hazard N2, where `de-DE` would print "0,5".
    public static string Num(double n)
    {
        double r = Round6(n);
        if (r == 0) r = 0;
        return r.ToString("F6", CultureInfo.InvariantCulture);
    }

    private static string Vec(Vec3 v) => $"{Num(v.X)},{Num(v.Y)},{Num(v.Z)}";

    private static string Quat(Quat q) => $"{Num(q.X)},{Num(q.Y)},{Num(q.Z)},{Num(q.W)}";

    // SPEC §6.3 clips in both forms, flattened to one map so nothing branches
    // on whether the author wrote the animation inline or pointed at a file.
    // External entries come second only because a clip name cannot be both.
    public static OrderedMap<InlineAnimation> ClipsOf(CuboidyPackage pkg)
    {
        var clips = new List<KeyValuePair<string, InlineAnimation>>();
        foreach (KeyValuePair<string, Animation> entry in pkg.Manifest.Animations)
        {
            if (entry.Value.Inline is { } inline)
            {
                clips.Add(new KeyValuePair<string, InlineAnimation>(entry.Key, inline));
            }
        }

        foreach (KeyValuePair<string, ExternalAnimation> entry in pkg.Project.ExternalAnims)
        {
            clips.Add(new KeyValuePair<string, InlineAnimation>(entry.Key, entry.Value.Anim));
        }

        return OrderedMap<InlineAnimation>.From(clips);
    }

    // `clip` null for the rest pose, which is the same call with nothing
    // sampled — one implementation of the hierarchy math.
    public static List<string> TransformsAndSockets(CuboidyPackage pkg, string? clip, double time)
    {
        OrderedMap<Pose> poses = OrderedMap<Pose>.Empty;
        if (clip is not null)
        {
            OrderedMap<InlineAnimation> clips = ClipsOf(pkg);
            if (!clips.TryGetValue(clip, out InlineAnimation? animation))
            {
                throw new ArgumentException($"model has no animation \"{clip}\"", nameof(clip));
            }

            poses = Sampler.SampleAnimation(animation, time);
        }

        OrderedMap<Frame> world = RigTransform.ComputeWorldTransforms(
            pkg.Manifest.Parts, RigTransform.PivotRotsOf(pkg.Project.Parts), poses);

        var lines = new List<string>();
        foreach (KeyValuePair<string, Frame> entry in world)
        {
            // A part's whole §6.5 pose, not just the rigid half. `scale` and
            // `visible` are deliberately outside the frame — scale is local and
            // does not propagate to children, visibility is a draw decision —
            // and that is exactly why they need printing: nothing else in the
            // acceptance contract can see them. Measured before they were here,
            // a port that never implemented step-visible, or that applied scale
            // in world axes after the rotation instead of about the pivot
            // before it, produced byte-identical output for every model, every
            // clip and every sample time.
            bool posed = poses.TryGetValue(entry.Key, out Pose pose);
            Vec3 scale = posed ? pose.Scale : new Vec3(1, 1, 1);
            bool visible = !posed || pose.Visible;
            lines.Add(
                $"transform {entry.Key} pos={Vec(entry.Value.Pos)} quat={Quat(entry.Value.Quat)} " +
                $"scale={Vec(scale)} visible={(visible ? 1 : 0)}");
        }

        OrderedMap<Frame> frames = SocketFrame.PublishedSocketFrames(
            pkg.Manifest, pkg.Project.Parts, poses);

        if (frames.Count == 0)
        {
            lines.Add("sockets: (model publishes none)");
            return lines;
        }

        // ORDINAL. `Array.prototype.sort()` with no comparator is specified to
        // compare UTF-16 code units; .NET's default string comparer — including
        // `OrderBy(x => x)` — is culture-sensitive, and hazard S6 measured it
        // reordering every one of `--mesh-faces`' 608 lines under ja-JP.
        foreach (string name in frames.Keys.OrderBy(n => n, StringComparer.Ordinal))
        {
            Frame f = frames[name];
            lines.Add($"socket {name} pos={Vec(f.Pos)} quat={Quat(f.Quat)}");
        }

        return lines;
    }

    // SPEC §7.4: only the SET of faces is normative, so the comparable form is
    // sorted. Each line is one face — outward normal, four world corners in
    // winding order, colour, alpha, material — and identical output means two
    // implementations agree about the model's surfaces however they enumerated
    // them.
    //
    // Two things about a mesh are normative but are NOT visible in the face
    // set: the material list's ORDER (§7.4 — `MeshGroup.Material` indexes it)
    // and the opaque/translucent split that decides the draw passes. Those get
    // one `mesh-part` line each, so a port that emits the right rectangles with
    // the materials in walk order still fails.
    public static List<string> MeshLines(CuboidyPackage pkg, string? clip, double time, bool withFaces)
    {
        OrderedMap<Pose> poses = OrderedMap<Pose>.Empty;
        if (clip is not null)
        {
            poses = Sampler.SampleAnimation(ClipsOf(pkg)[clip], time);
        }

        OrderedMap<Frame> world = RigTransform.ComputeWorldTransforms(
            pkg.Manifest.Parts, RigTransform.PivotRotsOf(pkg.Project.Parts), poses);

        var faces = new List<string>();
        var partLines = new List<string>();

        // The reference walks its assembly's `resolvedParts`, which is the
        // hierarchy order restricted to parts that resolved. `world` is the
        // hierarchy order over every manifest part, so the resolution filter
        // has to be applied here.
        foreach (KeyValuePair<string, Frame> entry in world)
        {
            if (!pkg.Project.Parts.TryGetValue(entry.Key, out ResolvedPart? rp)) continue;

            // §6.5: an invisible part contributes no surface. Stated here
            // because the mesh is the only query where visibility has a
            // consequence a port can be measured against.
            if (poses.TryGetValue(entry.Key, out Pose pose) && !pose.Visible)
            {
                partLines.Add($"mesh-part {entry.Key} hidden");
                continue;
            }

            Frame wt = entry.Value;
            MeshData mesh = Mesh.BuildMesh(rp.Part, rp.Palette);
            Vec3 pivot = rp.Part.Pivot.Pos;
            Vec3? scale = poses.ContainsKey(entry.Key) ? pose.Scale : (Vec3?)null;

            // `BuildMesh` emits four consecutive vertices per face, in winding
            // order, sharing one normal / colour / alpha.
            int quadCount = mesh.Positions.Length / 12;
            int[] matOfQuad = QuadMaterials(mesh, quadCount);
            int opaqueFaces = 0;
            for (int f = 0; f < quadCount; f++)
            {
                var corners = new string[4];
                for (int c = 0; c < 4; c++)
                {
                    int at = (f * 4 + c) * 3;
                    Vec3 p = RigTransform.LocalPointToWorld(
                        new Vec3(mesh.Positions[at], mesh.Positions[at + 1], mesh.Positions[at + 2]),
                        pivot, scale, wt);
                    corners[c] = Vec(p);
                }

                int n0 = f * 12;
                Vec3 normal = RigTransform.QuatRotateVec3(
                    wt.Quat, new Vec3(mesh.Normals[n0], mesh.Normals[n0 + 1], mesh.Normals[n0 + 2]));
                MeshMaterial m = mesh.Materials[matOfQuad[f]];
                if (!m.Translucent) opaqueFaces++;

                faces.Add(
                    $"face n={Vec(normal)} {string.Join(" ", RotateToCanonicalStart(corners))} " +
                    $"rgb={Channel(mesh.Colors[n0])},{Channel(mesh.Colors[n0 + 1])},{Channel(mesh.Colors[n0 + 2])} " +
                    $"a={Channel(mesh.Alphas[f * 4])} " +
                    $"metallic={Num(m.Metallic)} roughness={Num(m.Roughness)} " +
                    $"emissive={Num(m.Emissive)}");
            }

            string materialWords = mesh.Materials.Count == 0
                ? "(none)"
                : string.Join(",", mesh.Materials.Select(MaterialWord));
            partLines.Add(
                $"mesh-part {entry.Key} faces={quadCount} " +
                $"opaque-faces={opaqueFaces} " +
                $"opaque-split={(OpaqueSplitIsSound(mesh) ? "ok" : "BROKEN")} " +
                $"materials={materialWords}");
        }

        // ORDINAL, by UTF-16 code unit, which is what `Array.prototype.sort()`
        // with no comparator is specified to do. Hazard S6, measured: under
        // ja-JP, .NET's default comparer moves EVERY ONE of models/sword's 608
        // sorted lines, and the face lines contain `-`, ` `, `,` and `=` while
        // §5 identifiers permit `-` and mixed case.
        faces.Sort(StringComparer.Ordinal);

        var lines = new List<string> { $"mesh faces={faces.Count} digest={Digest(faces)}" };
        lines.AddRange(partLines);
        if (withFaces) lines.AddRange(faces);
        return lines;
    }

    // A colour channel, recovered to the 8-bit value it came from before being
    // divided. `MeshData.Colors` is float32 because that is what a GPU takes,
    // and printing it directly leaks the rounding: 182/255 is 0.713725 as a
    // double and 0.713726 through float32, so a port computing `r / 255.0` —
    // the obvious translation, and what §7.4 describes — fails two of the nine
    // models on colour alone. The palette's channels are integers by definition
    // (§7.4 hex), so the round trip is exact.
    private static string Channel(float v) => Num(Math.Round(v * 255.0) / 255);

    // SPEC §7.4 makes the RECTANGLE normative, not where a face table starts
    // listing it. Rotating the four corners to begin at the lexicographically
    // smallest one keeps the cyclic order — so a reversed winding is still a
    // different line — while letting a port whose table starts each quad at a
    // different corner produce the same output.
    private static string[] RotateToCanonicalStart(string[] corners)
    {
        int at = 0;
        for (int i = 1; i < corners.Length; i++)
        {
            if (string.CompareOrdinal(corners[i], corners[at]) < 0) at = i;
        }

        var rotated = new string[corners.Length];
        for (int i = 0; i < corners.Length; i++) rotated[i] = corners[(at + i) % corners.Length];
        return rotated;
    }

    // SPEC §7.4's draw-pass split, expressed WITHOUT counting indices. The
    // count itself is in index space, which the spec leaves free — a different
    // triangulation moves it — but the property it exists for does not: every
    // index below `OpaqueIndexCount` belongs to an opaque material and every
    // index above it to a translucent one.
    private static bool OpaqueSplitIsSound(MeshData mesh)
    {
        foreach (MeshGroup g in mesh.Groups)
        {
            bool translucent = g.Material >= 0 && g.Material < mesh.Materials.Count
                && mesh.Materials[g.Material].Translucent;
            int end = g.Start + g.Count;
            bool before = end <= mesh.OpaqueIndexCount;
            bool after = g.Start >= mesh.OpaqueIndexCount;
            // A group must sit wholly on one side, and on the side its material
            // says.
            if (!before && !after) return false;
            if (before == translucent) return false;
        }

        return true;
    }

    // One material, in the ORDER §7.4 makes normative — which is the whole
    // reason to print it: `MeshGroup.Material` is an index into this list, so
    // two implementations that order it differently hand the same face to
    // different materials while both emitting the right rectangles.
    private static string MaterialWord(MeshMaterial m) =>
        $"{Num(m.Metallic)}:{Num(m.Roughness)}:{Num(m.Emissive)}:{(m.Translucent ? "t" : "o")}";

    // Which material each quad is drawn with, read back through `Groups` — the
    // only route there is, and the one a renderer takes. A quad's four vertices
    // are 4f .. 4f+3, so any index into it names the quad.
    private static int[] QuadMaterials(MeshData mesh, int quadCount)
    {
        var of = new int[quadCount];
        foreach (MeshGroup g in mesh.Groups)
        {
            for (int i = g.Start; i < g.Start + g.Count; i++)
            {
                of[mesh.Indices[i] / 4] = g.Material;
            }
        }

        return of;
    }

    // FNV-1a over the sorted face lines, hex. Not cryptographic — a cheap "did
    // these two runs agree" that fits on one line.
    //
    // 32-bit, offset basis 0x811c9dc5, prime 0x01000193, `Math.imul` semantics
    // (a wrapping 32-bit multiply), over each line's UTF-16 CODE UNITS with \n
    // folded in after every line including the last.
    private static string Digest(IReadOnlyList<string> lines)
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

        return h.ToString("x8", CultureInfo.InvariantCulture);
    }
}
