import { useMemo, type CSSProperties } from 'react';
import { Pause, Play, Plus } from 'lucide-react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Geometry, Manifest, Palette } from '@cuboidy/core';
import {
  buildRigTree,
  computeSceneCenter,
  computeSceneSpan,
} from '../lib/rig.js';
import type { AnimationSession } from '../lib/useAnimationSession.js';
import type { GizmoVisibility } from '../lib/types.js';
import { RiggedParts } from './RiggedParts.js';

interface Props {
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
    () => computeSceneCenter(geometry, manifest, 'rig'),
    [framingKey],
  );
  const radius = useMemo(() => {
    const span = computeSceneSpan(geometry, manifest, 'rig');
    return Math.max(span.w, span.h, span.d) * 1.8;
  }, [framingKey]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const gridSize = useMemo(() => {
    const raw = Math.max(
      20,
      Math.ceil(Math.max(...geometry.parts.map((p) => Math.max(p.size.w, p.size.d)))) +
        4,
    );
    return raw + (raw % 2);
  }, [geometry]);

  if (inline === undefined) {
    return (
      <div className="anim-view">
        <div className="anim-empty">
          <p>This model has no animations yet.</p>
          <button
            type="button"
            className="btn btn-create"
            disabled={manifestEditsDisabled}
            onClick={onCreateClip}
          >
            <Plus size={13} />
            Create animation
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="anim-view">
      <div className="anim-canvas">
        <Canvas
          camera={{ position: [radius, radius, radius], fov: 50 }}
          shadows={false}
          onPointerMissed={() => onSelectPart(null)}
        >
          <ambientLight intensity={0.8} />
          <directionalLight position={[10, 20, 10]} intensity={1.0} />
          <gridHelper
            args={[gridSize, gridSize]}
            position={[gridSize / 2, 0, gridSize / 2]}
          />
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
      </div>

      <div className="anim-controls">
        <button
          type="button"
          className="anim-play icon-btn"
          aria-label={playing ? 'Pause' : 'Play'}
          disabled={!hasTimeline}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? (
            <Pause size={15} fill="currentColor" strokeWidth={0} />
          ) : (
            <Play size={15} fill="currentColor" strokeWidth={0} />
          )}
        </button>
        <input
          type="range"
          className="anim-scrub"
          min={0}
          max={hasTimeline ? duration : 1}
          step={hasTimeline ? Math.max(duration / 200, 0.001) : 0.001}
          value={hasTimeline ? Math.min(time, duration) : 0}
          style={
            {
              '--fill': `${
                hasTimeline && duration > 0
                  ? (Math.min(time, duration) / duration) * 100
                  : 0
              }%`,
            } as CSSProperties
          }
          disabled={!hasTimeline}
          aria-label="Scrub timeline"
          onChange={(e) => scrub(Number(e.target.value))}
        />
        <span className="anim-time">
          {(hasTimeline ? time : 0).toFixed(2)} / {duration.toFixed(2)}s
        </span>
        {inlineNames.length > 1 ? (
          <select
            className="anim-select"
            value={activeName}
            aria-label="Animation"
            onChange={(e) => setSelectedClip(e.target.value)}
          >
            {inlineNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <span className="anim-name">{activeName}</span>
        )}
        <button
          type="button"
          className="btn btn-create btn-sm anim-create-inline"
          disabled={manifestEditsDisabled}
          title="Create a new clip"
          onClick={onCreateClip}
        >
          <Plus size={13} />
          New clip
        </button>
      </div>
    </div>
  );
}
