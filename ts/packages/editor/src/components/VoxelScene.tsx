import { useCallback, useMemo, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Object3D } from 'three';
import type { Cvox, Manifest, Palette } from '@cuboidy/core';
import type { GizmoVisibility, PreviewTool, ViewMode } from '../lib/types.js';
import {
  buildRigTree,
  computeSceneCenter,
  computeSceneSpan,
} from '../lib/rig.js';
import { PartGizmos } from './PartGizmos.js';
import { PartMesh } from './PartMesh.js';
import { RiggedParts } from './RiggedParts.js';
import { TransformGizmo } from './TransformGizmo.js';

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
  // Selection gizmos (pivot / sockets / frame) for the selected part.
  selectedPart: string | null;
  gizmos: GizmoVisibility;
  // Click-to-select: a part click selects it; a click that hits nothing
  // (r3f fires onPointerMissed only for non-drag clicks) deselects.
  onSelectPart: (name: string | null) => void;
  // Active preview tool (design §2.1). This component acts on 'move'
  // (rig view only — the App disables it elsewhere); everything else
  // behaves as 'select' here.
  tool: PreviewTool;
  // Move-gizmo drag commit: the selected part's new parent-relative
  // manifest position, once per completed drag.
  onMovePart: (name: string, position: [number, number, number]) => void;
  // Bumped by the App on model LOAD. Camera framing (orbit target +
  // radius) recomputes only then and on view switch — never on edits,
  // so a gizmo drag can't move the viewpoint under the user.
  framingKey: number;
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
// jump. (drei OrbitControls re-snaps to a changed `target` prop.) They
// are additionally frozen against edits via `framingKey` — see the memo
// below.

export function VoxelScene({
  cvox,
  manifest,
  viewMode,
  hiddenParts,
  partPalettes,
  selectedPart,
  gizmos,
  onSelectPart,
  tool,
  onMovePart,
  framingKey,
}: Props) {
  const rigMode = viewMode !== 'cvox' && manifest !== undefined;
  const visibleParts = cvox.parts.filter((p) => !hiddenParts.has(p.name));

  // name → outer rig group, registered by RiggedParts. Held in a ref
  // (registration happens during commit, reads during render see the
  // previous completed pass — selection/tool changes always re-render
  // after that, so the lookup can't go stale).
  const partObjects = useRef(new Map<string, Object3D>());
  const registerPartObject = useCallback(
    (name: string, obj: Object3D | null) => {
      if (obj === null) partObjects.current.delete(name);
      else partObjects.current.set(name, obj);
    },
    [],
  );
  const moveTarget =
    rigMode && tool === 'move' && selectedPart !== null && !hiddenParts.has(selectedPart)
      ? partObjects.current.get(selectedPart) ?? null
      : null;

  const roots = useMemo(() => buildRigTree(cvox, manifest), [cvox, manifest]);

  // Framing deliberately does NOT track cvox/manifest edits: it
  // recomputes on load (framingKey) and view switch only. A move-gizmo
  // drag rewrites the manifest, and recomputing the center from the new
  // bbox would make OrbitControls re-snap — the viewpoint drifting
  // after every edit.
  /* eslint-disable react-hooks/exhaustive-deps */
  const target = useMemo<[number, number, number]>(
    () => computeSceneCenter(cvox, manifest, viewMode),
    [framingKey, viewMode],
  );

  const radius = useMemo(() => {
    const span = computeSceneSpan(cvox, manifest, viewMode);
    return Math.max(span.w, span.h, span.d) * 1.8;
  }, [framingKey, viewMode]);
  /* eslint-enable react-hooks/exhaustive-deps */

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
      onPointerMissed={() => onSelectPart(null)}
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
          selectedPart={selectedPart}
          gizmos={gizmos}
          onSelectPart={onSelectPart}
          registerObject={registerPartObject}
        />
      ) : (
        // Cvox view: origin-stacked, no rig transforms by design. Part
        // local coords ARE world coords here, so gizmos render in place.
        visibleParts.map((part) => (
          <group
            key={part.name}
            position={[0, 0, 0]}
            onClick={(e) => {
              // delta > 2px = an orbit drag's terminal click, not a pick.
              if (e.delta > 2) return;
              e.stopPropagation();
              onSelectPart(part.name);
            }}
          >
            <PartMesh
              part={part}
              palette={partPalettes?.get(part.name) ?? cvox.palette}
            />
            {part.name === selectedPart && (
              <PartGizmos part={part} show={gizmos} />
            )}
          </group>
        ))
      )}
      {moveTarget !== null && selectedPart !== null && (
        <TransformGizmo
          target={moveTarget}
          onCommitPosition={(p) => onMovePart(selectedPart, p)}
        />
      )}
      <OrbitControls target={target} makeDefault />
    </Canvas>
  );
}
