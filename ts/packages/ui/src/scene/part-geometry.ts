import {
  buildMesh,
  type MeshMaterial,
  type Palette,
  type Part,
} from '@cuboidy/core';
import { BufferAttribute, BufferGeometry } from 'three';
import { srgbToLinearArray } from './gizmo-primitives.js';

// core's MeshData → a three.js BufferGeometry, in ONE place.
//
// Two callers used to do this themselves — PartMesh for the live scene and
// the workspace's thumbnail renderer — and they drifted: the thumbnail
// never read `alphas` or `opaqueIndexCount`, so a translucent model was a
// solid one on its library card, under a comment promising the card could
// not disagree with the scene view.

export interface PartGeometry {
  geometry: BufferGeometry;
  // Boundary between the depth-writing prefix and the blended remainder.
  opaqueIndexCount: number;
  hasTranslucent: boolean;
  // One per §7.4 material `buildMesh` found, in the order the geometry's
  // groups reference them. Feed to buildPartMaterials; the resulting array
  // is what a Mesh's `material` wants.
  materials: MeshMaterial[];
  // Material index per translucent QUAD, in buffer order. The sorter needs
  // it to rebuild group boundaries after a depth sort reshuffles which
  // material sits where.
  translucentQuadMaterials: Uint16Array;
}

export function buildPartGeometry(part: Part, palette: Palette): PartGeometry {
  // buildMesh emits sRGB (matching the palette's color space — SPEC §7.4);
  // three's vertex-color path bypasses colour management, so the
  // conversion to linear is ours to make (see gizmo-primitives).
  const mesh = buildMesh(part, palette);
  const linear = srgbToLinearArray(mesh.colors);
  // SPEC §7.4 opacity rides the palette entry, so it is per-vertex here.
  // three.js reads a four-component `color` attribute as RGBA when the
  // material is `transparent`, which is why the two arrays are woven
  // together rather than uploaded separately.
  const rgba = new Float32Array((linear.length / 3) * 4);
  for (let i = 0, o = 0; i < linear.length; i += 3, o += 4) {
    rgba[o] = linear[i]!;
    rgba[o + 1] = linear[i + 1]!;
    rgba[o + 2] = linear[i + 2]!;
    rgba[o + 3] = mesh.alphas[i / 3]!;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new BufferAttribute(rgba, 4));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));

  // `buildMesh` partitions the index buffer by material, opaque buckets
  // before translucent ones. Groups mirror that partition exactly — one
  // upload, one draw order, and the translucent materials never touch the
  // depth buffer, so faces behind them survive.
  //
  // Groups are added only when there is more than one material. It is a
  // material ARRAY against a geometry with NO groups that draws nothing in
  // three.js — `projectObject` iterates `geometry.groups` when the material
  // is an array, so an empty list means nothing gets pushed. The
  // single-material case therefore passes a bare material instead (see
  // PartMesh) and needs no groups. That is every model saying nothing
  // about §7.4 materials, which is most of them.
  const opaqueIndexCount = mesh.opaqueIndexCount;
  const blended = mesh.indices.length - opaqueIndexCount;
  if (mesh.materials.length > 1) {
    for (const g of mesh.groups) geometry.addGroup(g.start, g.count, g.material);
  }

  // Which material each translucent quad belongs to, flattened out of the
  // groups so the sorter can permute quads freely and put the boundaries
  // back afterwards.
  const quadMaterials = new Uint16Array(blended / 6);
  for (const g of mesh.groups) {
    if (g.start < opaqueIndexCount) continue;
    const from = (g.start - opaqueIndexCount) / 6;
    quadMaterials.fill(g.material, from, from + g.count / 6);
  }

  return {
    geometry,
    opaqueIndexCount,
    hasTranslucent: blended > 0,
    materials: mesh.materials,
    translucentQuadMaterials: quadMaterials,
  };
}
