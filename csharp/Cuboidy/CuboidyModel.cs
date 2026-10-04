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
//
// A value, like `Frame` and `Pose`: a renderer asks for one per part per
// frame, and `Placements(poses, into, sockets)` writes them into a list the
// caller keeps, which only a value can be without allocating each one.
public readonly record struct Placement(
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

    // The same sample, for a caller that samples every frame: written into
    // `into`, which is cleared first and which the caller keeps, from the
    // clip's keys as resolved once for this model. The same numbers as the
    // form above, and nothing allocated once `into` has grown to the clip.
    //
    // A keyed map and not an ordered one: posing looks parts up by name, and
    // keeping the clip's order would cost the allocation this form exists to
    // avoid. A clip the model does not have leaves `into` empty — the rest
    // pose — and returns false.
    public bool TryPose(string clip, double time, IDictionary<string, Pose> into)
    {
        if (into is null) throw new ArgumentNullException(nameof(into));
        if (!ResolvedClips.TryGetValue(clip, out ResolvedClip? resolved))
        {
            into.Clear();
            return false;
        }

        resolved.SampleInto(time, into);
        return true;
    }

    // Every clip's keys resolved, on the first sample that asks and kept, the
    // way `Culls` is kept: built whole and assigned once, so a model shared by
    // many callers never hands one of them a half-built map.
    private Dictionary<string, ResolvedClip>? resolvedClips;

    private Dictionary<string, ResolvedClip> ResolvedClips
    {
        get
        {
            if (resolvedClips is not null) return resolvedClips;

            var resolved = new Dictionary<string, ResolvedClip>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, InlineAnimation> entry in Clips)
            {
                resolved[entry.Key] = new ResolvedClip(entry.Value);
            }

            resolvedClips = resolved;
            return resolved;
        }
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
        var placements = new List<Placement>();
        Placements(poses, placements);
        return placements;
    }

    // The same draw list for a caller that poses this model every frame,
    // written into `into` — cleared first — which the caller keeps, and with
    // `sockets` given, every frame the model publishes (§6.12, what
    // `SocketFrames` returns) from the SAME walk down the rig, cleared and
    // filled in the manifest's order. The rig's order, which parts resolved
    // and where every published socket sits are facts about the package,
    // resolved on the first pose and kept on the model; the walk itself is
    // arithmetic, so once the lists have grown to the model nothing is
    // allocated. The numbers are the ones `Placements(poses)` and
    // `SocketFrames(poses)` return.
    public void Placements(
        IReadOnlyDictionary<string, Pose>? poses,
        List<Placement> into,
        List<KeyValuePair<string, Frame>>? sockets = null)
    {
        if (into is null) throw new ArgumentNullException(nameof(into));

        PosePlan plan = Plan;
        int count = plan.Chain.Count;
        // Every part's frame, the ones that did not resolve included: a
        // resolved part can hang under one that did not.
        Span<Frame> world = count <= StackFrames ? stackalloc Frame[count] : new Frame[count];
        plan.Chain.Compose(poses, world);

        into.Clear();
        for (int i = 0; i < count; i++)
        {
            ResolvedPart? resolved = plan.Resolved[i];
            if (resolved is null) continue;
            string name = plan.Chain.NameAt(i);
            Pose p = poses is not null && poses.TryGetValue(name, out Pose pose)
                ? pose
                : Runtime.Pose.Default;
            into.Add(new Placement(
                name,
                world[i],
                resolved.Part.Pivot.Pos,
                RigTransform.ComposeScale(plan.RestScales[i], p.Scale) ?? new Vec3(1, 1, 1),
                p.Visible));
        }

        if (sockets is null) return;

        sockets.Clear();
        foreach (SocketSeat seat in plan.Sockets)
        {
            // The host's TOTAL scale (`SocketFrame.ScaleOf`): its §6.2 rest
            // term times whatever the pose carries, absent when neither does.
            Vec3? anim = poses is not null && poses.TryGetValue(seat.HostName, out Pose pose)
                ? pose.Scale
                : (Vec3?)null;
            sockets.Add(new KeyValuePair<string, Frame>(
                seat.Published,
                SocketFrame.FrameOf(
                    seat.Socket, seat.Host, world[seat.HostAt],
                    RigTransform.ComposeScale(seat.RestScale, anim))));
        }
    }

    // The part frames `Placements` composes into live on the stack up to this
    // many parts — 7 KB; the largest model in `models/` has 20, the largest
    // the first consuming game ships 30 — and in an array past it, one per
    // call.
    private const int StackFrames = 128;

    // Where one published socket sits, resolved once: the published name, the
    // host part's position in the rig's order, its shape and the socket on it,
    // and its §6.2 rest scale. A published name whose part did not resolve, is
    // not in the rig, or declares no socket of that name is absent — the same
    // names `SocketFrames` leaves out, and on every pose, since a pose moves a
    // socket without ever making one resolve.
    private readonly record struct SocketSeat(
        string Published, string HostName, int HostAt, Part Host, Socket Socket, Vec3? RestScale);

    // What posing this model reads that no pose can change: the rig's order
    // and parents, which parts resolved (and so are drawn), each part's §6.2
    // rest scale, and the published sockets. One per MODEL rather than per
    // caller, because every body drawn from one package shares all of it; the
    // pose itself is what a caller keeps.
    private sealed class PosePlan
    {
        public PosePlan(RigChain chain, ResolvedPart?[] resolved, Vec3?[] restScales, SocketSeat[] sockets)
        {
            Chain = chain;
            Resolved = resolved;
            RestScales = restScales;
            Sockets = sockets;
        }

        public RigChain Chain { get; }

        public ResolvedPart?[] Resolved { get; }

        public Vec3?[] RestScales { get; }

        public SocketSeat[] Sockets { get; }
    }

    // Built on the first pose and kept, the way `Culls` is: whole, then
    // assigned once.
    private PosePlan? plan;

    private PosePlan Plan
    {
        get
        {
            if (plan is not null) return plan;

            RigChain chain = RigChain.Of(Manifest.Parts, RigTransform.PivotRotsOf(Project.Parts));

            // §6.2's rest scales, LAST part of a name winning — the map
            // `Placements` has always read them from.
            var restScales = new Dictionary<string, Vec3?>(StringComparer.Ordinal);
            foreach (ManifestPart mp in Manifest.Parts) restScales[mp.Name] = mp.Scale;

            var at = new Dictionary<string, int>(StringComparer.Ordinal);
            var resolved = new ResolvedPart?[chain.Count];
            var scales = new Vec3?[chain.Count];
            for (int i = 0; i < chain.Count; i++)
            {
                string name = chain.NameAt(i);
                at[name] = i;
                resolved[i] = Project.Parts.TryGetValue(name, out ResolvedPart? r) ? r : null;
                restScales.TryGetValue(name, out Vec3? rest);
                scales[i] = rest;
            }

            var sockets = new List<SocketSeat>();
            foreach (KeyValuePair<string, PublishedSocket> entry in Manifest.Sockets)
            {
                PublishedSocket target = entry.Value;
                if (!Project.Parts.TryGetValue(target.Part, out ResolvedPart? host)) continue;
                if (!at.TryGetValue(target.Part, out int hostAt)) continue;

                // `SocketFrameOn`'s lookup: the first socket of the name.
                Socket? socket = null;
                foreach (Socket s in host.Part.Sockets)
                {
                    if (string.Equals(s.Name, target.Socket, StringComparison.Ordinal))
                    {
                        socket = s;
                        break;
                    }
                }

                if (socket is null) continue;

                // `SocketFrame.ScaleOf`'s rest term: the FIRST part of the
                // name. Two parts of one name do not load (§11.5), so this and
                // the last-wins map above cannot disagree on a model that did.
                Vec3? rest = null;
                foreach (ManifestPart mp in Manifest.Parts)
                {
                    if (mp.Name == target.Part) { rest = mp.Scale; break; }
                }

                sockets.Add(new SocketSeat(entry.Key, target.Part, hostAt, host.Part, socket, rest));
            }

            plan = new PosePlan(chain, resolved, scales, sockets.ToArray());
            return plan;
        }
    }

    // §6.14: the open-boundary cull for each part, in the REST pose.
    //
    // Resolved once and kept, because a manifest-level declaration is a plane
    // of the whole package's bounds — so it costs a pass over every part — and
    // because a block is baked once and drawn thousands of times. A package
    // that declares nothing produces an empty map, every lookup below misses,
    // and `BuildMesh` behaves exactly as it did before §6.14 existed.
    private Dictionary<string, OpenBoundaryCull>? culls;

    private Dictionary<string, OpenBoundaryCull> Culls
    {
        get
        {
            if (culls is not null) return culls;

            var placements = new Dictionary<string, RestPlacement>(StringComparer.Ordinal);
            OrderedMap<Frame> world = WorldTransforms();
            foreach (ManifestPart mp in Manifest.Parts)
            {
                if (!Project.Parts.TryGetValue(mp.Name, out ResolvedPart? resolved)) continue;
                if (!world.TryGetValue(mp.Name, out Frame frame)) continue;
                placements[mp.Name] = new RestPlacement(resolved.Part, frame, mp.Scale);
            }

            culls = new Dictionary<string, OpenBoundaryCull>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, IReadOnlyList<OpenPlane>> entry in
                     OpenBoundary.PlanesFor(Manifest, placements))
            {
                // The very placement the planes were measured from, so a face
                // is never tested against a plane derived from a different one.
                RestPlacement placement = placements[entry.Key];
                culls[entry.Key] = new OpenBoundaryCull(
                    entry.Value, placement.Transform, placement.Scale);
            }

            return culls;
        }
    }

    private OpenBoundaryCull? CullFor(string partName) =>
        Culls.TryGetValue(partName, out OpenBoundaryCull? cull) ? cull : null;

    // §7.4 vertex data for one part, in PART-LOCAL space, against that part's
    // OWN palette. Raises for a part the model does not have or did not
    // resolve; `Placements` lists exactly the ones it does.
    //
    // §6.14 is applied here rather than left to the caller: the omission is a
    // property of the PACKAGE, and a consumer that baked the faces anyway would
    // draw a seam the format says is not there. It is a rest-pose statement, so
    // there is deliberately no posed overload — a part that moves keeps every
    // face, and lint H05 is where an author is told the two do not mix.
    public MeshData BuildMesh(string partName)
    {
        if (!Project.Parts.TryGetValue(partName, out ResolvedPart? resolved))
        {
            throw new KeyNotFoundException(
                $"model '{Name}' has no resolved part '{partName}'");
        }

        return Mesh.BuildMesh(resolved.Part, resolved.Palette, CullFor(partName));
    }

    public bool TryBuildMesh(string partName, out MeshData mesh)
    {
        if (Project.Parts.TryGetValue(partName, out ResolvedPart? resolved))
        {
            mesh = Mesh.BuildMesh(resolved.Part, resolved.Palette, CullFor(partName));
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
