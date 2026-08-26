// NEW SURFACE, not a port — and the ONE piece of this library with no
// reference implementation to check against.
//
// The library's promise is four calls in a required order, and TypeScript
// composes all four in exactly one place: `cli/query-runner.ts`, which is
// dropped. So the shape of the API is a decision this file makes rather than a
// translation it performs. What the order has to be:
//
//   PivotRotsOf(resolved parts)                        → per-part pivot.rot
//   SampleAnimation(clip, time)                        → part → Pose   (omit for rest)
//   ComputeWorldTransforms(manifest.Parts, rots, poses) → part → Frame
//   PublishedSocketFrames(manifest, parts, poses)      → name → Frame  (§6.12)
//   BuildMesh(part, part.Palette)                      → vertex data, PART-LOCAL
//   LocalPointToWorld(v, pivot, pose.Scale, world)     → each vertex into world
//
// Two things fall out of that list and are easy to miss, so this class is
// where they stop being the caller's problem:
//
//   `BuildMesh` takes the part's OWN palette — `ResolvedPart.Palette` — not a
//   merged one. Merging is a CLI concern that exists so an ASCII grid can
//   spell every colour with one character, and a renderer drawing per part
//   never needs it.
//
//   The mesh comes out in PART-LOCAL space. Scale and the world transform are
//   applied per part, by the caller, because scale does not propagate to
//   children (§7.7). `Placement` is the four values that takes.

using System;
using System.Collections.Generic;

namespace Cuboidy.Runtime;

// Everything a renderer needs to place one part's part-local mesh: where its
// pivot sits and how its local frame is turned, the pivot the mesh is measured
// from, the §6.5 scale to apply about that pivot, and whether to draw it at
// all.
//
// All four, because all four are things a wrong port drops silently. Measured
// before the acceptance contract printed them: a port that never implemented
// `visible`, or applied scale in world axes after the rotation instead of
// about the pivot before it, produced byte-identical output for every model,
// every clip and every sample time.
public sealed record Placement(
    string Name,
    Frame World,
    Vec3 Pivot,
    Vec3 Scale,
    bool Visible)
{
    // A point written in the part's local space, in world space.
    public Vec3 ToWorld(Vec3 local) => RigTransform.LocalPointToWorld(local, Pivot, Scale, World);
}

public sealed class CuboidyModel
{
    private CuboidyModel(CuboidyPackage package, OrderedMap<InlineAnimation> clips)
    {
        Package = package;
        Clips = clips;
    }

    // Read a package off disk and resolve it. The failure is only about the
    // MANIFEST; everything a manifest references that could not be read comes
    // back on `Project.Diagnostics`, so check `Resolved` before drawing.
    public static Result<CuboidyModel> Load(string directory)
    {
        Result<CuboidyPackage> package = PackageLoader.LoadDirectory(directory);
        return package.Ok ? Result.Ok(From(package.Value)) : package.ToError<CuboidyModel>();
    }

    public static CuboidyModel From(CuboidyPackage package)
    {
        if (package is null) throw new ArgumentNullException(nameof(package));

        // §6.3 clips in both forms, flattened to one map so nothing downstream
        // branches on whether the author wrote the animation inline or pointed
        // at a file. External entries come second only because a clip name
        // cannot be both.
        var clips = new List<KeyValuePair<string, InlineAnimation>>();
        foreach (KeyValuePair<string, Animation> entry in package.Manifest.Animations)
        {
            if (entry.Value.Inline is { } inline)
            {
                clips.Add(new KeyValuePair<string, InlineAnimation>(entry.Key, inline));
            }
        }

        foreach (KeyValuePair<string, ExternalAnimation> entry in package.Project.ExternalAnims)
        {
            clips.Add(new KeyValuePair<string, InlineAnimation>(entry.Key, entry.Value.Anim));
        }

        return new CuboidyModel(package, OrderedMap<InlineAnimation>.From(clips));
    }

    public CuboidyPackage Package { get; }

    public Manifest Manifest => Package.Manifest;

    public ResolvedProject Project => Package.Project;

    public string Name => Manifest.Name;

    // §11.6's question for a consumer that DRAWS: is there a shape for every
    // part I am about to place? Read THIS, not `Project.Complete`.
    public bool Resolved => Project.Resolved;

    // Every §6.3 clip the model defines, keyed by name, external references
    // already resolved — inline and external look the same here.
    public OrderedMap<InlineAnimation> Clips { get; }

    // The rest pose is literally NO POSES, which is what every method below
    // treats as rest. One implementation of the hierarchy math, which is the
    // property that keeps a still renderer and an animated one from drifting
    // apart on §7.7.
    public static OrderedMap<Pose> RestPose => OrderedMap<Pose>.Empty;

    // Sample a clip at a time in seconds. §6.7 handles a time outside the clip:
    // a looping clip wraps, a non-looping one holds at its ends.
    public OrderedMap<Pose> Pose(string clip, double time)
    {
        if (!Clips.TryGetValue(clip, out InlineAnimation? animation))
        {
            throw new KeyNotFoundException(
                $"model '{Name}' has no animation '{clip}'" +
                (Clips.Count == 0 ? "" : $" (has: {string.Join(", ", Clips.Keys)})"));
        }

        return Sampler.SampleAnimation(animation, time);
    }

    public bool TryPose(string clip, double time, out OrderedMap<Pose> poses)
    {
        if (Clips.TryGetValue(clip, out InlineAnimation? animation))
        {
            poses = Sampler.SampleAnimation(animation, time);
            return true;
        }

        poses = OrderedMap<Pose>.Empty;
        return false;
    }

    // §7.7 world placement per part, in an order where every part follows its
    // effective parent — so one pass builds a scene graph.
    public OrderedMap<Frame> WorldTransforms(IReadOnlyDictionary<string, Pose>? poses = null) =>
        RigTransform.ComputeWorldTransforms(
            Manifest.Parts, RigTransform.PivotRotsOf(Project.Parts), poses);

    // §6.12: every frame the model publishes, keyed by the published name — the
    // only name a consumer is meant to use. A name that does not resolve is
    // absent rather than an error.
    public OrderedMap<Frame> SocketFrames(IReadOnlyDictionary<string, Pose>? poses = null) =>
        SocketFrame.PublishedSocketFrames(Manifest, Project.Parts, poses);

    public Frame? PublishedSocketFrame(
        string publishedName, IReadOnlyDictionary<string, Pose>? poses = null) =>
        SocketFrame.PublishedSocketFrame(Manifest, Project.Parts, publishedName, poses);

    // The draw list: every part that resolved to a shape, parents first, with
    // the four values placing its part-local mesh takes. Parts that did not
    // resolve are ABSENT — `Resolved` is how a caller learns there were any.
    public IReadOnlyList<Placement> Placements(IReadOnlyDictionary<string, Pose>? poses = null)
    {
        OrderedMap<Frame> world = WorldTransforms(poses);
        var placements = new List<Placement>();
        // §6.2's rest scales, read once: a part's total scale is this times
        // whatever the pose carries.
        var restScales = new Dictionary<string, Vec3?>(StringComparer.Ordinal);
        foreach (ManifestPart mp in Manifest.Parts) restScales[mp.Name] = mp.Scale;
        foreach (KeyValuePair<string, Frame> entry in world)
        {
            if (!Project.Parts.TryGetValue(entry.Key, out ResolvedPart? resolved)) continue;
            bool posed = poses is not null && poses.TryGetValue(entry.Key, out Pose pose);
            Pose p = posed ? poses![entry.Key] : Runtime.Pose.Default;
            restScales.TryGetValue(entry.Key, out Vec3? rest);
            placements.Add(new Placement(
                entry.Key,
                entry.Value,
                resolved.Part.Pivot.Pos,
                RigTransform.ComposeScale(rest, p.Scale) ?? new Vec3(1, 1, 1),
                p.Visible));
        }

        return placements;
    }

    // §7.4 vertex data for one part, in PART-LOCAL space, against that part's
    // OWN palette. Raises for a part the model does not have or did not
    // resolve; `Placements` lists exactly the ones it does.
    public MeshData BuildMesh(string partName)
    {
        if (!Project.Parts.TryGetValue(partName, out ResolvedPart? resolved))
        {
            throw new KeyNotFoundException(
                $"model '{Name}' has no resolved part '{partName}'");
        }

        return Mesh.BuildMesh(resolved.Part, resolved.Palette);
    }

    public bool TryBuildMesh(string partName, out MeshData mesh)
    {
        if (Project.Parts.TryGetValue(partName, out ResolvedPart? resolved))
        {
            mesh = Mesh.BuildMesh(resolved.Part, resolved.Palette);
            return true;
        }

        mesh = null!;
        return false;
    }

    // One AABB over every resolved part's eight world-space box corners.
    // Useful for framing a camera or seeding a broad-phase; it is the box the
    // PARTS occupy, not the box their meshes do, so a part whose voxels do not
    // fill its declared size is over-counted.
    public Bounds WorldBounds(IReadOnlyDictionary<string, Pose>? poses = null)
    {
        var parts = new List<KeyValuePair<string, Part>>();
        foreach (KeyValuePair<string, ResolvedPart> entry in Project.Parts)
        {
            parts.Add(new KeyValuePair<string, Part>(entry.Key, entry.Value.Part));
        }

        return RigTransform.PartsWorldBounds(parts, WorldTransforms(poses));
    }
}
