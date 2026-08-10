// Port of ts/packages/core/src/mesh.ts.
//
// Engine-agnostic mesh data for a single Part. Colors are sRGB in 0..1,
// matching the palette's color space (SPEC §7.4). Renderers that need linear
// values must convert at upload time.
//
// The output is fully deterministic given (part, palette), but SPEC §7.4 is
// explicit that only the SET of faces is normative — same rectangles, same
// outward normals, same colours, alphas and materials — not the order they come
// out in. The y→z→x walk below, its face order and its triangulation are one
// valid choice, not the contract. A port is free to merge faces; this one does
// not, and the acceptance criterion narrows §7.4 to say so, because an
// area-equivalence check costs more than it returns for a port whose stated
// goal is to keep the same decomposition. Merge ABOVE `BuildMesh`, not inside
// it.

using System;
using System.Collections.Generic;
using System.Linq;

namespace Cuboidy.Runtime;

// One draw's worth of surface: a §7.4 material plus whether its faces need the
// blended pass. `Translucent` is not part of the material — it comes from the
// colour's alpha — but it decides the PASS, so a bucket is keyed on both. Two
// entries with the same material, one see-through and one not, are two buckets.
//
// A RECORD STRUCT, and that is hazard S5: the reference buckets these by
// interpolating three doubles and a boolean into a string, and the literal
// translation is broken twice over. Under de-DE `(0.5).ToString()` is "0,5" —
// the same character as the delimiter — so `metallic=0.5, roughness=0`
// collides with `metallic=0, roughness=5`; and `false.ToString()` is "False".
// Structural equality has neither problem, and it buckets NaN with NaN the way
// the string form did, because `EqualityComparer<double>.Default` says NaN
// equals NaN where `==` does not.
public readonly record struct MeshMaterial(
    double Metallic,
    double Roughness,
    double Emissive,
    bool Translucent)
{
    public MeshMaterial(Material material, bool translucent)
        : this(material.Metallic, material.Roughness, material.Emissive, translucent)
    {
    }

    public Material Material => new Material(Metallic, Roughness, Emissive);
}

// A contiguous index range and the material to draw it with.
public readonly record struct MeshGroup(int Start, int Count, int Material);

public sealed record MeshData(
    float[] Positions,
    float[] Normals,
    float[] Colors,
    // SPEC §7.4 opacity, 0..1, one per vertex. Constant across a face, since it
    // comes from the voxel's palette entry. Kept beside `Colors` rather than
    // folded into it so a consumer that only draws opaque models can ignore it
    // and keep its three-float stride.
    float[] Alphas,
    int[] Indices,
    // The reference picks `Uint16Array` or `Uint32Array` by this same test. A
    // C# consumer converts on upload anyway, so the array stays `int[]` and the
    // decision is reported rather than encoded in the type.
    bool Use32BitIndices,
    // Indices are ordered OPAQUE FIRST: draw `[0, OpaqueIndexCount)` with depth
    // writes on, then the remainder blended, back to front, with depth writes
    // off. A model with no translucent color has `OpaqueIndexCount ==
    // Indices.Length` and needs no second pass.
    int OpaqueIndexCount,
    // Distinct materials ordered by VALUE (SPEC §7.4): translucent last, then
    // metallic, roughness, emissive ascending. NOT first-appearance order —
    // that would depend on the voxel walk, and `MeshGroup.Material` is an index
    // into this array, so two implementations walking differently would hand
    // the same face to different materials while both conforming.
    IReadOnlyList<MeshMaterial> Materials,
    // `Indices` partitioned by material, in draw order. Ranges are contiguous
    // and cover the whole buffer, so a renderer that ignores materials can
    // ignore `Groups` too and still draw the right triangles.
    IReadOnlyList<MeshGroup> Groups);

public static class Mesh
{
    private static readonly MeshMaterial MatteOpaque = new MeshMaterial(PaletteCodec.Matte, false);

    // SPEC §7.4's material ordering. Total, since two materials comparing equal
    // on all four fields are the same material and share a bucket.
    //
    // Returns a SIGN, never a difference — hazard N7. The three fields are
    // 0..1, so the literal translation of `return a.metallic - b.metallic` into
    // a `Comparison<MeshMaterial>` truncates every real difference to 0: every
    // material compares equal, the sort is a no-op, and the list silently falls
    // back to walk order. That is precisely the failure §7.4 orders the list to
    // prevent.
    public static int CompareMaterials(MeshMaterial a, MeshMaterial b)
    {
        if (a.Translucent != b.Translucent) return a.Translucent ? 1 : -1;
        // Three-way per field rather than `x < y ? -1 : 1`, so a NaN — which is
        // neither less nor greater — falls through to 0 instead of reporting a
        // material as greater than itself. The buckets group NaN with NaN, and
        // a comparator that disagreed with the bucketing would order a material
        // list that has two entries the buckets say is one.
        if (a.Metallic < b.Metallic) return -1;
        if (a.Metallic > b.Metallic) return 1;
        if (a.Roughness < b.Roughness) return -1;
        if (a.Roughness > b.Roughness) return 1;
        if (a.Emissive < b.Emissive) return -1;
        if (a.Emissive > b.Emissive) return 1;
        return 0;
    }

    private readonly record struct FaceDef(
        int Nx, int Ny, int Nz,
        int Dx, int Dy, int Dz,
        int[] Corners); // four (x, y, z) triples, flattened

    // Corners listed CCW when viewed from outside the cube, so default
    // front-face winding produces outward-facing triangles. Face order is
    // +X, -X, +Y, -Y, +Z, -Z. Quad is triangulated as (0,1,2)+(0,2,3).
    private static readonly FaceDef[] Faces =
    {
        new FaceDef(1, 0, 0, 1, 0, 0, new[] { 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1 }),
        new FaceDef(-1, 0, 0, -1, 0, 0, new[] { 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0 }),
        new FaceDef(0, 1, 0, 0, 1, 0, new[] { 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0 }),
        new FaceDef(0, -1, 0, 0, -1, 0, new[] { 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1 }),
        new FaceDef(0, 0, 1, 0, 0, 1, new[] { 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1 }),
        new FaceDef(0, 0, -1, 0, 0, -1, new[] { 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0 }),
    };

    // A cell, or AIR when there is none. Bounds-checks the DECLARED size and
    // the actual arrays — hazard A1: a `Part` that reached here without going
    // through the reader may be ragged, and "shorter than it says" has to mean
    // the same thing as "outside it says" or two implementations disagree about
    // a model neither should have been given. JavaScript reads past the end as
    // `undefined`; C# raises. One answer, and the one the surrounding code
    // already assumes: absent is AIR.
    public static int VoxelAt(Part part, int x, int y, int z)
    {
        if (x < 0 || y < 0 || z < 0) return VoxelRow.Air;
        if (x >= part.Size.W || y >= part.Size.H || z >= part.Size.D) return VoxelRow.Air;
        if (y >= part.Voxels.Count) return VoxelRow.Air;
        IReadOnlyList<IReadOnlyList<int>> layer = part.Voxels[y];
        if (z >= layer.Count) return VoxelRow.Air;
        IReadOnlyList<int> row = layer[z];
        return x >= row.Count ? VoxelRow.Air : row[x];
    }

    // SPEC §7.4: a face is dropped when its neighbour HIDES it. A neighbour
    // hides a face when it is OPAQUE, or when it is the very same palette
    // index.
    //
    // Merely being solid is not enough: a translucent neighbour must not hide
    // an opaque face, or the wall behind a pane of glass loses the face you
    // look at and the glass opens onto a hole. Same index on both sides means a
    // run of one translucent colour is one surface whatever its thickness.
    //
    // Where two DIFFERENT translucent colours meet, both keep their face. That
    // is two quads on one rectangle at one depth, pointing opposite ways, and
    // it is fine: they are wound CCW-from-outside, so back-face culling leaves
    // exactly one of them standing from any given viewpoint — the near one, the
    // one whose colour you are looking through.
    private static bool HiddenBy(int neighbour, int self, bool[] opaque)
    {
        if (neighbour == VoxelRow.Air) return false;
        if (neighbour == self) return true;
        return neighbour < 0 || neighbour >= opaque.Length || opaque[neighbour];
    }

    // The part's OWN palette (`ResolvedPart.Palette`), not a merged one.
    // Merging is a CLI concern that exists so an ASCII grid can spell every
    // colour with one character; a renderer drawing per part never needs it.
    //
    // The mesh comes out in PART-LOCAL space. `scale` and the world transform
    // are applied by the caller, per part, because scale does not propagate to
    // children (§7.7) — see `RigTransform.LocalPointToWorld`.
    public static MeshData BuildMesh(Part part, IReadOnlyList<PaletteEntry> palette)
    {
        if (part is null) throw new ArgumentNullException(nameof(part));
        if (palette is null) throw new ArgumentNullException(nameof(palette));

        var positions = new List<float>();
        var normals = new List<float>();
        var colors = new List<float>();
        var alphas = new List<float>();
        int vertCount = 0;

        // One index run per distinct material. They are sorted by material
        // value at the end, opaque before translucent, which keeps
        // `OpaqueIndexCount` meaning exactly what it always did and makes the
        // material indices reproducible without pinning the voxel walk.
        var buckets = new List<(MeshMaterial Material, List<int> Idx)>();
        var bucketByMaterial = new Dictionary<MeshMaterial, int>();

        List<int> BucketFor(MeshMaterial m)
        {
            if (!bucketByMaterial.TryGetValue(m, out int at))
            {
                at = buckets.Count;
                buckets.Add((m, new List<int>()));
                bucketByMaterial[m] = at;
            }

            return buckets[at].Idx;
        }

        int n = palette.Count;
        var paletteSrgb = new float[n * 3];
        var paletteAlpha = new float[n];
        var paletteOpaque = new bool[n];
        var paletteMaterial = new MeshMaterial[n];
        for (int i = 0; i < n; i++)
        {
            Color c = palette[i].Color;
            // `/ 255f`, never `/ 255` — hazard N1. `Color.R` is a byte, so
            // integer division would make every channel below 255 black.
            paletteSrgb[i * 3] = c.R / 255f;
            paletteSrgb[i * 3 + 1] = c.G / 255f;
            paletteSrgb[i * 3 + 2] = c.B / 255f;
            paletteAlpha[i] = c.A / 255f;
            paletteOpaque[i] = c.A == 255;
            paletteMaterial[i] = new MeshMaterial(palette[i].Material, c.A < 255);
        }

        for (int y = 0; y < part.Size.H; y++)
        {
            for (int z = 0; z < part.Size.D; z++)
            {
                for (int x = 0; x < part.Size.W; x++)
                {
                    int idx = VoxelAt(part, x, y, z);
                    if (idx == VoxelRow.Air) continue;

                    // SPEC §7.4: an index no palette entry defines renders as
                    // OPAQUE MAGENTA. A runtime that only draws still needs an
                    // answer, so the answer is a defined conspicuous colour
                    // rather than a crash or a skipped voxel — cross-file
                    // validation is what reports it (§11.6), and this library
                    // carries no validation. That makes this path LIVE here,
                    // not defensive: the check that refuses such a model lives
                    // in code the port drops.
                    bool known = idx >= 0 && idx < n;
                    float r = known ? paletteSrgb[idx * 3] : 1f;
                    float g = known ? paletteSrgb[idx * 3 + 1] : 0f;
                    float b = known ? paletteSrgb[idx * 3 + 2] : 1f;
                    // An unresolved index is opaque magenta, so it is fully
                    // opaque too — and matte, since there is no entry to read a
                    // material from.
                    float a = known ? paletteAlpha[idx] : 1f;

                    // Resolved on the first face that SURVIVES, not once per
                    // voxel. A fully enclosed voxel emits nothing, and creating
                    // its bucket anyway advertised a material no visible
                    // triangle uses: the mesh reported two materials for a
                    // model with one finish, which flipped the renderer to a
                    // material array plus groups, compiled a shader nothing
                    // drew with, and issued a zero-count draw call.
                    List<int>? into = null;
                    foreach (FaceDef face in Faces)
                    {
                        int neighbour = VoxelAt(part, x + face.Dx, y + face.Dy, z + face.Dz);
                        if (HiddenBy(neighbour, idx, paletteOpaque)) continue;
                        into ??= BucketFor(known ? paletteMaterial[idx] : MatteOpaque);
                        for (int c = 0; c < 4; c++)
                        {
                            positions.Add(x + face.Corners[c * 3]);
                            positions.Add(y + face.Corners[c * 3 + 1]);
                            positions.Add(z + face.Corners[c * 3 + 2]);
                            normals.Add(face.Nx);
                            normals.Add(face.Ny);
                            normals.Add(face.Nz);
                            colors.Add(r);
                            colors.Add(g);
                            colors.Add(b);
                            alphas.Add(a);
                        }

                        into.Add(vertCount);
                        into.Add(vertCount + 1);
                        into.Add(vertCount + 2);
                        into.Add(vertCount);
                        into.Add(vertCount + 2);
                        into.Add(vertCount + 3);
                        vertCount += 4;
                    }
                }
            }
        }

        // SPEC §7.4's ordering: opaque first, then by metallic, roughness,
        // emissive ascending. `OrderBy` because it is STABLE — hazard N8, and
        // reachable here: `CompareMaterials` returns 0 for a pair that differs
        // only in a NaN field, which the buckets keep apart.
        List<(MeshMaterial Material, List<int> Idx)> ordered =
            buckets.OrderBy(bucket => bucket.Material, Comparer<MeshMaterial>.Create(CompareMaterials))
                .ToList();

        var indices = new List<int>();
        var materials = new List<MeshMaterial>();
        var groups = new List<MeshGroup>();
        int opaqueIndexCount = 0;
        foreach ((MeshMaterial material, List<int> idx) in ordered)
        {
            groups.Add(new MeshGroup(indices.Count, idx.Count, materials.Count));
            materials.Add(material);
            // The reference appends one at a time because `push(...idx)` passes
            // every index as an argument, and a bucket over roughly 125k
            // indices — a solid 64³ part, well inside §7.5's 1024 per axis —
            // overflows its call stack. `AddRange` has no such limit, so this
            // is a model the reference cannot read and this port can.
            indices.AddRange(idx);
            if (!material.Translucent) opaqueIndexCount = indices.Count;
        }

        return new MeshData(
            positions.ToArray(),
            normals.ToArray(),
            colors.ToArray(),
            alphas.ToArray(),
            indices.ToArray(),
            vertCount > 65535,
            opaqueIndexCount,
            materials,
            groups);
    }
}
