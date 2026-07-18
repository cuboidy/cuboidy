import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import type { Object3D } from 'three';
import {
  AIR,
  type Cvox,
  type Manifest,
  type Palette,
  type Part,
} from '@cuboidy/core';
import type {
  GizmoVisibility,
  PreviewTool,
  TransformSubTarget,
  ViewMode,
  VoxelEdit,
} from '../lib/types.js';
import {
  buildRigTree,
  computeSceneCenter,
  computeSceneSpan,
} from '../lib/rig.js';
import { PartGizmos, type GizmoPicking } from './PartGizmos.js';
import { PartMesh } from './PartMesh.js';
import {
  RiggedParts,
  type VoxelStrokeHandlers,
} from './RiggedParts.js';
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
  // Voxel tools (design §2.6): the active paint color (index into the
  // selected part's effective palette; -1 = none available) and the
  // stroke commit — one completed stroke = one call = one undo.
  activeColorIndex: number;
  onStrokeVoxels: (name: string, edits: readonly VoxelEdit[]) => void;
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
  activeColorIndex,
  onStrokeVoxels,
  framingKey,
}: Props) {
  const rigMode = viewMode !== 'cvox' && manifest !== undefined;
  const voxelActive = tool === 'erase' || tool === 'paint';

  // ── Voxel stroke (design §2.6). The in-progress stroke lives here as
  // a cell→value overlay; the model renders through `displayCvox` so
  // the mesh updates live, and pointer-up commits everything as ONE
  // dispatch upstream. A ref mirrors the state for the event handlers
  // (pointermove bursts within one frame must see their own writes).
  const [stroke, setStroke] = useState<ReadonlyMap<string, number> | null>(
    null,
  );
  const strokeRef = useRef<Map<string, number> | null>(null);
  const strokeActiveRef = useRef(false);
  // Geometry frozen at stroke start — the drag's raycast target, so
  // erasing can't tunnel into freshly-revealed voxels (one drag =
  // one layer). See VoxelStrokeHandlers.snapshot.
  const [strokeSnapshot, setStrokeSnapshot] = useState<Part | null>(null);

  const selectedPartData = useMemo(
    () =>
      selectedPart === null
        ? undefined
        : cvox.parts.find((p) => p.name === selectedPart),
    [cvox, selectedPart],
  );

  const strokeHit = (e: ThreeEvent<PointerEvent>) => {
    if (selectedPartData === undefined) return;
    const face = e.face;
    if (face === undefined || face === null) return;
    const value = tool === 'erase' ? AIR : activeColorIndex;
    if (tool === 'paint' && value < 0) return; // empty palette
    // Hit point (world) → the mesh's local frame == part-local voxel
    // coords; stepping half a cell against the face normal (already
    // local) lands inside the voxel that OWNS the hit face.
    const local = e.object.worldToLocal(e.point.clone());
    const n = face.normal;
    const vx = Math.floor(local.x - n.x * 0.5);
    const vy = Math.floor(local.y - n.y * 0.5);
    const vz = Math.floor(local.z - n.z * 0.5);
    const { w, h, d } = selectedPartData.size;
    if (vx < 0 || vx >= w || vy < 0 || vy >= h || vz < 0 || vz >= d) return;
    const key = `${vx},${vy},${vz}`;
    const cur =
      strokeRef.current?.get(key) ??
      selectedPartData.voxels[vy]?.[vz]?.[vx];
    if (cur === undefined || cur === value) return;
    const next = new Map(strokeRef.current ?? []);
    next.set(key, value);
    strokeRef.current = next;
    setStroke(next);
  };

  const voxelStroke: VoxelStrokeHandlers | null =
    voxelActive && selectedPart !== null && !hiddenParts.has(selectedPart)
      ? {
          onPointerDown: (e) => {
            // Alt+drag stays the camera (design §2.6); only a plain
            // left press starts a stroke.
            if (e.altKey || e.button !== 0) return;
            e.stopPropagation();
            strokeActiveRef.current = true;
            setStrokeSnapshot(selectedPartData ?? null);
            strokeHit(e);
          },
          onPointerMove: (e) => {
            if (!strokeActiveRef.current) return;
            // The nearest intersection is the snapshot surface; stop
            // here so the same event doesn't ALSO fire for the visible
            // mesh's face behind it.
            e.stopPropagation();
            strokeHit(e);
          },
          snapshot: strokeSnapshot,
        }
      : null;

  const commitStroke = useCallback(() => {
    const s = strokeRef.current;
    strokeRef.current = null;
    strokeActiveRef.current = false;
    setStroke(null);
    setStrokeSnapshot(null);
    if (s === null || s.size === 0 || selectedPart === null) return;
    const edits: VoxelEdit[] = [...s].map(([k, value]) => {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      return { x, y, z, value };
    });
    onStrokeVoxels(selectedPart, edits);
  }, [selectedPart, onStrokeVoxels]);

  // The stroke ends wherever the pointer goes up — including off the
  // mesh and outside the canvas.
  useEffect(() => {
    const up = () => {
      if (strokeActiveRef.current) commitStroke();
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [commitStroke]);

  // Tool/selection changed out from under an in-progress stroke —
  // commit what's there rather than dropping the work.
  useEffect(() => {
    if (!voxelActive && strokeRef.current !== null) commitStroke();
  }, [voxelActive, commitStroke]);

  // Alt = orbit while a voxel tool holds the plain left-drag.
  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(false);
    };
    const blur = () => setAltHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // The rendered model: the base cvox with the in-progress stroke
  // overlaid on the selected part.
  const displayCvox = useMemo(() => {
    if (stroke === null || stroke.size === 0 || selectedPart === null) {
      return cvox;
    }
    const parts = cvox.parts.map((p) => {
      if (p.name !== selectedPart) return p;
      const voxels = p.voxels.map((layer, y) =>
        layer.map((row, z) =>
          row.map((v, x) => stroke.get(`${x},${y},${z}`) ?? v),
        ),
      );
      return { ...p, voxels };
    });
    return { ...cvox, parts };
  }, [cvox, stroke, selectedPart]);

  const visibleParts = displayCvox.parts.filter(
    (p) => !hiddenParts.has(p.name),
  );

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
  // with the selection. Inert while a voxel tool is active (design
  // §2.6: clicks are edits there, and losing the selection mid-paint
  // would be an accident).
  const selectAndResetSub = useCallback(
    (name: string | null) => {
      if (tool === 'erase' || tool === 'paint') return;
      setSubPick({ part: name ?? '', sub: { kind: 'part' } });
      onSelectPart(name);
    },
    [onSelectPart, tool],
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

  const roots = useMemo(
    () => buildRigTree(displayCvox, manifest),
    [displayCvox, manifest],
  );

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
          voxelStroke={voxelStroke}
        />
      ) : (
        // Cvox view: origin-stacked, no rig transforms by design. Part
        // local coords ARE world coords here, so gizmos render in place.
        visibleParts.map((part) => (
          <group
            key={part.name}
            position={[0, 0, 0]}
            {...(part.name === selectedPart &&
              voxelStroke !== null && {
                onPointerDown: voxelStroke.onPointerDown,
                onPointerMove: voxelStroke.onPointerMove,
              })}
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
            {/* Invisible stroke-start hit proxy — see RiggedParts. */}
            {part.name === selectedPart &&
              voxelStroke !== null &&
              voxelStroke.snapshot !== null && (
                <group visible={false}>
                  <PartMesh
                    part={voxelStroke.snapshot}
                    palette={partPalettes?.get(part.name) ?? cvox.palette}
                  />
                </group>
              )}
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
      {/* While a voxel tool holds the plain left-drag for strokes, the
          orbit moves to Alt+drag (design §2.6). Pan/zoom unchanged. */}
      <OrbitControls
        target={target}
        makeDefault
        enableRotate={!voxelActive || altHeld}
      />
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
