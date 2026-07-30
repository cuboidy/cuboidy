import { AIR } from './geometry/voxel-row.js';
import type { Palette, Part } from './geometry/types.js';

// Engine-agnostic mesh data for a single Part. Colors are sRGB in 0..1,
// matching the palette's color space (SPEC §10). Renderers that need
// linear values (e.g. three.js vertexColors) must convert at upload time.
//
// The output is fully deterministic given (part, palette) — the iteration
// order, face order, corner winding, and triangulation below ARE the
// reference for parity with other-language implementations (C# etc.).
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint16Array | Uint32Array;
}

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

// Corners listed CCW when viewed from outside the cube, so default
// front-face winding produces outward-facing triangles. Face order
// is +X, -X, +Y, -Y, +Z, -Z. Quad is triangulated as (0,1,2)+(0,2,3).
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

export function buildMesh(part: Part, palette: Palette): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let vertCount = 0;

  const paletteSrgb = palette.map((c) => [c.r / 255, c.g / 255, c.b / 255] as const);

  for (let y = 0; y < part.size.h; y++) {
    for (let z = 0; z < part.size.d; z++) {
      for (let x = 0; x < part.size.w; x++) {
        const idx = part.voxels[y]![z]![x]!;
        if (idx === AIR) continue;
        // Out-of-range index: possible when a shorter manifest-bound
        // palette (SPEC §6.10) replaces the inline one, or while a
        // palette-less file awaits its binding. Render magenta — visible
        // as "unresolved color", never a crash. Cross-file lint flags it.
        const [r, g, b] = paletteSrgb[idx] ?? ([1, 0, 1] as const);
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

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: vertCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
  };
}
