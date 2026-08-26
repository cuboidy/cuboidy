// Port of ts/packages/core/src/socket-frame.ts.
//
// SPEC §7.8 + §6.12: where a published socket IS, in world space.
//
// This is the join two packages meet at: a host offers a frame, a guest is
// placed on it, and both sides must compute the same point or the two models
// come apart. A second implementation is how the halves drift, which is why
// this is in the library rather than in whichever app happens to need it first.
//
// `SocketFrame` is `Frame` — the same shape a part's world transform is, one
// shape for the two things it places. They used to be two identical
// declarations in the reference, which TypeScript lets you pass
// interchangeably and C# does not.

using System;
using System.Collections.Generic;

namespace Cuboidy.Runtime;

public static class SocketFrame
{
    // parent ∘ child: the child frame carried into the parent's — its offset
    // rotated into the parent's axes, orientations composed. A socket frame in
    // model space carried into an instance's world frame is this; so is a
    // guest's base on a host's socket.
    public static Frame ComposeFrames(Frame parent, Frame child)
    {
        Vec3 off = RigTransform.QuatRotateVec3(parent.Quat, child.Pos);
        return new Frame(
            new Vec3(parent.Pos.X + off.X, parent.Pos.Y + off.Y, parent.Pos.Z + off.Z),
            RigTransform.QuatMultiply(parent.Quat, child.Quat));
    }

    // The frame of one socket declared on one part, given that part's world
    // transform. Null when the part declares no socket by that name.
    //
    // A part's world transform places its PIVOT at `world.Pos`, and a local
    // point `v` lands at `world.Pos + world.Quat · (v − pivot.Pos)`. A socket
    // is a point in that same local space (§7.8: "in the host part's local
    // space after the host part's own pivot transform has been applied"), so it
    // goes through the identical mapping — `LocalPointToWorld`, the same call
    // a mesher makes for every voxel corner.
    //
    // `scale` is the host part's TOTAL scale — §6.2's rest term times §6.5's
    // animated one, which `ScaleOf` below composes. A socket is a point in
    // the part's geometry, so it moves exactly as the voxels around it do — the
    // socket on a 3×-lengthened arm stays at the arm's tip instead of ending up
    // buried a third of the way along it. The GUEST is not resized: the frame
    // carries position and orientation only, so a held sword travels to the
    // right place at its own size rather than being deformed by whatever the
    // wielder's torso is doing.
    public static Frame? SocketFrameOn(Part part, Frame world, string socketName, Vec3? scale = null)
    {
        Socket? socket = null;
        foreach (Socket s in part.Sockets)
        {
            if (string.Equals(s.Name, socketName, StringComparison.Ordinal))
            {
                socket = s;
                break;
            }
        }

        if (socket is null) return null;

        Vec3 pos = RigTransform.LocalPointToWorld(socket.Pos, part.Pivot.Pos, scale, world);
        Vec3 rot = socket.Rot ?? new Vec3(0, 0, 0);
        return new Frame(pos, RigTransform.QuatMultiply(world.Quat, RigTransform.QuatFromEulerZxyDeg(rot)));
    }

    // The frame a model offers under a PUBLISHED name (§6.12) — the only name a
    // consumer is meant to use. Null when the model does not publish it, or
    // when what it publishes does not resolve; both are the consumer-side
    // `unknown` §11.6 describes, and the caller decides how loudly to say so.
    //
    // `poses` samples an animated host: a socket on a swinging arm moves with
    // it, so anything attached does too. Omit it for the rest pose.
    public static Frame? PublishedSocketFrame(
        Manifest manifest,
        OrderedMap<ResolvedPart> parts,
        string publishedName,
        IReadOnlyDictionary<string, Pose>? poses = null)
    {
        if (!manifest.Sockets.TryGetValue(publishedName, out PublishedSocket? target)) return null;
        if (!parts.TryGetValue(target.Part, out ResolvedPart? resolved)) return null;
        if (!WorldTransformsFor(manifest, parts, poses).TryGetValue(target.Part, out Frame world))
        {
            return null;
        }

        return SocketFrameOn(resolved.Part, world, target.Socket, ScaleOf(manifest, poses, target.Part));
    }

    // Every frame the model publishes (§6.12), keyed by published name, with
    // the rig chain computed ONCE. The per-name entry point above re-derives
    // the whole chain per call — an N-socket loop should come here instead.
    // Names that do not resolve are simply absent (§11.6's consumer-side
    // `unknown`), same as the single-name form returning null.
    public static OrderedMap<Frame> PublishedSocketFrames(
        Manifest manifest,
        OrderedMap<ResolvedPart> parts,
        IReadOnlyDictionary<string, Pose>? poses = null)
    {
        if (manifest.Sockets.Count == 0) return OrderedMap<Frame>.Empty;

        OrderedMap<Frame> world = WorldTransformsFor(manifest, parts, poses);
        var frames = new List<KeyValuePair<string, Frame>>();
        foreach (KeyValuePair<string, PublishedSocket> entry in manifest.Sockets)
        {
            PublishedSocket target = entry.Value;
            if (!parts.TryGetValue(target.Part, out ResolvedPart? resolved)) continue;
            if (!world.TryGetValue(target.Part, out Frame wt)) continue;
            Frame? frame = SocketFrameOn(
                resolved.Part, wt, target.Socket, ScaleOf(manifest, poses, target.Part));
            if (frame is { } f) frames.Add(new KeyValuePair<string, Frame>(entry.Key, f));
        }

        return OrderedMap<Frame>.From(frames);
    }

    // Rest-or-posed world transforms for a resolved model. Separate so a caller
    // placing several guests on one host computes the chain once.
    public static OrderedMap<Frame> WorldTransformsFor(
        Manifest manifest,
        OrderedMap<ResolvedPart> parts,
        IReadOnlyDictionary<string, Pose>? poses = null) =>
        RigTransform.ComputeWorldTransforms(
            manifest.Parts, RigTransform.PivotRotsOf(parts), poses);

    // The host's total scale: §6.2's rest term times whatever the pose
    // carries. A socket rides both, exactly as the voxels around it do.
    private static Vec3? ScaleOf(
        Manifest manifest, IReadOnlyDictionary<string, Pose>? poses, string part)
    {
        Vec3? anim = poses is not null && poses.TryGetValue(part, out Pose pose)
            ? pose.Scale
            : (Vec3?)null;
        Vec3? rest = null;
        foreach (ManifestPart mp in manifest.Parts)
        {
            if (mp.Name == part) { rest = mp.Scale; break; }
        }

        return RigTransform.ComposeScale(rest, anim);
    }
}
