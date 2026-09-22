import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Palette, Part } from '@cuboidy/core';
import { Mesh } from 'three';
import {
  buildPartGeometry,
  buildPartMaterials,
  disposeMaterials,
  makeTranslucentSorter,
  noRaycast,
} from '@cuboidy/three';

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
  const built = useMemo(
    () => buildPartGeometry(part, palette),
    [part, palette],
  );
  const { geometry, opaqueIndexCount } = built;
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Back-to-front ordering for the blended range. See translucent-order.ts:
  // three.js sorts transparent objects, not the triangles within one, and
  // core's own renderer does sort — so without this the editor and
  // `cuboidy-snap` disagree about the same model.
  //
  // Driven from `useFrame`, not `onBeforeRender`. r3f runs priority-0
  // subscribers before its own `gl.render`, which is the only point early
  // enough: three reads `geometry.groups` in `projectObject`, before any
  // object's `onBeforeRender` fires.
  const sortTranslucent = useMemo(
    () =>
      makeTranslucentSorter(
        () => meshRef.current,
        geometry,
        opaqueIndexCount,
        built.translucentQuadMaterials,
      ),
    [geometry, opaqueIndexCount, built.translucentQuadMaterials],
  );

  // Built here rather than declared as children. r3f attaches a material
  // child to `material`, so TWO of them means the second REPLACES the first
  // — the mesh keeps only the translucent one, every face draws with depth
  // writes off, opaque geometry stops occluding anything, and translucent
  // faces behind it come through in front. `attach="material-0"` does not
  // help either: an index path needs `material` to already be an array, and
  // a Mesh starts life with a single material.
  //
  // One material per §7.4 bucket, and a BARE material rather than a
  // one-element array when there is only one — an array against a geometry
  // whose groups were left off draws nothing at all, and the single-bucket
  // case is every model that says nothing about materials.
  const materials = useMemo(() => {
    const list = buildPartMaterials(built.materials);
    return list.length === 1 ? list[0]! : list;
  }, [built.materials]);
  useEffect(
    () => () =>
      disposeMaterials(Array.isArray(materials) ? materials : [materials]),
    [materials],
  );

  useFrame(({ camera }) => sortTranslucent(camera));

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={materials}
      raycast={raycastDisabled === true ? noRaycast : meshRaycast}
    />
  );
}
