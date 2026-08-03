// Strip float noise to six decimals — enough that a 90° parent rotation
// (whose quaternion arithmetic leaves ~1e-16 residue) lands children on
// exact world coordinates, and coarse enough to be stable as a map key.
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
