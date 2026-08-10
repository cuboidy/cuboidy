// Port of ts/packages/core/src/rig-transform.ts.
//
// SPEC §7.7 rig transform math, renderer-agnostic. This is the single
// implementation of "where does a part sit and how is it turned".
//
// Rotations use the SPEC's native convention (§4): Euler degrees, ZXY
// intrinsic order, right-handed. Quaternions are (x, y, z, w) — the same
// component order three.js and Godot use, so a caller can hand one to an
// engine verbatim.

using System;
using System.Collections.Generic;

namespace Cuboidy.Runtime;

public readonly record struct Quat(double X, double Y, double Z, double W)
{
    public static Quat Identity => new Quat(0, 0, 0, 1);
}

// A rigid placement: where something sits and how it is turned.
//
// ONE shape, under the two names the two uses have — a part's world transform
// and a socket's frame (§7.8). They were two identical declarations in the
// reference, which TypeScript lets you pass interchangeably and C# does not:
// the port would have shipped two records that cannot be assigned to each
// other unless someone noticed they are the same thing. C# has no exportable
// type alias, so the two names live in the doc comments instead of in the type
// system.
//
// A part-local point v lands at `Pos + rotate(Quat, v − pivot.pos)`.
public readonly record struct Frame(Vec3 Pos, Quat Quat);

public readonly record struct Bounds(Vec3 Min, Vec3 Max);

public static class RigTransform
{
    // Euler degrees (ZXY intrinsic, §4) → quaternion. The expansion is the
    // closed form of q_z ⊗ q_x ⊗ q_y and matches three.js
    // `Quaternion.setFromEuler(new Euler(x, y, z, 'ZXY'))` exactly.
    public static Quat QuatFromEulerZxyDeg(Vec3 e)
    {
        double hx = (e.X * Math.PI) / 360; // deg → rad, halved
        double hy = (e.Y * Math.PI) / 360;
        double hz = (e.Z * Math.PI) / 360;
        double c1 = Math.Cos(hx);
        double s1 = Math.Sin(hx);
        double c2 = Math.Cos(hy);
        double s2 = Math.Sin(hy);
        double c3 = Math.Cos(hz);
        double s3 = Math.Sin(hz);
        return new Quat(
            s1 * c2 * c3 - c1 * s2 * s3,
            c1 * s2 * c3 + s1 * c2 * s3,
            c1 * c2 * s3 + s1 * s2 * c3,
            c1 * c2 * c3 - s1 * s2 * s3);
    }

    // Hamilton product a ⊗ b: the rotation that applies b first, then a (same
    // operand order as three.js `a.multiply(b)`).
    public static Quat QuatMultiply(Quat a, Quat b) =>
        new Quat(
            a.W * b.X + a.X * b.W + a.Y * b.Z - a.Z * b.Y,
            a.W * b.Y - a.X * b.Z + a.Y * b.W + a.Z * b.X,
            a.W * b.Z + a.X * b.Y - a.Y * b.X + a.Z * b.W,
            a.W * b.W - a.X * b.X - a.Y * b.Y - a.Z * b.Z);

    // Rotate a vector by a unit quaternion: q v q⁻¹, expanded via the standard
    // t = 2(q_v × v) shortcut.
    public static Vec3 QuatRotateVec3(Quat q, Vec3 v)
    {
        double tx = 2 * (q.Y * v.Z - q.Z * v.Y);
        double ty = 2 * (q.Z * v.X - q.X * v.Z);
        double tz = 2 * (q.X * v.Y - q.Y * v.X);
        return new Vec3(
            v.X + q.W * tx + q.Y * tz - q.Z * ty,
            v.Y + q.W * ty + q.Z * tx - q.X * tz,
            v.Z + q.W * tz + q.X * ty - q.Y * tx);
    }

    // A part's local orientation in parent space (§7.7):
    //   q_local = q_rotation ⊗ q_pivot ⊗ q_anim
    // where `rotation` is the manifest part's rest rotation (parent-space,
    // around the pivot), `pivotRot` is the geometry file's `pivot ... rot`, and
    // `animRot` is the sampled keyframe rotation. Any absent input is identity;
    // each is Euler degrees ZXY. The animation rotates first in the rest-local
    // frame, then the two rest terms bring it to the rest orientation — so
    // keyframe `rot: [0,0,0]` always reproduces the rest pose regardless of how
    // the rest orientation was authored.
    public static Quat ComposePartRotation(Vec3? rotation, Vec3? pivotRot, Vec3? animRot = null)
    {
        Quat q = Quat.Identity;
        if (rotation is { } r) q = QuatFromEulerZxyDeg(r);
        if (pivotRot is { } p) q = QuatMultiply(q, QuatFromEulerZxyDeg(p));
        if (animRot is { } a) q = QuatMultiply(q, QuatFromEulerZxyDeg(a));
        return q;
    }

    // Composes the §7.7 transform down every parent chain:
    //   W.pos  = parent.pos + rotate(parent.quat, part.position + anim.pos)
    //   W.quat = parent.quat ⊗ (q_rotation ⊗ q_pivot ⊗ q_anim)
    //
    // `pivotRots` carries each part's geometry-side `pivot.rot` (absent =
    // identity); parts unknown to the map are fine. Renderer-grade leniency: a
    // parent that names no entry in `parts`, or a chain that loops, resolves
    // the offending hop as a root instead of failing — validation owns
    // rejecting those (§11.5), display layers must not hang on malformed input.
    //
    // `poses` is optional so the rest pose is literally this function with
    // nothing sampled — one implementation of the hierarchy math, which is the
    // property that keeps a still renderer and an animated one from drifting
    // apart on §7.7.
    public static OrderedMap<Frame> ComputeWorldTransforms(
        IReadOnlyList<ManifestPart> parts,
        IReadOnlyDictionary<string, Vec3> pivotRots,
        IReadOnlyDictionary<string, Pose>? poses = null)
    {
        var byName = new Dictionary<string, ManifestPart>(StringComparer.Ordinal);
        foreach (ManifestPart p in parts)
        {
            if (!byName.ContainsKey(p.Name)) byName[p.Name] = p;
        }

        // The shared lenient policy (`Forest`): a parent that is absent, names
        // this part, names no part, or would close a cycle makes the part a
        // root. `Order` puts every part after its effective parent, so one pass
        // down the list composes the whole rig, and there is no way to compose
        // a part into itself.
        Hierarchy hierarchy = Forest.ResolveHierarchy(parts, p => p.Name, p => p.Parent);

        var built = new Dictionary<string, Frame>(StringComparer.Ordinal);
        var ordered = new List<KeyValuePair<string, Frame>>();
        foreach (string name in hierarchy.Order)
        {
            ManifestPart mp = byName[name];
            Vec3 baseline = mp.Position ?? new Vec3(0, 0, 0);
            Pose p = default;
            bool posed = poses is not null && poses.TryGetValue(name, out p);

            // §6.5: keyframe `pos` is a DELTA on `position`, so it lives in the
            // same (parent) frame and rides the ancestors' rotations with it.
            Vec3 local = posed
                ? new Vec3(baseline.X + p.Pos.X, baseline.Y + p.Pos.Y, baseline.Z + p.Pos.Z)
                : baseline;

            Vec3? pivotRot = pivotRots.TryGetValue(name, out Vec3 pr) ? pr : (Vec3?)null;
            Quat localQ = ComposePartRotation(mp.Rotation, pivotRot, posed ? p.Rot : (Vec3?)null);

            hierarchy.ParentOf.TryGetValue(name, out string? parentName);
            if (parentName is null || !built.TryGetValue(parentName, out Frame parent))
            {
                var root = new Frame(local, localQ);
                built[name] = root;
                ordered.Add(new KeyValuePair<string, Frame>(name, root));
                continue;
            }

            Vec3 off = QuatRotateVec3(parent.Quat, local);
            var frame = new Frame(
                new Vec3(parent.Pos.X + off.X, parent.Pos.Y + off.Y, parent.Pos.Z + off.Z),
                QuatMultiply(parent.Quat, localQ));
            built[name] = frame;
            ordered.Add(new KeyValuePair<string, Frame>(name, frame));
        }

        return OrderedMap<Frame>.From(ordered);
    }

    // The rest pose: the transform chain with nothing sampled.
    public static OrderedMap<Frame> ComputeRestWorldTransforms(
        IReadOnlyList<ManifestPart> parts,
        IReadOnlyDictionary<string, Vec3> pivotRots) =>
        ComputeWorldTransforms(parts, pivotRots);

    // SPEC §7.7 / §6.5: where a point written in a part's LOCAL space lands in
    // world space.
    //
    //   world.Pos + world.Quat · ((v − pivot) ⊙ scale)
    //
    // Scale acts on the pivot-relative offset, so a part grows about its pivot
    // rather than about the grid origin, and it does NOT propagate to children
    // — which is why it is applied here, per part, instead of being folded into
    // the frame.
    //
    // This is the one statement of that rule. It was written three times
    // outside its module in the reference — the software rasterizer, the GIF
    // runner and the editor's three.js tree — and this port carries none of
    // them, so `scale` would otherwise have arrived as a field of `Pose` with
    // its meaning left in code the port does not have.
    public static Vec3 LocalPointToWorld(Vec3 local, Vec3 pivot, Vec3? scale, Frame world)
    {
        Vec3 s = scale ?? new Vec3(1, 1, 1);
        Vec3 r = QuatRotateVec3(world.Quat, new Vec3(
            (local.X - pivot.X) * s.X,
            (local.Y - pivot.Y) * s.Y,
            (local.Z - pivot.Z) * s.Z));
        return new Vec3(world.Pos.X + r.X, world.Pos.Y + r.Y, world.Pos.Z + r.Z);
    }

    // The geometry-side `pivot.rot` map the transform chain takes, keyed by the
    // RIG's name for each part — which §6.13 renaming can make different from
    // the part's own `Name`, so callers pass explicit (rigName, part) pairs.
    public static IReadOnlyDictionary<string, Vec3> PivotRotsOf(
        IEnumerable<KeyValuePair<string, Part>> parts)
    {
        var rots = new Dictionary<string, Vec3>(StringComparer.Ordinal);
        foreach (KeyValuePair<string, Part> entry in parts)
        {
            if (entry.Value.Pivot.Rot is { } rot) rots[entry.Key] = rot;
        }

        return rots;
    }

    // Convenience over a resolved project: the same map, from what the loader
    // hands back.
    public static IReadOnlyDictionary<string, Vec3> PivotRotsOf(OrderedMap<ResolvedPart> parts)
    {
        var rots = new Dictionary<string, Vec3>(StringComparer.Ordinal);
        foreach (KeyValuePair<string, ResolvedPart> entry in parts)
        {
            if (entry.Value.Part.Pivot.Rot is { } rot) rots[entry.Key] = rot;
        }

        return rots;
    }

    // One AABB over every part's eight world-space box corners. A part's world
    // transform places its PIVOT at the frame's position, so each corner goes
    // through (corner − pivot) rotated; a part with no transform falls back to
    // an origin-anchored identity. `seed` is the caller's empty box: camera
    // framing unions in the unit cube at the origin, a selection outline starts
    // at ±Infinity and checks finiteness itself.
    public static Bounds PartsWorldBounds(
        IEnumerable<KeyValuePair<string, Part>> parts,
        IReadOnlyDictionary<string, Frame> transforms,
        Bounds? seed = null)
    {
        double[] min = seed is { } s0
            ? new[] { s0.Min.X, s0.Min.Y, s0.Min.Z }
            : new[] { double.PositiveInfinity, double.PositiveInfinity, double.PositiveInfinity };
        double[] max = seed is { } s1
            ? new[] { s1.Max.X, s1.Max.Y, s1.Max.Z }
            : new[] { double.NegativeInfinity, double.NegativeInfinity, double.NegativeInfinity };

        var fallback = new Frame(new Vec3(0, 0, 0), Quat.Identity);
        foreach (KeyValuePair<string, Part> entry in parts)
        {
            Part part = entry.Value;
            Frame wt = transforms.TryGetValue(entry.Key, out Frame found) ? found : fallback;
            Vec3 piv = part.Pivot.Pos;
            foreach (int cx in new[] { 0, part.Size.W })
            {
                foreach (int cy in new[] { 0, part.Size.H })
                {
                    foreach (int cz in new[] { 0, part.Size.D })
                    {
                        Vec3 r = QuatRotateVec3(wt.Quat, new Vec3(cx - piv.X, cy - piv.Y, cz - piv.Z));
                        double[] w = { wt.Pos.X + r.X, wt.Pos.Y + r.Y, wt.Pos.Z + r.Z };
                        for (int i = 0; i < 3; i++)
                        {
                            if (w[i] < min[i]) min[i] = w[i];
                            if (w[i] > max[i]) max[i] = w[i];
                        }
                    }
                }
            }
        }

        return new Bounds(new Vec3(min[0], min[1], min[2]), new Vec3(max[0], max[1], max[2]));
    }
}
