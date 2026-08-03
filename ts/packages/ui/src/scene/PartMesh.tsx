import { useEffect, useMemo } from 'react';
import { buildMesh, type Palette, type Part } from '@cuboidy/core';
import { BufferAttribute, BufferGeometry, Mesh } from 'three';
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
  const geometry = useMemo(() => {
    // buildMesh emits sRGB (matching the palette's color space — SPEC
    // §10); vertex colors need the linear form (see gizmo-primitives).
    const mesh = buildMesh(part, palette);
    const linearColors = srgbToLinearArray(mesh.colors);
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    geom.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    geom.setAttribute('color', new BufferAttribute(linearColors, 3));
    geom.setIndex(new BufferAttribute(mesh.indices, 1));
    return geom;
  }, [part, palette]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      raycast={raycastDisabled === true ? noRaycast : meshRaycast}
    >
      <meshStandardMaterial vertexColors />
    </mesh>
  );
}
