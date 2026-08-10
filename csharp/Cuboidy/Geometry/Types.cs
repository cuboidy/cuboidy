// Port of ts/packages/core/src/geometry/types.ts.
//
// Public data model for a geometry file, decoded. These types are the contract
// this package exposes and are deliberately independent of the container: the
// reader produces them, and mesh / rig / the sampler only ever see this shape.
//
// Hierarchy: Vec3 → {Color/Material/PaletteEntry/Palette, Size, Pivot,
// Socket} → Part → Geometry.

using System.Collections.Generic;

namespace Cuboidy;

// The §4 triple.
//
// `Vec3Tuple` — TypeScript's positional spelling of this same triple, used by
// the rig and the sampler where `{x, y, z}` is used by the file format — has
// no separate declaration here, because a positional record already IS both
// spellings: `new Vec3(1, 2, 3)`, `v.X`, and `var (x, y, z) = v` are one type.
// TypeScript needs two because a tuple and an interface are different types
// there; that is the reason `types.ts` gives for holding the second one beside
// the first (there used to be two `Vec3Tuple` declarations, and C# could not
// have had two `Cuboidy.Vec3Tuple`). Unifying is what that comment asks for,
// not the "simplifying a signature" hazard T4 warns against.
public readonly record struct Vec3(double X, double Y, double Z);

// 0..255 per channel, as the file spells them.
//
// `byte` rather than `int` is the truthful range, and it makes hazard N1
// louder rather than quieter: `Color.R / 255` is integer division and yields 0
// for every channel below 255. Every conversion to a 0..1 float divides by
// `255.0`.
public readonly record struct Color(byte R, byte G, byte B, byte A);

// SPEC §7.4 surface response — how a color reacts to light, as opposed to
// what colour it is. One set per palette entry.
//
// Names follow glTF 2.0's metal-rough workflow, which Unity, Godot and
// three.js all consume without translation. `Emissive` scales the entry's OWN
// colour instead of carrying a second one: a voxel that glows a different
// colour than its surface is rare enough to leave for later, and a second
// colour would double what an author has to write for the common case. glTF's
// `emissiveFactor` is then `color × emissive`.
//
// Every field is required rather than optional. An optional field in a
// cross-implementation contract is a second chance to disagree about the
// default, and the reader fills these in from ONE place. Note that
// `Roughness`'s §7.4 default is 1 while `default(double)` is 0 — hazard T2 —
// so the reader's DTO holds nullable fields and defaults them before building
// one of these.
public readonly record struct Material(
    double Metallic,  // 0..1, 0 = dielectric, 1 = metal
    double Roughness, // 0..1, 0 = mirror, 1 = fully diffuse
    double Emissive); // 0..1, scales `Color` as self-illumination

// A palette slot: the colour, and how it responds to light.
//
// COMPOSED, not flattened. A flat record mixes units — r/g/b/a are 0..255
// integers, metallic/roughness/emissive are 0..1 floats — and nothing in the
// type says which is which. It also makes the hex codec's boundary real:
// `Palette.ParseHexColor` deals in `Color` and never sees a material.
public readonly record struct PaletteEntry(Color Color, Material Material);

// SPEC §7 `Palette` is `IReadOnlyList<PaletteEntry>`. TypeScript names the
// alias; C# type aliases are file-scoped, so the list type is spelled out at
// each use rather than exported under a name that would not travel.

public readonly record struct Size(int W, int H, int D);

public readonly record struct Pivot(Vec3 Pos, Vec3? Rot);

public sealed record Socket(string Name, Vec3 Pos, Vec3? Rot);

public sealed record Part(
    string Name,
    Size Size,
    Pivot Pivot,
    IReadOnlyList<Socket> Sockets,
    // [y][z][x] — layers, rows, cells. Read through `Mesh.VoxelAt`, which
    // treats an absent cell as AIR rather than raising: hazard A1, and the
    // reason it matters is that a caller can hand `BuildMesh` a part this
    // library never validated.
    IReadOnlyList<IReadOnlyList<IReadOnlyList<int>>> Voxels);

public sealed record Geometry(
    // SPEC §7.4: the file's colors. An EMPTY list means the file declared no
    // palette — a declared palette always has ≥ 1 color, so length 0 is
    // unambiguous — OR that it declared a palette reference and the project
    // layer has not resolved it yet.
    IReadOnlyList<PaletteEntry> Palette,
    // SPEC §7.4: set when the file spelled its `palette` as a §8 reference to
    // a palette file (§6.10) instead of an inline array. The two are
    // alternative forms of ONE document field, so no precedence rule is
    // needed: a file either lists its colors or points at a file that does.
    // Resolution belongs to the project layer, which fills `Palette` in — so
    // every consumer downstream of it reads colors the same way regardless of
    // where they were written.
    string? PaletteRef,
    IReadOnlyList<Part> Parts);
