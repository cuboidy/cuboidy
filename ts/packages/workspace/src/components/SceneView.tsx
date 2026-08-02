import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Box, Crosshair, MousePointer2, Move, Plug, Rotate3d } from 'lucide-react';
import type { Object3D } from 'three';
import type { Geometry, Palette } from '@cuboidy/core';
import {
  RiggedParts,
  ToggleGroup,
  ToolBar,
  ToolOverlay,
  TransformGizmoHost,
  ViewOverlay,
  ViewToggle,
  buildRigTree,
  computeSceneSpan,
} from '@cuboidy/ui';
import type { LibraryModel } from '../lib/library.js';
import { localPosFrom, type PlacedInstance } from '../lib/scene.js';
import type { SceneGizmos, SceneTool, SceneViewMode } from '../lib/view.js';
import { InstanceGizmos } from './InstanceGizmos.js';

interface Props {
  placed: readonly PlacedInstance[];
  selected: string | null;
  viewMode: SceneViewMode;
  // Reason anim view is unavailable, or undefined when it is offered.
  animUnavailable: string | undefined;
  tool: SceneTool;
  toolDisabled: Partial<Record<SceneTool, string>>;
  gizmos: SceneGizmos;
  onSelect: (id: string | null) => void;
  // Dropping a library row onto the canvas adds it to the scene.
  onDropModel: (model: string) => void;
  onSetTool: (tool: SceneTool) => void;
  onToggleGizmo: (kind: keyof SceneGizmos) => void;
  onChangeViewMode: (mode: SceneViewMode) => void;
  // Committed once per completed drag, already converted out of world
  // space into the frame the instance's placement is measured in.
  onMove: (id: string, pos: [number, number, number]) => void;
  onRotate: (id: string, rot: [number, number, number]) => void;
}

// The scene: every placed instance, each at the world frame the scene
// layer resolved for it.
//
// An attached guest is NOT nested under its host here — the scene layer
// resolves hosts before guests and hands back world frames, so every
// instance is a direct child of the canvas. That is what lets the move
// gizmo work the same way on both: the group's local transform is always
// the world one, and the only difference is which frame the commit
// converts back into.
//
// Nothing here recomputes an attachment; SPEC §7.8 / §6.12 live in core
// and the scene layer applies them once.
export function SceneView({
  placed,
  selected,
  viewMode,
  animUnavailable,
  tool,
  toolDisabled,
  gizmos,
  onSelect,
  onDropModel,
  onSetTool,
  onToggleGizmo,
  onChangeViewMode,
  onMove,
  onRotate,
}: Props) {
  const reach = useMemo(() => {
    let max = 8;
    for (const p of placed) {
      const g = viewGeometry(p.model);
      if (g === null) continue;
      const span = computeSceneSpan(g, p.model.manifest, 'rig');
      max = Math.max(max, span.w, span.h, span.d);
    }
    return max;
  }, [placed]);

  const selectedPlaced =
    placed.find((p) => p.instance.id === selected) ?? null;

  // id → the instance's outer group, registered from inside the canvas so
  // the transform gizmo has something to attach to.
  const objects = useRef(new Map<string, Object3D>());
  const register = useCallback((id: string, obj: Object3D | null) => {
    if (obj === null) objects.current.delete(id);
    else objects.current.set(id, obj);
  }, []);

  const transformMode =
    tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : null;

  return (
    <div
      className="scene-canvas"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const model = e.dataTransfer.getData('application/x-cuboidy-model');
        if (model !== '') onDropModel(model);
      }}
    >
      <ToolOverlay>
        <ToolBar
          value={tool}
          label="Scene tools"
          items={[
            {
              id: 'select',
              icon: MousePointer2,
              label: 'Select',
              unavailable: toolDisabled.select,
            },
            {
              id: 'move',
              icon: Move,
              label: 'Move',
              unavailable: toolDisabled.move,
            },
            {
              id: 'rotate',
              icon: Rotate3d,
              label: 'Rotate',
              unavailable: toolDisabled.rotate,
            },
          ]}
          onChange={onSetTool}
        />
      </ToolOverlay>
      <ViewOverlay>
        <ToggleGroup
          label="Selected-instance gizmos"
          items={[
            {
              id: 'origin',
              icon: Crosshair,
              label: "Show the selected model's origin",
              on: gizmos.origin,
            },
            {
              id: 'sockets',
              icon: Plug,
              label: 'Show the sockets it publishes',
              on: gizmos.sockets,
            },
            {
              id: 'frame',
              icon: Box,
              label: 'Show the selection outline',
              on: gizmos.frame,
            },
          ]}
          onToggle={onToggleGizmo}
        />
        <ViewToggle
          value={viewMode}
          label="View mode"
          items={[
            {
              id: 'rig',
              label: 'Rig view',
              title: 'The arrangement at rest, with animation out of the way',
            },
            {
              id: 'anim',
              label: 'Anim view',
              title: 'Play what the instances are set to play',
              unavailable: animUnavailable,
            },
          ]}
          onChange={onChangeViewMode}
        />
      </ViewOverlay>

      <Canvas
        flat
        camera={{ position: [reach * 2, reach * 1.6, reach * 2], fov: 35 }}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={['#14161a']} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[6, 10, 8]} intensity={1.1} />
        <directionalLight position={[-8, 4, -6]} intensity={0.4} />
        <gridHelper args={[reach * 4, 16, '#2a2f38', '#20242b']} />
        <FrameCamera reach={reach} />
        {placed.map((p) => (
          <InstanceMesh
            key={p.instance.id}
            placed={p}
            selected={p.instance.id === selected}
            gizmos={gizmos}
            register={register}
            onSelect={() => onSelect(p.instance.id)}
          />
        ))}
        {transformMode !== null && selectedPlaced !== null && (
          <TransformGizmoHost
            registry={objects}
            objectKey={selectedPlaced.instance.id}
            mode={transformMode}
            // Whole units: an instance is placed at voxel scale, and the
            // 0.5 step the editor uses for markers would be a finer grid
            // than anything in a scene is measured on. Shift still drops
            // to 0.1.
            snapCoarse={1}
            // The group's quaternion is base ⊗ placement.rot; factoring
            // the base out on the left leaves exactly the stored value.
            factorOutLeft={selectedPlaced.base.quat}
            factorOutRight={undefined}
            onCommitPosition={(p) =>
              onMove(
                selectedPlaced.instance.id,
                localPosFrom(selectedPlaced.base, p),
              )
            }
            onCommitRotation={(r) => onRotate(selectedPlaced.instance.id, r)}
          />
        )}
        <OrbitControls makeDefault />
      </Canvas>
      {placed.length === 0 && (
        <p className="scene-hint">
          Drag a model from the left, or double-click one, to put it in the
          scene.
        </p>
      )}
    </div>
  );
}

function InstanceMesh({
  placed,
  selected,
  gizmos,
  register,
  onSelect,
}: {
  placed: PlacedInstance;
  selected: boolean;
  gizmos: SceneGizmos;
  register: (id: string, obj: Object3D | null) => void;
  onSelect: () => void;
}) {
  const view = useMemo(() => {
    const geometry = viewGeometry(placed.model);
    if (geometry === null) return null;
    const partPalettes = new Map<string, Palette>();
    for (const [name, r] of placed.model.parts) partPalettes.set(name, r.palette);
    return {
      geometry,
      partPalettes,
      roots: buildRigTree(geometry, placed.model.manifest),
    };
  }, [placed.model]);
  const id = placed.instance.id;
  // Registration is unconditional on mount/unmount, so it must not sit
  // behind the `view === null` early return below.
  const ref = useCallback(
    (obj: Object3D | null) => register(id, obj),
    [register, id],
  );
  if (view === null) return null;

  const [x, y, z] = placed.frame.pos;
  const q = placed.frame.quat;
  return (
    <group
      ref={ref}
      position={[x, y, z]}
      quaternion={[q[0], q[1], q[2], q[3]]}
      onClick={(e) => {
        // An orbit or gizmo drag ends in a click too, and r3f's delta (px
        // moved between down and up) is what tells them apart. RiggedParts
        // guards its own part meshes, but a guarded click does not stop
        // propagating — so without this the drag would bubble up here and
        // change the selection out from under the drag.
        if (e.delta > 2) return;
        e.stopPropagation();
        onSelect();
      }}
    >
      <RiggedParts
        roots={view.roots}
        palette={view.geometry.palette}
        partPalettes={view.partPalettes}
        poses={placed.poses}
        hiddenParts={EMPTY}
        selectedPart={null}
        gizmos={NO_PART_GIZMOS}
        onSelectPart={onSelect}
      />
      {selected && <InstanceGizmos model={placed.model} show={gizmos} />}
    </group>
  );
}

// A resolved model as the geometry-shaped view @cuboidy/ui takes. `palette`
// is only the fallback — per-part colors come from `partPalettes`, since a
// part's colors are its own (§7.4 / §6.13).
function viewGeometry(model: LibraryModel): Geometry | null {
  const parts = [...model.parts.values()];
  if (parts.length === 0) return null;
  return {
    palette: parts[0]?.palette ?? [],
    parts: parts.map((r) => r.part),
  };
}

// `<Canvas camera={...}>` is read once, at mount — and at mount the scene
// is empty, so the framing was computed for nothing and never revisited.
// The first model then appeared with the camera inside it. This reframes
// when the scene's extent GROWS, which is the moment the old framing stops
// containing it; shrinking is left alone so removing one model does not
// yank the view the user has since orbited to.
function FrameCamera({ reach }: { reach: number }) {
  const camera = useThree((s) => s.camera);
  const framed = useRef(0);
  useEffect(() => {
    if (reach <= framed.current) return;
    framed.current = reach;
    camera.position.set(reach * 1.6, reach * 1.3, reach * 1.6);
    camera.lookAt(0, reach * 0.35, 0);
    camera.updateProjectionMatrix();
  }, [reach, camera]);
  return null;
}

const EMPTY: ReadonlySet<string> = new Set();
// Per-PART gizmos stay off: a scene selects models, not their parts, and
// the model-level overlays are InstanceGizmos' job.
const NO_PART_GIZMOS = { pivot: false, sockets: false, frame: false } as const;
