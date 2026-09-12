import { AIR } from './geometry/voxel-row.js';
import { MATTE } from './geometry/palette.js';
import type { Material, Palette, Part, Vec3Tuple } from './geometry/types.js';
import { faceOnOpenPlane, type OpenPlane } from './open-boundary.js';
import {
  localPointToWorld,
  quatRotateVec3,
  type WorldTransform,
} from './rig-transform.js';

// Engine-agnostic mesh data for a single Part. Colors are sRGB in 0..1,
// matching the palette's color space (SPEC §7.4). Renderers that need
// linear values (e.g. three.js vertexColors) must convert at upload time.
//
// The output is fully deterministic given (part, palette), but SPEC §7.4 is
// explicit that only the SET of faces is normative — same rectangles, same
// outward normals, same colours, alphas and materials — not the order they
// come out in. This file's y→z→x walk, its face order and its triangulation
// are therefore one valid choice, not the contract. (They used to claim to
// BE the contract, which contradicted §7.4 and would have made greedy
// meshing a spec change.) Compare implementations with a set comparison —
// `cuboidy-query --mesh` prints the canonical form.

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
  // Distinct materials ordered by VALUE (SPEC §7.4): translucent last, then
  // metallic, roughness, emissive ascending. Not first-appearance order —
  // that would depend on the voxel walk, and `MeshGroup.material` is an
  // index into this array, so two implementations walking differently would
  // hand the same face to different materials while both conforming. A
  // model whose palette says nothing about material has exactly one entry,
  // matte and opaque.
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

// SPEC §7.4's material ordering. Total, since two materials comparing equal
// on all four fields are the same material and share a bucket.
//
// Returns a SIGN, never a difference. The three fields are 0..1, so the
// literal C# translation of `return a.metallic - b.metallic` into a
// `Comparison<MeshMaterial>` truncates every real difference to 0 — every
// material then compares equal, the sort is a no-op, and the list silently
// falls back to walk order. That is precisely the failure SPEC §7.4 orders
// the list to prevent, since `MeshGroup.material` is an index into it.
export function compareMaterials(a: MeshMaterial, b: MeshMaterial): number {
  if (a.translucent !== b.translucent) return a.translucent ? 1 : -1;
  // Three-way per field rather than `x < y ? -1 : 1`, so a NaN — which is
  // neither less nor greater — falls through to 0 instead of reporting a
  // material as greater than itself. `materialKey` buckets NaN with NaN, and
  // a comparator that disagreed with the bucketing would order a material
  // list that has two entries the buckets say is one.
  if (a.metallic < b.metallic) return -1;
  if (a.metallic > b.metallic) return 1;
  if (a.roughness < b.roughness) return -1;
  if (a.roughness > b.roughness) return 1;
  if (a.emissive < b.emissive) return -1;
  if (a.emissive > b.emissive) return 1;
  return 0;
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

// A cell, or AIR when there is none. Bounds-checks the DECLARED size and the
// actual arrays: a `Part` that reached here without going through the parser
// may be ragged, and "shorter than it says" has to mean the same thing as
// "outside it says" or two implementations disagree about a model neither
// should have been given.
function voxelAt(part: Part, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0) return AIR;
  if (x >= part.size.w || y >= part.size.h || z >= part.size.d) return AIR;
  return part.voxels[y]?.[z]?.[x] ?? AIR;
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

// SPEC §6.14: the open planes that apply to THIS part, with the rest placement
// that puts its local corners into package space. The mesh still comes out
// part-local; the placement is here only because the plane is stated in
// package coordinates and the test has to be made there.
//
// Rest only, by construction: there is no pose in this object. An open
// boundary is a statement about where the package's outside is, and a part
// that moves takes its faces off the plane — lint H05 says so at authoring
// time, and this signature is why there is nothing to say at runtime.
export interface OpenBoundaryCull {
  planes: readonly OpenPlane[];
  transform: WorldTransform;
  scale?: Vec3Tuple | undefined;
}

export function buildMesh(
  part: Part,
  palette: Palette,
  open?: OpenBoundaryCull,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const alphas: number[] = [];
  let vertCount = 0;

  // One index run per distinct material. They are sorted by material value
  // at the end, opaque before translucent, which keeps `opaqueIndexCount`
  // meaning exactly what it always did and makes the material indices
  // reproducible without pinning the voxel walk.
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

  // Resolved once, not per face: a part with no open boundary must pay
  // nothing at all for this, and one with an open boundary pays a rotate per
  // corner only on the faces that survived neighbour culling.
  const cull =
    open === undefined || open.planes.length === 0 ? null : open;
  const pivot: Vec3Tuple = [part.pivot.pos.x, part.pivot.pos.y, part.pivot.pos.z];

  const paletteSrgb = palette.map(
    (e) => [e.color.r / 255, e.color.g / 255, e.color.b / 255] as const,
  );
  const paletteAlpha = palette.map((e) => e.color.a / 255);
  const paletteOpaque = palette.map((e) => e.color.a === 255);
  const paletteMaterial = palette.map(
    (e): MeshMaterial => ({
      ...e.material,
      translucent: e.color.a < 255,
    }),
  );

  for (let y = 0; y < part.size.h; y++) {
    for (let z = 0; z < part.size.d; z++) {
      for (let x = 0; x < part.size.w; x++) {
        // Through `voxelAt`, not `part.voxels[y]![z]![x]!`. The direct read
        // is only safe while every row is exactly `size.w` wide, which the
        // parser guarantees and `resolveProject`'s `overrides` does not:
        // `buildMesh` is public and takes a caller-supplied `Part`. A 2-wide
        // part with a 1-wide row read `undefined`, compared it against AIR,
        // decided it was solid and painted it magenta — 40 vertices where a
        // single voxel is 24 — while C# raises on the same input. One answer,
        // and the one the surrounding code already assumes: absent is AIR.
        const idx = voxelAt(part, x, y, z);
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
        // Resolved on the first face that SURVIVES, not once per voxel. A
        // fully enclosed voxel emits nothing, and creating its bucket
        // anyway advertised a material no visible triangle uses: the mesh
        // reported two materials for a model with one finish, which flipped
        // the renderer to a material array plus groups, compiled a shader
        // nothing drew with, and issued a zero-count draw call.
        let into: number[] | null = null;
        for (const face of FACES) {
          const n = voxelAt(part, x + face.d[0], y + face.d[1], z + face.d[2]);
          if (hiddenBy(n, idx, paletteOpaque)) continue;
          // §6.14, AFTER the neighbour rule and BEFORE the bucket: a seam
          // face is one nothing hid, and a part every one of whose faces is
          // on the seam must not advertise a material no triangle uses.
          if (
            cull !== null &&
            faceOnOpenPlane(
              cull.planes,
              face.corners.map((c) =>
                localPointToWorld(
                  [x + c[0], y + c[1], z + c[2]],
                  pivot,
                  cull.scale,
                  cull.transform,
                ),
              ),
              quatRotateVec3(cull.transform.quat, face.normal),
            )
          ) {
            continue;
          }
          into ??= bucketFor(paletteMaterial[idx] ?? MATTE_OPAQUE);
          for (const corner of face.corners) {
            positions.push(x + corner[0], y + corner[1], z + corner[2]);
            normals.push(face.normal[0], face.normal[1], face.normal[2]);
            colors.push(r, g, b);
            alphas.push(a);
          }
          into!.push(
            vertCount, vertCount + 1, vertCount + 2,
            vertCount, vertCount + 2, vertCount + 3,
          );
          vertCount += 4;
        }
      }
    }
  }

  // SPEC §7.4's ordering: opaque first, then by metallic, roughness,
  // emissive ascending. Every bucket holds at least one quad, because
  // `bucketFor` is only reached from a face that survived culling.
  const ordered = [...buckets].sort((a, b) =>
    compareMaterials(a.material, b.material),
  );

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
    // Appended one at a time, not spread. `push(...idx)` passes every index
    // as an argument, and a bucket over roughly 125k indices — a solid 64³
    // part, well inside SPEC §7.5's 1024 per axis — overflows the call stack
    // with a RangeError. C#'s `AddRange` has no such limit, so this was a
    // model the reference could not read and a port could.
    for (const i of bucket.idx) indices.push(i);
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
