import { AIR, type Palette, type Part } from '@cuboidy/core';

interface Props {
  part: Part;
  palette: Palette;
}

// Renders a Part as one <mesh> per non-AIR voxel. Naive but correct.
// For the A1 viewer this is fine — real models are under ~200 voxels
// and React's reconciler handles that count without trouble. When edit
// features land and per-voxel cost matters (rotation animations on
// 1000+ voxel rigs), the per-cell <mesh> will be swapped for one
// THREE.InstancedMesh per part with a single material.
//
// Cube positioning: a voxel at integer (x, y, z) occupies the unit
// cell [x, x+1) × [y, y+1) × [z, z+1), so its center is at
// (x+0.5, y+0.5, z+0.5). This matches the SPEC convention that
// pivots and sockets use the same continuous coordinate system as
// the bounding box (§7.7 pivot, §7.8 socket).

export function PartMesh({ part, palette }: Props) {
  const cubes = [];
  for (let y = 0; y < part.size.h; y++) {
    const layer = part.voxels[y]!;
    for (let z = 0; z < part.size.d; z++) {
      const row = layer[z]!;
      for (let x = 0; x < part.size.w; x++) {
        const idx = row[x]!;
        if (idx === AIR) continue;
        const c = palette[idx]!;
        const hex = (c.r << 16) | (c.g << 8) | c.b;
        cubes.push(
          <mesh
            key={`${x},${y},${z}`}
            position={[x + 0.5, y + 0.5, z + 0.5]}
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={hex} />
          </mesh>,
        );
      }
    }
  }
  return <>{cubes}</>;
}
