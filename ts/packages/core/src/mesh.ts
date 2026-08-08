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
  // SPEC §7.4 opacity, 0..1, one per vertex. Constant across a face, since
  // it comes from the voxel's palette entry. Kept beside `colors` rather
  // than folded into it so a consumer that only draws opaque models can
  // ignore it and keep its three-float stride.
  alphas: Float32Array;
  indices: Uint16Array | Uint32Array;
  // Indices are ordered OPAQUE FIRST: draw `[0, opaqueIndexCount)` with
  // depth writes on, then the remainder blended, back to front, with depth
  // writes off. A model with no translucent color has
  // `opaqueIndexCount === indices.length` and needs no second pass.
  opaqueIndexCount: number;
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

// SPEC §7.4: a face is dropped only when its neighbour HIDES it. A
// neighbour hides a face when it is OPAQUE, or when both it and this voxel
// are translucent.
//
// The opaque half is what keeps a wall visible behind a pane of glass:
// dropping a face because the neighbour is merely solid would leave the
// glass looking onto a hole.
//
// The translucent half is the same rule as "a run of one colour is one
// surface, whatever its thickness" — generalised past one colour, because
// the seam does not care whether the two are the same. Two translucent
// voxels meeting produce an interface face, a ray crossing it picks up a
// whole extra coat of tint, and a viewer at an angle sees a distinct band
// along the join that is darker than either colour. What you see through a
// translucent body is its outer shell: one coat, from the face you cross.
//
// The cost is that a translucent voxel entirely surrounded by other
// translucent voxels has no faces at all, so a differently-coloured core
// inside a block of glass does not show. Enclosing it in air, or making it
// opaque, is how you get it back.
function hiddenBy(
  neighbour: number,
  self: number,
  opaque: readonly boolean[],
): boolean {
  if (neighbour === AIR) return false;
  // An unresolved index draws opaque magenta, so it hides like one.
  if (opaque[neighbour] ?? true) return true;
  return !(opaque[self] ?? true);
}

export function buildMesh(part: Part, palette: Palette): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const alphas: number[] = [];
  // Two index runs, concatenated at the end so the opaque pass is a prefix.
  const opaqueIdx: number[] = [];
  const blendIdx: number[] = [];
  let vertCount = 0;

  const paletteSrgb = palette.map((c) => [c.r / 255, c.g / 255, c.b / 255] as const);
  const paletteAlpha = palette.map((c) => c.a / 255);
  const paletteOpaque = palette.map((c) => c.a === 255);

  for (let y = 0; y < part.size.h; y++) {
    for (let z = 0; z < part.size.d; z++) {
      for (let x = 0; x < part.size.w; x++) {
        const idx = part.voxels[y]![z]![x]!;
        if (idx === AIR) continue;
        // SPEC §7.4: an index no palette entry defines renders as opaque
        // magenta. A runtime that only draws still needs an answer, so the
        // answer is a defined conspicuous color rather than a crash or a
        // skipped voxel — cross-file validation is what reports it (§11.6),
        // and a runtime carries no validation. Ports must match this, not
        // index into their palette and throw.
        const [r, g, b] = paletteSrgb[idx] ?? ([1, 0, 1] as const);
        // An unresolved index is opaque magenta, so it is fully opaque too.
        const a = paletteAlpha[idx] ?? 1;
        const into = a < 1 ? blendIdx : opaqueIdx;
        for (const face of FACES) {
          const n = voxelAt(part, x + face.d[0], y + face.d[1], z + face.d[2]);
          if (hiddenBy(n, idx, paletteOpaque)) continue;
          for (const corner of face.corners) {
            positions.push(x + corner[0], y + corner[1], z + corner[2]);
            normals.push(face.normal[0], face.normal[1], face.normal[2]);
            colors.push(r, g, b);
            alphas.push(a);
          }
          into.push(
            vertCount, vertCount + 1, vertCount + 2,
            vertCount, vertCount + 2, vertCount + 3,
          );
          vertCount += 4;
        }
      }
    }
  }

  const indices = [...opaqueIdx, ...blendIdx];
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    alphas: new Float32Array(alphas),
    indices: vertCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    opaqueIndexCount: opaqueIdx.length,
  };
}
