import { useMemo } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Cvox } from '@cuboidy/core';
import { PartMesh } from './PartMesh.js';

interface Props {
  cvox: Cvox;
  hiddenParts: ReadonlySet<string>;
}

// Cbox-faithful renderer: all parts are placed at world origin [0,0,0],
// matching the .cvox semantics (each part's AST origin = local left-bottom-
// back corner, no inter-part transform is defined by the file). Multi-part
// models therefore overlap visually — that's the true state of a .cvox alone.
// Per-part visibility (Sidebar) is the intended way to peel layers and
// inspect individual parts. Rig view (manifest-driven positioning) will
// be a separate render mode added later.

export function VoxelScene({ cvox, hiddenParts }: Props) {
  const visibleParts = cvox.parts.filter((p) => !hiddenParts.has(p.name));

  // Camera target is derived from the FULL set of parts (not the visible
  // subset) so toggling visibility doesn't make the camera jump. drei's
  // OrbitControls re-snaps to a changed `target` prop, which would feel
  // chaotic if the target moved every time the user clicked a checkbox.
  // The all-parts union bounding box is stable for a given loaded file.
  const target = useMemo<[number, number, number]>(() => {
    const maxW = Math.max(1, ...cvox.parts.map((p) => p.size.w));
    const maxH = Math.max(1, ...cvox.parts.map((p) => p.size.h));
    const maxD = Math.max(1, ...cvox.parts.map((p) => p.size.d));
    return [maxW / 2, maxH / 2, maxD / 2];
  }, [cvox]);

  const radius = useMemo(() => {
    const maxW = Math.max(1, ...cvox.parts.map((p) => p.size.w));
    const maxH = Math.max(1, ...cvox.parts.map((p) => p.size.h));
    const maxD = Math.max(1, ...cvox.parts.map((p) => p.size.d));
    return Math.max(maxW, maxH, maxD) * 1.8;
  }, [cvox]);

  // Grid covers the positive XZ quadrant only. Voxels live in
  // [0, W] × [0, H] × [0, D] (origin at the part's left-bottom-back
  // corner), so the negative quadrant is permanently empty floor —
  // visually noisy with no useful information. Three.js gridHelper is
  // centered on origin by construction, so we shift it by half its size
  // to map [-size/2, +size/2] onto [0, size] in world coords.
  //
  // Rounding gridSize up to an even number keeps the half-size offset
  // an integer, so grid lines stay on integer positions (matching voxel
  // cell boundaries). Otherwise lines would land at 0.5, 1.5, … which
  // looks wrong against unit-cube voxels.
  const gridSize = useMemo(() => {
    const raw = Math.max(
      20,
      Math.ceil(Math.max(...cvox.parts.map((p) => Math.max(p.size.w, p.size.d)))) + 4,
    );
    return raw + (raw % 2);
  }, [cvox]);

  return (
    <Canvas
      camera={{ position: [radius, radius, radius], fov: 50 }}
      shadows={false}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />
      <gridHelper
        args={[gridSize, gridSize]}
        position={[gridSize / 2, 0, gridSize / 2]}
      />
      {visibleParts.map((part) => (
        <PartMesh key={part.name} part={part} palette={cvox.palette} />
      ))}
      <OrbitControls target={target} makeDefault />
    </Canvas>
  );
}
