import { AIR } from './geometry/voxel-row.js';
import { MATTE, isMatte } from './geometry/palette.js';
import type { Material, Palette, Part } from './geometry/types.js';

// Engine-agnostic mesh data for a single Part. Colors are sRGB in 0..1,
// matching the palette's color space (SPEC §10). Renderers that need
// linear values (e.g. three.js vertexColors) must convert at upload time.
//
// The output is fully deterministic given (part, palette) — the iteration
// order, face order, corner winding, and triangulation below ARE the
// reference for parity with other-language implementations (C# etc.).

// One draw's worth of surface: a §7.4 material plus whether its faces need
// the blended pass. `translucent` is not part of the material — it comes
// from the colour's alpha — but it decides the PASS, so a bucket is keyed on
// both. Two entries with the same material, one see-through and one not, are
// two buckets.
export interface MeshMaterial extends Material {
  translucent: boolean;
}

// A contiguous index range and the material to draw it with.
export interface MeshGroup {
  start: number; // offset into `indices`
  count: number;
  material: number; // index into MeshData.materials
}

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
  // Distinct materials in first-appearance order, opaque ones before
  // translucent ones. A model whose palette says nothing about material has
  // exactly one entry, matte and opaque.
  materials: MeshMaterial[];
  // `indices` partitioned by material, in draw order. Ranges are contiguous
  // and cover the whole buffer, so a renderer that ignores materials can
  // ignore `groups` too and still draw the right triangles.
  //
  // Per-vertex would be simpler, but three.js (and most engines) take
  // metalness/roughness as uniforms, not attributes — there is no
  // `vertexMetalness`. Grouping is what lets one part with three finishes be
  // three draws off one buffer instead of a custom shader.
  groups: MeshGroup[];
}

const MATTE_OPAQUE: MeshMaterial = { ...MATTE, translucent: false };

function materialKey(m: MeshMaterial): string {
  return `${m.metallic},${m.roughness},${m.emissive},${m.translucent}`;
}

export function isMatteOpaque(m: MeshMaterial): boolean {
  return !m.translucent && isMatte(m);
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

// SPEC §7.4: a face is dropped when its neighbour HIDES it. A neighbour
// hides a face when it is OPAQUE, or when it is the very same palette index.
//
// Merely being solid is not enough: a translucent neighbour must not hide an
// opaque face, or the wall behind a pane of glass loses the face you look at
// and the glass opens onto a hole. Same index on both sides means a run of
// one translucent colour is one surface whatever its thickness — three
// voxels of water read exactly as one does.
//
// Where two DIFFERENT translucent colours meet, both keep their face. That
// is two quads on one rectangle at one depth, pointing opposite ways, and it
// is fine: they are wound CCW-from-outside, so back-face culling leaves
// exactly one of them standing from any given viewpoint — the near one, the
// one whose colour you are looking through. Keeping only one (as this
// function briefly did) makes the boundary visible from one side and gone
// from the other.
//
// It is worth being blunt about why that experiment happened, because the
// reasoning looked airtight and was wrong. Wedge-shaped artifacts at such an
// interface were traced to "ten quads on the plane, unorderable", and the
// count was real — but a coincident PAIR is never a draw-order problem,
// since culling has already discarded one before ordering is asked about.
// The wedges were the editor blending its translucent faces in mesh-emission
// order instead of back to front, fixed in @cuboidy/ui's translucent-order.
// Halving the quads changed nothing on screen, which the CLI would have said
// immediately: it renders this model identically under either rule.
function hiddenBy(
  neighbour: number,
  self: number,
  opaque: readonly boolean[],
): boolean {
  if (neighbour === AIR) return false;
  if (neighbour === self) return true;
  return opaque[neighbour] ?? true;
}

export function buildMesh(part: Part, palette: Palette): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const alphas: number[] = [];
  let vertCount = 0;

  // One index run per distinct material, in first-appearance order. They are
  // concatenated at the end with every opaque bucket before every translucent
  // one, which keeps `opaqueIndexCount` meaning exactly what it always did.
  const buckets: Array<{ material: MeshMaterial; idx: number[] }> = [];
  const bucketByKey = new Map<string, number>();
  const bucketFor = (m: MeshMaterial): number[] => {
    const key = materialKey(m);
    let at = bucketByKey.get(key);
    if (at === undefined) {
      at = buckets.length;
      buckets.push({ material: m, idx: [] });
      bucketByKey.set(key, at);
    }
    return buckets[at]!.idx;
  };

  const paletteSrgb = palette.map((c) => [c.r / 255, c.g / 255, c.b / 255] as const);
  const paletteAlpha = palette.map((c) => c.a / 255);
  const paletteOpaque = palette.map((c) => c.a === 255);
  const paletteMaterial = palette.map(
    (c): MeshMaterial => ({
      metallic: c.metallic,
      roughness: c.roughness,
      emissive: c.emissive,
      translucent: c.a < 255,
    }),
  );

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
        // An unresolved index is opaque magenta, so it is fully opaque too —
        // and matte, since there is no entry to read a material from.
        const a = paletteAlpha[idx] ?? 1;
        const into = bucketFor(paletteMaterial[idx] ?? MATTE_OPAQUE);
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

  // Opaque buckets first, then translucent, each keeping first-appearance
  // order within its pass. An empty bucket cannot occur — one is created only
  // when a face lands in it.
  const ordered = [
    ...buckets.filter((b) => !b.material.translucent),
    ...buckets.filter((b) => b.material.translucent),
  ];

  const indices: number[] = [];
  const materials: MeshMaterial[] = [];
  const groups: MeshGroup[] = [];
  let opaqueIndexCount = 0;
  for (const bucket of ordered) {
    groups.push({
      start: indices.length,
      count: bucket.idx.length,
      material: materials.length,
    });
    materials.push(bucket.material);
    indices.push(...bucket.idx);
    if (!bucket.material.translucent) opaqueIndexCount = indices.length;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    alphas: new Float32Array(alphas),
    indices: vertCount > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    opaqueIndexCount,
    materials,
    groups,
  };
}
