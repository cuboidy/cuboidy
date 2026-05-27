import { useEffect, useMemo } from 'react';
import { AIR, type Palette, type Part } from '@cuboidy/core';
import { BufferAttribute, BufferGeometry, Color, SRGBColorSpace } from 'three';

interface Props {
  part: Part;
  palette: Palette;
}

// Renders a Part as a single merged BufferGeometry. For each non-AIR
// voxel we emit only the faces whose neighbor is AIR or out of bounds —
// faces sandwiched between two solid voxels are skipped. Per-vertex
// colors come from the palette, drawn with one meshStandardMaterial.
//
// Voxel cell convention: integer (x, y, z) occupies the unit cell
// [x, x+1) × [y, y+1) × [z, z+1), matching SPEC §7.7 / §7.8 where
// pivots and sockets share the bounding box's continuous coordinates.

interface FaceDef {
  readonly normal: readonly [number, number, number];
  readonly d: readonly [number, number, number];
  readonly corners: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
}

// Corners are listed CCW when viewed from outside the cube, so the
// default front-face winding produces outward-facing triangles.
const FACES: readonly FaceDef[] = [
  { normal: [1, 0, 0], d: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { normal: [-1, 0, 0], d: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { normal: [0, 1, 0], d: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { normal: [0, -1, 0], d: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [0, 0, 1], d: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { normal: [0, 0, -1], d: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

function voxelAt(part: Part, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0) return AIR;
  if (x >= part.size.w || y >= part.size.h || z >= part.size.d) return AIR;
  return part.voxels[y]![z]![x]!;
}

function buildGeometry(part: Part, palette: Palette): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vertCount = 0;

  // Palette entries are sRGB; vertex-color attributes are interpreted
  // as linear, so convert once per palette index to match the colors
  // material.color={hex} would have produced.
  const tmp = new Color();
  const paletteLinear = palette.map((c) => {
    tmp.setRGB(c.r / 255, c.g / 255, c.b / 255, SRGBColorSpace);
    return [tmp.r, tmp.g, tmp.b] as const;
  });

  for (let y = 0; y < part.size.h; y++) {
    for (let z = 0; z < part.size.d; z++) {
      for (let x = 0; x < part.size.w; x++) {
        const idx = part.voxels[y]![z]![x]!;
        if (idx === AIR) continue;
        const [r, g, b] = paletteLinear[idx]!;
        for (const face of FACES) {
          if (voxelAt(part, x + face.d[0], y + face.d[1], z + face.d[2]) !== AIR) continue;
          for (const corner of face.corners) {
            positions.push(x + corner[0], y + corner[1], z + corner[2]);
            normals.push(face.normal[0], face.normal[1], face.normal[2]);
            colors.push(r, g, b);
          }
          indices.push(
            vertCount, vertCount + 1, vertCount + 2,
            vertCount, vertCount + 2, vertCount + 3,
          );
          vertCount += 4;
        }
      }
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geom.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  const indexArray = vertCount > 65535
    ? new Uint32Array(indices)
    : new Uint16Array(indices);
  geom.setIndex(new BufferAttribute(indexArray, 1));
  return geom;
}

export function PartMesh({ part, palette }: Props) {
  const geometry = useMemo(() => buildGeometry(part, palette), [part, palette]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors />
    </mesh>
  );
}
