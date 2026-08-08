import { useEffect, useMemo } from 'react';
import { buildMesh, type Palette, type Part } from '@cuboidy/core';
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { noRaycast, srgbToLinearArray } from './gizmo-primitives.js';

interface Props {
  part: Part;
  palette: Palette;
  // Disable hit-testing — used mid voxel-stroke, when the invisible
  // start-of-stroke snapshot must be the ONLY raycast target (a fresh
  // in-bounds attach joins this mesh instantly, and letting it take
  // hits would let a drag stack voxels onto its own output).
  raycastDisabled?: boolean | undefined;
}

const meshRaycast = Mesh.prototype.raycast;

export function PartMesh({ part, palette, raycastDisabled }: Props) {
  const { geometry, hasTranslucent } = useMemo(() => {
    // buildMesh emits sRGB (matching the palette's color space — SPEC
    // §10); vertex colors need the linear form (see gizmo-primitives).
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
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    geom.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    geom.setAttribute('color', new BufferAttribute(rgba, 4));
    geom.setIndex(new BufferAttribute(mesh.indices, 1));

    // `buildMesh` orders the indices opaque-first precisely so the two
    // passes are two ranges of one buffer. Groups keep it that way — one
    // upload, one draw order, and the translucent material never touches
    // the depth buffer, so faces behind it survive.
    const opaque = mesh.opaqueIndexCount;
    const blended = mesh.indices.length - opaque;
    if (blended > 0) {
      geom.addGroup(0, opaque, 0);
      geom.addGroup(opaque, blended, 1);
    }
    return { geometry: geom, hasTranslucent: blended > 0 };
  }, [part, palette]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Built here rather than declared as children. r3f attaches a material
  // child to `material`, so TWO of them means the second REPLACES the first
  // — the mesh keeps only the translucent one, every face draws with depth
  // writes off, opaque geometry stops occluding anything, and translucent
  // faces behind it come through in front. `attach="material-0"` does not
  // help either: an index path needs `material` to already be an array, and
  // a Mesh starts life with a single material.
  //
  // A single material when nothing is translucent, deliberately, because a
  // one-element ARRAY would pair with a geometry that has no groups and
  // three.js would draw nothing at all.
  const materials = useMemo(
    () =>
      hasTranslucent
        ? [
            new MeshStandardMaterial({ vertexColors: true }),
            new MeshStandardMaterial({
              vertexColors: true,
              transparent: true,
              // Depth TEST stays on — a translucent face behind something
              // opaque must still be rejected. Only the WRITE is off, so
              // translucent faces do not occlude one another.
              depthWrite: false,
            }),
          ]
        : new MeshStandardMaterial({ vertexColors: true }),
    [hasTranslucent],
  );
  useEffect(
    () => () => {
      for (const m of Array.isArray(materials) ? materials : [materials]) {
        m.dispose();
      }
    },
    [materials],
  );

  return (
    <mesh
      geometry={geometry}
      material={materials}
      raycast={raycastDisabled === true ? noRaycast : meshRaycast}
    />
  );
}
