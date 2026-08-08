import { buildMesh, type Palette, type Part } from '@cuboidy/core';
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
  // Index range [0, opaqueIndexCount) is group 0 and wants depth writes;
  // the rest is group 1 and wants blending. Groups are only added when
  // there IS a second range — a one-element material array against a
  // geometry with no groups draws nothing at all.
  opaqueIndexCount: number;
  hasTranslucent: boolean;
}

export function buildPartGeometry(part: Part, palette: Palette): PartGeometry {
  // buildMesh emits sRGB (matching the palette's color space — SPEC §10);
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

  // `buildMesh` orders the indices opaque-first precisely so the two passes
  // are two ranges of one buffer. Groups keep it that way — one upload, one
  // draw order, and the translucent material never touches the depth
  // buffer, so faces behind it survive.
  const opaqueIndexCount = mesh.opaqueIndexCount;
  const blended = mesh.indices.length - opaqueIndexCount;
  if (blended > 0) {
    geometry.addGroup(0, opaqueIndexCount, 0);
    geometry.addGroup(opaqueIndexCount, blended, 1);
  }
  return { geometry, opaqueIndexCount, hasTranslucent: blended > 0 };
}
