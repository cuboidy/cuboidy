// Public data model for a geometry file, decoded. These interfaces are the
// contract this package exposes (re-exported via the top-level index.ts) and
// are deliberately independent of the container: the reader produces them, the
// writer consumes them, and lint / mesh / render / the editor only ever see
// this shape.
//
// Hierarchy: Vec3 → {Color/Palette, Size, Pivot, Socket} → Part → Geometry.

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

export interface Part {
  name: string;
  size: Size;
  pivot: Pivot;
  sockets: readonly Socket[];
  voxels: readonly (readonly (readonly number[])[])[];
}

export interface Geometry {
  // SPEC §7.4: at most one palette per file. An EMPTY array means the file
  // declared none — a declared palette always has ≥ 1 color, so length 0 is
  // unambiguous. Palette-less files rely on a manifest-bound external palette
  // (§6.10); their voxel index-range validation moves to cross-file lint. The
  // writer omits the key for an empty array, so absence round-trips.
  palette: Palette;
  parts: Part[];
}
