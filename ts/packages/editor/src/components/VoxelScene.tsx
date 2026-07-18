import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { Object3D } from 'three';
import type { Cvox, Manifest, Palette } from '@cuboidy/core';
import type {
  GizmoVisibility,
  PreviewTool,
  TransformSubTarget,
  ViewMode,
} from '../lib/types.js';
import {
  buildRigTree,
  computeSceneCenter,
  computeSceneSpan,
} from '../lib/rig.js';
import { PartGizmos, type GizmoPicking } from './PartGizmos.js';
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
  // Active preview tool (design §2.1). This component acts on 'move' /
  // 'rotate' (rig view only — the App disables them elsewhere);
  // everything else behaves as 'select' here.
  tool: PreviewTool;
  // Transform-gizmo drag commits, once per completed drag: the selected
  // part's new parent-relative manifest position / rest rotation (ZXY
  // euler degrees; all-zero = drop the field).
  onMovePart: (name: string, position: [number, number, number]) => void;
  onRotatePart: (name: string, rotation: [number, number, number]) => void;
  // Sub-target commits (design §2.3/§2.4), all in part-local voxel
  // coords: pivot move (compensated upstream), pivot rotation
  // (geometry-side pivot.rot), socket move, socket rotation (rotations
  // in ZXY euler degrees; all-zero = drop the field).
  onMovePivot: (name: string, pos: [number, number, number]) => void;
  onRotatePivot: (name: string, rot: [number, number, number]) => void;
  onMoveSocket: (
    name: string,
    socket: string,
    pos: [number, number, number],
  ) => void;
  onRotateSocket: (
    name: string,
    socket: string,
    rot: [number, number, number],
  ) => void;
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
  onRotatePart,
  onMovePivot,
  onRotatePivot,
  onMoveSocket,
  onRotateSocket,
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
  const transformMode =
    tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : null;
  // The selected part's geometry pivot rotation and manifest rest
  // rotation — the rotate commits factor one of them back out of the
  // composed group quaternion (§7.7), depending on which is edited.
  const selectedPivotRot = useMemo<[number, number, number] | undefined>(() => {
    if (selectedPart === null) return undefined;
    const rot = cvox.parts.find((p) => p.name === selectedPart)?.pivot.rot;
    return rot === undefined ? undefined : [rot.x, rot.y, rot.z];
  }, [cvox, selectedPart]);
  const selectedRestRot = useMemo<[number, number, number] | undefined>(() => {
    if (selectedPart === null || manifest === undefined) return undefined;
    const rot = manifest.parts.find((p) => p.name === selectedPart)?.rotation;
    return rot === undefined ? undefined : [rot[0], rot[1], rot[2]];
  }, [manifest, selectedPart]);

  // ── Transform sub-target (design §2.4): what the tools grip. ──
  // Marker registry, keyed 'pivot' / 'socket:<name>' — only the
  // selected part's PartGizmos registers, so no part prefix needed.
  const subObjects = useRef(new Map<string, Object3D>());
  const registerSubObject = useCallback(
    (key: string, obj: Object3D | null) => {
      if (obj === null) subObjects.current.delete(key);
      else subObjects.current.set(key, obj);
    },
    [],
  );
  // The raw pick, tagged with the part it was made on; treated as
  // 'part' whenever it doesn't validate against the current selection
  // (selection changed, socket renamed away, pivot under rotate tool).
  const [subPick, setSubPick] = useState<{
    part: string;
    sub: TransformSubTarget;
  }>({ part: '', sub: { kind: 'part' } });
  const subTarget: TransformSubTarget = useMemo(() => {
    if (selectedPart === null || subPick.part !== selectedPart) {
      return { kind: 'part' };
    }
    const sub = subPick.sub;
    if (sub.kind === 'pivot' && tool !== 'move' && tool !== 'rotate') {
      return { kind: 'part' };
    }
    if (sub.kind === 'socket') {
      const part = cvox.parts.find((p) => p.name === selectedPart);
      if (
        part === undefined ||
        !part.sockets.some((s) => s.name === sub.socket)
      ) {
        return { kind: 'part' };
      }
    }
    return sub;
  }, [selectedPart, subPick, tool, cvox]);

  // Clicking a part body (or empty space) resets the sub-target along
  // with the selection.
  const selectAndResetSub = useCallback(
    (name: string | null) => {
      setSubPick({ part: name ?? '', sub: { kind: 'part' } });
      onSelectPart(name);
    },
    [onSelectPart],
  );

  // Marker picking config for the selected part's PartGizmos. While a
  // transform tool is active, pivot + socket markers are forced visible
  // (they're the pick targets) regardless of the overlay toggles.
  const picking: GizmoPicking | null =
    transformMode !== null && selectedPart !== null
      ? {
          pivotPickable: tool === 'move' || tool === 'rotate',
          active: subTarget,
          onPick: (sub) => setSubPick({ part: selectedPart, sub }),
          register: registerSubObject,
        }
      : null;
  const gizmoShow: GizmoVisibility =
    transformMode !== null
      ? { ...gizmos, pivot: true, sockets: true }
      : gizmos;

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

  // Which gizmo host to mount for the current sub-target. Part-body
  // transforms exist only in rig view (design §2.2); pivot / socket
  // markers are grabbable in both cvox and rig views.
  let gizmoHost = null;
  if (
    transformMode !== null &&
    selectedPart !== null &&
    !hiddenParts.has(selectedPart)
  ) {
    if (subTarget.kind === 'pivot') {
      gizmoHost =
        transformMode === 'translate' ? (
          <TransformGizmoHost
            registry={subObjects}
            objectKey="pivot"
            mode="translate"
            snapCoarse={0.5}
            factorOutLeft={undefined}
            factorOutRight={undefined}
            onCommitPosition={(p) => onMovePivot(selectedPart, p)}
            onCommitRotation={() => {}}
          />
        ) : rigMode ? (
          // Pivot ROTATE (rig view) edits pivot.rot but attaches to the
          // part's rig group — same live preview as a part rotate (the
          // whole subtree turns around the pivot); the commit just
          // factors the MANIFEST rotation out from the left instead,
          // keeping q_pivot's share of the §7.7 composite.
          <TransformGizmoHost
            registry={partObjects}
            objectKey={selectedPart}
            mode="rotate"
            snapCoarse={1}
            factorOutLeft={selectedRestRot}
            factorOutRight={undefined}
            onCommitPosition={() => {}}
            onCommitRotation={(r) => onRotatePivot(selectedPart, r)}
          />
        ) : (
          // Pivot ROTATE (cvox view): the geometry renders untransformed
          // here, so the marker's own axes cross — which this view
          // rotates by pivot.rot (PartGizmos applyPivotRot) — IS the
          // live preview. World frame == part frame, so the marker's
          // quaternion is stored as-is.
          <TransformGizmoHost
            registry={subObjects}
            objectKey="pivot"
            mode="rotate"
            snapCoarse={1}
            factorOutLeft={undefined}
            factorOutRight={undefined}
            onCommitPosition={() => {}}
            onCommitRotation={(r) => onRotatePivot(selectedPart, r)}
          />
        );
    } else if (subTarget.kind === 'socket') {
      const socket = subTarget.socket;
      gizmoHost = (
        <TransformGizmoHost
          registry={subObjects}
          objectKey={`socket:${socket}`}
          mode={transformMode}
          snapCoarse={0.5}
          factorOutLeft={undefined}
          factorOutRight={undefined}
          onCommitPosition={(p) => onMoveSocket(selectedPart, socket, p)}
          onCommitRotation={(r) => onRotateSocket(selectedPart, socket, r)}
        />
      );
    } else if (rigMode) {
      gizmoHost = (
        <TransformGizmoHost
          registry={partObjects}
          objectKey={selectedPart}
          mode={transformMode}
          snapCoarse={1}
          factorOutLeft={undefined}
          factorOutRight={selectedPivotRot}
          onCommitPosition={(p) => onMovePart(selectedPart, p)}
          onCommitRotation={(r) => onRotatePart(selectedPart, r)}
        />
      );
    }
  }

  return (
    <Canvas
      camera={{ position: [radius, radius, radius], fov: 50 }}
      shadows={false}
      onPointerMissed={() => selectAndResetSub(null)}
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
          gizmos={gizmoShow}
          onSelectPart={selectAndResetSub}
          registerObject={registerPartObject}
          picking={picking}
        />
      ) : (
        // Cvox view: origin-stacked, no rig transforms by design. Part
        // local coords ARE world coords here, so gizmos render in place.
        visibleParts.map((part) => (
          <group
            key={part.name}
            position={[0, 0, 0]}
            onClick={(e) => {
              // delta > 2px = an orbit drag's terminal click, not a
              // pick. A ray that also hit a gizmo marker yields to it
              // (markers sit inside the mesh — see RiggedParts).
              if (e.delta > 2) return;
              if (
                e.intersections.some(
                  (i) => i.object.userData['gizmoMarker'] === true,
                )
              ) {
                return;
              }
              e.stopPropagation();
              selectAndResetSub(part.name);
            }}
          >
            <PartMesh
              part={part}
              palette={partPalettes?.get(part.name) ?? cvox.palette}
            />
            {part.name === selectedPart && (
              <PartGizmos
                part={part}
                show={gizmoShow}
                picking={picking}
                applyPivotRot
              />
            )}
          </group>
        ))
      )}
      {gizmoHost}
      <OrbitControls target={target} makeDefault />
    </Canvas>
  );
}

// Resolves the gizmo's target Object3D (a rig group or a pivot/socket
// marker) from a registry INSIDE the canvas: <Canvas> children commit
// in r3f's own React root, so only an effect in here is guaranteed to
// run AFTER the registering callback refs of the same pass. (A
// DOM-side effect in VoxelScene runs before the r3f subtree commits —
// it would read a still-empty registry when the rig remounts, e.g.
// returning from cvox view with a transform tool active, and the gizmo
// would never appear.) When the first render of a pass misses, the
// effect bumps and the second render resolves.
function TransformGizmoHost({
  registry,
  objectKey,
  mode,
  snapCoarse,
  factorOutLeft,
  factorOutRight,
  onCommitPosition,
  onCommitRotation,
}: {
  registry: { current: Map<string, Object3D> };
  objectKey: string;
  mode: 'translate' | 'rotate';
  snapCoarse: number;
  factorOutLeft: [number, number, number] | undefined;
  factorOutRight: [number, number, number] | undefined;
  onCommitPosition: (position: [number, number, number]) => void;
  onCommitRotation: (rotation: [number, number, number]) => void;
}) {
  const [, bump] = useReducer((c: number) => c + 1, 0);
  const target = registry.current.get(objectKey) ?? null;
  useEffect(() => {
    if (target === null && registry.current.has(objectKey)) bump();
  });
  if (target === null) return null;
  return (
    <TransformGizmo
      target={target}
      mode={mode}
      snapCoarse={snapCoarse}
      factorOutLeft={factorOutLeft}
      factorOutRight={factorOutRight}
      onCommitPosition={onCommitPosition}
      onCommitRotation={onCommitRotation}
    />
  );
}
