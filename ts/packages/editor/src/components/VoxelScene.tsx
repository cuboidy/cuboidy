import { useMemo } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Cvox, Manifest, Palette } from '@cuboidy/core';
import type { ViewMode } from '../lib/types.js';
import {
  buildRigTree,
  computeSceneCenter,
  computeSceneSpan,
} from '../lib/rig.js';
import { PartMesh } from './PartMesh.js';
import { RiggedParts } from './RiggedParts.js';

interface Props {
  cvox: Cvox;
  // Required position so the App can pass `manifest: undefined` directly
  // under `exactOptionalPropertyTypes: true` (the strict optional rule
  // forbids omit-OR-undefined slots without explicit `| undefined`).
  manifest: Manifest | undefined;
  viewMode: ViewMode;
  hiddenParts: ReadonlySet<string>;
  // Per-part palette override (SPEC §6.10): with no manifest binding,
  // each part resolves against its DEFINING file's inline palette.
  // Absent = every part uses cvox.palette (bound or single-file model).
  partPalettes?: ReadonlyMap<string, Palette> | undefined;
}

// Renders the model in one of two static modes:
//   - Cvox view: every part sits at world origin [0,0,0], the literal
//     .cvox-local convention. Multi-part files overlap; the sidebar
//     visibility toggles are the way to peel layers.
//   - Rig view: the rest pose through the SAME RiggedParts transform
//     tree the animation view uses (poses = null), so both views agree
//     on §7.7 semantics — pivot.rot included. Previously this view
//     applied translations only, silently ignoring rest rotations.
// Rig view requires a manifest; the view toggle disables rig when
// none is loaded. The animation view (parts in motion) lives in its own
// AnimationViewport component — this one renders the rest pose only.
//
// Camera target / radius are computed from the full cvox bounding box,
// not the visible subset, so toggling visibility doesn't make the camera
// jump. (drei OrbitControls re-snaps to a changed `target` prop.)

export function VoxelScene({
  cvox,
  manifest,
  viewMode,
  hiddenParts,
  partPalettes,
}: Props) {
  const rigMode = viewMode !== 'cvox' && manifest !== undefined;
  const visibleParts = cvox.parts.filter((p) => !hiddenParts.has(p.name));

  const roots = useMemo(() => buildRigTree(cvox, manifest), [cvox, manifest]);

  const target = useMemo<[number, number, number]>(
    () => computeSceneCenter(cvox, manifest, viewMode),
    [cvox, manifest, viewMode],
  );

  const radius = useMemo(() => {
    const span = computeSceneSpan(cvox, manifest, viewMode);
    return Math.max(span.w, span.h, span.d) * 1.8;
  }, [cvox, manifest, viewMode]);

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
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 20, 10]} intensity={1.0} />
      <gridHelper
        args={[gridSize, gridSize]}
        position={[gridSize / 2, 0, gridSize / 2]}
      />
      {rigMode ? (
        <RiggedParts
          roots={roots}
          palette={cvox.palette}
          poses={null}
          hiddenParts={hiddenParts}
          partPalettes={partPalettes}
        />
      ) : (
        // Cvox view: origin-stacked, no rig transforms by design.
        visibleParts.map((part) => (
          <group key={part.name} position={[0, 0, 0]}>
            <PartMesh
              part={part}
              palette={partPalettes?.get(part.name) ?? cvox.palette}
            />
          </group>
        ))
      )}
      <OrbitControls target={target} makeDefault />
    </Canvas>
  );
}
