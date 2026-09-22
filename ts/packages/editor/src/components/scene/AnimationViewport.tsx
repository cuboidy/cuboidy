import { useMemo } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Geometry, Manifest, Palette } from '@cuboidy/core';
import { RiggedParts, buildRigTree, computeSceneCenter, computeSceneSpan, StudioLighting, StudioGrid, computeSceneBounds, StudioBackground } from '@cuboidy/ui';
import type { GizmoVisibility } from '@cuboidy/ui';
import type { AnimationSession } from '../../lib/useAnimationSession.js';
import { NoAnimationsYet } from '../ui/NoAnimationsYet.js';

interface Props {
  // Ground grid on/off, a view preference owned by the App.
  showGrid: boolean;
  geometry: Geometry;
  manifest: Manifest;
  hiddenParts: ReadonlySet<string>;
  session: AnimationSession;
  manifestEditsDisabled: boolean;
  // Per-part palette override (SPEC §6.10) — see VoxelScene.
  partPalettes?: ReadonlyMap<string, Palette> | undefined;
  // Selection gizmos (pivot / sockets / frame) for the selected part.
  selectedPart: string | null;
  gizmos: GizmoVisibility;
  // Click-to-select — see VoxelScene.
  onSelectPart: (name: string | null) => void;
  // Camera-framing freeze against edits — see VoxelScene.
  framingKey: number;
  onCreateClip: () => void;
}

// The anim viewport: the posed 3D rig plus the transport (play/scrub/time +
// clip selector). It reads the shared session but owns no editing UI — the
// keyframe lanes live in the separate Timeline panel. When the model has no
// clip yet, it shows the create-first-animation prompt in place of the scene.
export function AnimationViewport({
  showGrid,
  geometry,
  manifest,
  hiddenParts,
  session,
  manifestEditsDisabled,
  partPalettes,
  selectedPart,
  gizmos,
  onSelectPart,
  framingKey,
  onCreateClip,
}: Props) {
  const {
    activeName,
    inlineNames,
    inline,
    duration,
    hasTimeline,
    playing,
    time,
    poses,
    setSelectedClip,
    setPlaying,
    scrub,
  } = session;

  const roots = useMemo(() => buildRigTree(geometry, manifest), [geometry, manifest]);
  // Framing recomputes on load only (framingKey), never on edits — see
  // VoxelScene for the rationale.
  /* eslint-disable react-hooks/exhaustive-deps */
  const center = useMemo<[number, number, number]>(
    () => computeSceneCenter(geometry, manifest, 'rigged'),
    [framingKey],
  );
  const radius = useMemo(() => {
    const span = computeSceneSpan(geometry, manifest, 'rigged');
    return Math.max(span.w, span.h, span.d) * 1.8;
  }, [framingKey]);
  /* eslint-enable react-hooks/exhaustive-deps */
  // World bounds, not the largest part's own size — see StudioGrid. The
  // animation view is always the rig, so a posed part reaching into
  // negative X or Z is the normal case, not the exception.
  const bounds = useMemo(
    () => computeSceneBounds(geometry, manifest, 'rigged'),
    [geometry, manifest],
  );

  if (inline === undefined) {
    return (
      <div className="anim-empty">
        <NoAnimationsYet
          disabled={manifestEditsDisabled}
          onCreateClip={onCreateClip}
        />
      </div>
    );
  }

  return (
    <Canvas
      camera={{ position: [radius, radius, radius], fov: 50 }}
      shadows={false}
      onPointerMissed={() => onSelectPart(null)}
    >
      <StudioBackground />
      <StudioLighting />
      <StudioGrid min={bounds.min} max={bounds.max} visible={showGrid} />
      <RiggedParts
        roots={roots}
        palette={geometry.palette}
        poses={poses}
        hiddenParts={hiddenParts}
        partPalettes={partPalettes}
        selectedPart={selectedPart}
        gizmos={gizmos}
        onSelectPart={onSelectPart}
      />
      <OrbitControls target={center} makeDefault />
    </Canvas>
  );
}
