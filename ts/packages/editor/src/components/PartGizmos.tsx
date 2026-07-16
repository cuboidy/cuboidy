import { useEffect, useMemo } from 'react';
import type { Part } from '@cuboidy/core';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
} from 'three';
import type { GizmoVisibility } from '../lib/types.js';

interface Props {
  part: Part;
  show: GizmoVisibility;
}

// Selection gizmos for one part, drawn in the part's LOCAL voxel frame
// (the [0..w]×[0..h]×[0..d] box the .cvox voxels live in). Rendering
// them inside the same group as the PartMesh means every view (cvox /
// rig / anim) carries them through its own transforms for free —
// including animated scale, where the frame keeps hugging the scaled
// geometry while the pivot marker stays put (the pivot is the scale
// center).
//
// All materials skip the depth test: the pivot usually sits INSIDE the
// mesh and the frame lies exactly ON its surface (z-fighting), so
// draw-on-top is the only readable option. `transparent` routes them
// through the late render pass where renderOrder layers markers above
// the frame.

const FRAME_COLOR = 0x8338ec; // --accent
const PIVOT_COLOR = 0xf5f3ff;
const SOCKET_COLOR = 0xffb703;

// Axis-cross colors, pre-linearized: vertex-color attributes bypass
// three's sRGB→linear color management (unlike material.color), same
// deal as PartMesh's palette conversion.
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const AXIS_COLORS = [
  [0.898, 0.282, 0.302], // x — red   (#e5484d)
  [0.275, 0.655, 0.345], // y — green (#46a758)
  [0.243, 0.388, 0.867], // z — blue  (#3e63dd)
].map((rgb) => rgb.map(srgbToLinear));

export function PartGizmos({ part, show }: Props) {
  const { w, h, d } = part.size;
  // Marker size tracks the part so gizmos read the same on a 4³ hand
  // and a 30-voxel torso.
  const r = Math.min(0.6, Math.max(0.18, Math.max(w, h, d) * 0.05));

  const frameGeom = useMemo(() => {
    const box = new BoxGeometry(w, h, d);
    const edges = new EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [w, h, d]);
  useEffect(() => () => frameGeom.dispose(), [frameGeom]);

  const axesGeom = useMemo(() => {
    const len = r * 3;
    const positions = new Float32Array([
      0, 0, 0, len, 0, 0,
      0, 0, 0, 0, len, 0,
      0, 0, 0, 0, 0, len,
    ]);
    const colors = new Float32Array(18);
    for (let axis = 0; axis < 3; axis++) {
      colors.set(AXIS_COLORS[axis]!, axis * 6);
      colors.set(AXIS_COLORS[axis]!, axis * 6 + 3);
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setAttribute('color', new BufferAttribute(colors, 3));
    return geom;
  }, [r]);
  useEffect(() => () => axesGeom.dispose(), [axesGeom]);

  const piv = part.pivot.pos;
  return (
    <>
      {show.frame && (
        <lineSegments
          geometry={frameGeom}
          position={[w / 2, h / 2, d / 2]}
          renderOrder={998}
        >
          <lineBasicMaterial
            color={FRAME_COLOR}
            depthTest={false}
            transparent
            opacity={0.9}
          />
        </lineSegments>
      )}
      {show.pivot && (
        <group position={[piv.x, piv.y, piv.z]}>
          <lineSegments geometry={axesGeom} renderOrder={1000}>
            <lineBasicMaterial vertexColors depthTest={false} transparent />
          </lineSegments>
          <mesh renderOrder={1000}>
            <sphereGeometry args={[r * 0.75, 16, 12]} />
            <meshBasicMaterial
              color={PIVOT_COLOR}
              depthTest={false}
              transparent
            />
          </mesh>
        </group>
      )}
      {show.sockets &&
        part.sockets.map((s) => (
          <mesh
            key={s.name}
            position={[s.pos.x, s.pos.y, s.pos.z]}
            renderOrder={999}
          >
            <octahedronGeometry args={[r * 0.9]} />
            <meshBasicMaterial
              color={SOCKET_COLOR}
              depthTest={false}
              transparent
              opacity={0.95}
            />
          </mesh>
        ))}
    </>
  );
}
