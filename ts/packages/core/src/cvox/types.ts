// Public data model for the cvox file format. These interfaces are the
// contract this package exposes (re-exported via the top-level index.ts);
// parser implementations consume / produce these shapes but never declare
// them. Internal intermediate types (ParsedPart, RawRow, etc.) stay in
// their respective parser files since they're not part of the API.
//
// Hierarchy: Vec3 → {Color/Palette, Size, Pivot, Socket} → Part → Cvox.

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

export type Palette = readonly Color[];

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

// SPEC §7.5.1: a part-reuse reference. `clone` reuses another part's
// geometry verbatim; `mirror` reuses it reflected across the named local
// axis. It is a declarative reference (like SVG <use>), NOT a function:
// no chaining (the referent must be a concrete part), no composition, a
// closed transform set, and one-pass resolution to plain voxel data.
export interface PartRef {
  // Name of the concrete part whose geometry is reused.
  part: string;
  // Mirror axis (local grid axis). Absent → `clone` (verbatim reuse);
  // present → `mirror` reflected across the plane perpendicular to this axis.
  mirror?: 'x' | 'y' | 'z';
}

export interface Part {
  name: string;
  // When present, size/pivot/sockets/voxels are DERIVED from `from.part`
  // (optionally reflected). Assembly fills the derived geometry; the
  // serializer re-emits the `clone`/`mirror` form rather than expanding.
  from?: PartRef;
  size: Size;
  pivot: Pivot;
  sockets: readonly Socket[];
  voxels: readonly (readonly (readonly number[])[])[];
}

export interface Cvox {
  // SPEC §7.X file header: comment lines appearing before the first
  // declaration are captured verbatim (including their leading `//`).
  // Interspersed blank lines between header comments are preserved;
  // leading and trailing blank lines (before / between the last header
  // comment and the first declaration) are trimmed. Absent when the
  // file has no header comments; never an empty array.
  header?: readonly string[];
  // SPEC §7.4 (v0.7): at most one palette declaration per file. An EMPTY
  // array means the file declared no palette — a declared palette always
  // has ≥ 1 color, so length 0 is unambiguous. Palette-less files rely on
  // a manifest-bound external palette (§6.10); their voxel index-range
  // validation moves to cross-file lint. The serializer emits no palette
  // line for an empty array (round-trips to absent).
  palette: Palette;
  parts: Part[];
}
