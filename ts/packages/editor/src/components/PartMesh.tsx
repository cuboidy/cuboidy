import { useEffect, useMemo } from 'react';
import { buildMesh, type Palette, type Part } from '@cuboidy/core';
import { BufferAttribute, BufferGeometry } from 'three';

interface Props {
  part: Part;
  palette: Palette;
}

// three.js interprets vertex-color attributes as linear, but buildMesh
// emits sRGB (matching the palette's color space — SPEC §10). Convert
// in place once per geometry so the result matches what
// material.color={hex} would have produced.
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function PartMesh({ part, palette }: Props) {
  const geometry = useMemo(() => {
    const mesh = buildMesh(part, palette);
    const linearColors = new Float32Array(mesh.colors.length);
    for (let i = 0; i < mesh.colors.length; i++) {
      linearColors[i] = srgbToLinear(mesh.colors[i]!);
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    geom.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    geom.setAttribute('color', new BufferAttribute(linearColors, 3));
    geom.setIndex(new BufferAttribute(mesh.indices, 1));
    return geom;
  }, [part, palette]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors />
    </mesh>
  );
}
