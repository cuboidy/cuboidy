// Shared 3-component vector. Used for both positions (voxel units) and
// rotations (Euler degrees, ZXY order per SPEC §4). TypeScript is structural,
// so this is one type — distinction is carried by field names (`pos` / `rot`)
// on the enclosing interface, not by nominal type.
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
