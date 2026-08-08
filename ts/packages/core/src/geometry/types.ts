// Public data model for a geometry file, decoded. These interfaces are the
// contract this package exposes (re-exported via the top-level index.ts) and
// are deliberately independent of the container: the reader produces them, the
// writer consumes them, and lint / mesh / render / the editor only ever see
// this shape.
//
// Hierarchy: Vec3 → {Color/Material/PaletteEntry/Palette, Size, Pivot,
// Socket} → Part → Geometry.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

// SPEC §7.4 surface response — how a color reacts to light, as opposed to
// what colour it is. One set per palette entry.
//
// Names follow glTF 2.0's metal-rough workflow, which Unity, Godot and
// three.js all consume without translation. `emissive` scales the entry's
// OWN colour instead of carrying a second one: a voxel that glows a
// different colour than its surface is rare enough to leave for later, and
// a second colour would double what an author has to write for the common
// case. glTF's `emissiveFactor` is then `color × emissive`.
//
// Every field is required rather than optional. An optional field in a
// cross-implementation contract is a second chance to disagree about the
// default, and the reader fills these in from ONE place (paletteEntryFrom).
export interface Material {
  metallic: number; // 0..1, 0 = dielectric, 1 = metal
  roughness: number; // 0..1, 0 = mirror, 1 = fully diffuse
  emissive: number; // 0..1, scales `color` as self-illumination
}

// A palette slot: the colour, and how it responds to light. Extends Color so
// the hex codec (parseHexColor / serializeColor) keeps dealing in colours
// only — the material rides alongside, it is not part of the colour value.
export interface PaletteEntry extends Color, Material {}

export type Palette = readonly PaletteEntry[];

export interface Size {
  w: number;
  h: number;
  d: number;
}

export interface Pivot {
  pos: Vec3;
  rot?: Vec3;
}

export interface Socket {
  name: string;
  pos: Vec3;
  rot?: Vec3;
}

export interface Part {
  name: string;
  size: Size;
  pivot: Pivot;
  sockets: readonly Socket[];
  voxels: readonly (readonly (readonly number[])[])[];
}

export interface Geometry {
  // SPEC §7.4: the file's colors. An EMPTY array means the file declared no
  // palette — a declared palette always has ≥ 1 color, so length 0 is
  // unambiguous — OR that it declared `paletteRef` and the project layer has
  // not resolved it yet. The writer omits the key for an empty array, so
  // absence round-trips.
  palette: Palette;
  // SPEC §7.4: set when the file spelled its `palette` as a §8 reference to a
  // palette file (§6.10) instead of an inline array. The two are alternative
  // forms of ONE document field, so no precedence rule is needed: a file
  // either lists its colors or points at a file that does. Resolution belongs
  // to the project layer (resolveProject), which fills `palette` in — so
  // every consumer downstream of it reads colors the same way regardless of
  // where they were written.
  paletteRef?: string;
  parts: Part[];
}
