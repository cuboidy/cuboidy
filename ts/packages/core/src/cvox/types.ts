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

export interface Part {
  name: string;
  size: Size;
  pivot: Pivot;
  sockets: readonly Socket[];
  voxels: readonly (readonly (readonly number[])[])[];
}

export interface Cvox {
  palette: Palette;
  parts: Part[];
}
