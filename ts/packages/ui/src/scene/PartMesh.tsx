import { useEffect, useMemo, useRef } from 'react';
import type { Palette, Part } from '@cuboidy/core';
import { Mesh, MeshStandardMaterial } from 'three';
import { noRaycast } from './gizmo-primitives.js';
import { buildPartGeometry } from './part-geometry.js';
import { makeTranslucentSorter } from './translucent-order.js';

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
  const meshRef = useRef<Mesh>(null);
  const { geometry, hasTranslucent, opaqueIndexCount } = useMemo(
    () => buildPartGeometry(part, palette),
    [part, palette],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Back-to-front ordering for the blended range. See translucent-order.ts:
  // three.js sorts transparent objects, not the triangles within one, and
  // core's own renderer does sort — so without this the editor and
  // `cuboidy-snap` disagree about the same model.
  const sortTranslucent = useMemo(
    () =>
      makeTranslucentSorter(() => meshRef.current, geometry, opaqueIndexCount),
    [geometry, opaqueIndexCount],
  );

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
      ref={meshRef}
      geometry={geometry}
      material={materials}
      onBeforeRender={sortTranslucent}
      raycast={raycastDisabled === true ? noRaycast : meshRaycast}
    />
  );
}
