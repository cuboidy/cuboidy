import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Box, Crosshair, Grid3x3, MousePointer2, Move, Plug, Rotate3d } from 'lucide-react';
import type { Object3D } from 'three';
import {
  ToggleGroup,
  ToolBar,
  ToolOverlay,
  TransformGizmoHost,
  ViewOverlay,
  ViewToggle,
  computeSceneSpan,
  StudioBackground,
  StudioGrid,
  StudioLighting,
} from '@cuboidy/ui';
import type { LibraryModel } from '../lib/library.js';
import { viewGeometry } from '../lib/model-view.js';
import {
  installRenderProbes,
  installSocketPixelProbe,
} from '../lib/render-probes.js';
import type { PlacedInstance } from '../lib/scene-resolve.js';
import { drawTree } from '../lib/scene-tree.js';
import { useDropResolver } from '../lib/useDropResolver.js';
import type { SceneGizmos, SceneTool, SceneViewMode } from '../lib/view.js';
import type { DropTarget } from '../lib/drop.js';
import { CaptureCamera, FrameCamera } from './scene/cameras.js';
import { InstanceMesh } from './scene/InstanceMesh.js';
import { DropPreview } from './DropPreview.js';
import { SceneTransport } from './SceneTransport.js';

interface Props {
  placed: readonly PlacedInstance[];
  selected: string | null;
  viewMode: SceneViewMode;
  // Reason anim view is unavailable, or undefined when it is offered.
  animUnavailable: string | undefined;
  tool: SceneTool;
  toolDisabled: Partial<Record<SceneTool, string>>;
  gizmos: SceneGizmos;
  // Instances not drawn. Their GROUPS still render, because a hidden host
  // still carries its guests — hiding a knight should not take the sword
  // out of the scene with it.
  hidden: ReadonlySet<string>;
  onSelect: (id: string | null) => void;
  // The model being dragged out of the library, and its outline drawn
  // where it would land. Resolved here because the camera is here.
  dragModel: LibraryModel | null;
  onDropTarget: (target: DropTarget | null) => void;
  // Dropping a library card onto the canvas adds it to the scene, at
  // whatever the drag resolved to.
  onDropModel: (model: string, at: DropTarget | null) => void;
  onSetTool: (tool: SceneTool) => void;
  onToggleGizmo: (kind: keyof SceneGizmos) => void;
  onChangeViewMode: (mode: SceneViewMode) => void;
  // Committed once per completed drag, already converted out of world
  // space into the frame the instance's placement is measured in.
  onMove: (id: string, pos: [number, number, number]) => void;
  onRotate: (id: string, rot: [number, number, number]) => void;
  // Playback for the SELECTED instance, in the strip under the canvas.
  // Runtime state, not part of the scene: what is playing belongs with
  // the view, the same as the camera and the view mode.
  sceneTime: number;
  onSetAnim: (
    id: string,
    anim: { clip: string; playing: boolean; at?: number } | null,
  ) => void;
  onSeek: (time: number) => void;
}

// The scene: every placed instance, each at the world frame the scene
// layer resolved for it. The canvas and its overlays only — the clock
// lives in SceneViewPanel, the per-instance drawing in
// scene/InstanceMesh, the transport in SceneTransport, and the drop
// resolution in lib/useDropResolver.
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
  hidden,
  onSelect,
  dragModel,
  onDropTarget,
  onDropModel,
  onSetTool,
  onToggleGizmo,
  onChangeViewMode,
  onMove,
  onRotate,
  sceneTime,
  onSetAnim,
  onSeek,
}: Props) {
  // Local to the view, like the editor's: a preference, not scene state,
  // and deliberately not persisted.
  const [showGrid, setShowGrid] = useState(true);

  const reach = useMemo(() => {
    let max = 8;
    for (const p of placed) {
      const g = viewGeometry(p.model);
      if (g === null) continue;
      const span = computeSceneSpan(g, p.model.manifest, 'rigged');
      max = Math.max(max, span.w, span.h, span.d);
    }
    return max;
  }, [placed]);

  const selectedPlaced =
    placed.find((p) => p.instance.id === selected) ?? null;

  // Guests nested under their hosts, so a host's transform carries them.
  const roots = useMemo(() => drawTree(placed), [placed]);

  // id → the instance's outer group, registered from inside the canvas so
  // the transform gizmo has something to attach to.
  const objects = useRef(new Map<string, Object3D>());
  const register = useCallback((id: string, obj: Object3D | null) => {
    if (obj === null) objects.current.delete(id);
    else objects.current.set(id, obj);
  }, []);

  const transformMode =
    tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : null;

  const canvasEl = useRef<HTMLDivElement>(null);
  const drop = useDropResolver({ placed, dragModel, onDropTarget });

  // E2E probes over the rendered scene (lib/render-probes) — not app
  // behavior.
  useEffect(() => installRenderProbes(objects.current), []);
  useEffect(
    () => installSocketPixelProbe(placed, drop.cameraRef, canvasEl),
    [placed, drop.cameraRef],
  );

  return (
    <div className="scene-pane">
    <div
      ref={canvasEl}
      className="scene-canvas"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        drop.resolveAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
      }}
      onDragLeave={(e) => {
        // Moving between the wrapper and the canvas inside it fires
        // dragleave too; only a departure to something OUTSIDE counts.
        const to = e.relatedTarget;
        if (to instanceof Node && e.currentTarget.contains(to)) return;
        drop.clearTarget();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const model = e.dataTransfer.getData('application/x-cuboidy-model');
        // Read before clearing: the preview and the commit must agree,
        // and the drop is the one moment they could disagree.
        const at = drop.target;
        drop.clearTarget();
        if (model !== '') onDropModel(model, at);
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
        {/* Its own group. The three above are the SELECTED INSTANCE's
            gizmos; the grid is scene furniture and belongs to the view.
            Same arrangement as the editor's preview overlay. */}
        <ToggleGroup
          label="Scene"
          items={[
            {
              id: 'grid',
              icon: Grid3x3,
              label: 'Show the ground grid',
              on: showGrid,
            },
          ]}
          onToggle={() => setShowGrid((v) => !v)}
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
        camera={{ position: [reach * 2, reach * 1.6, reach * 2], fov: 35 }}
        onPointerMissed={() => onSelect(null)}
      >
        <StudioBackground />
        <StudioLighting />
        {/* A scene places models at signed positions, so the grid is
            sized from the reach in every direction rather than from a
            multiple of the largest model. */}
        <StudioGrid
          min={[-reach, 0, -reach]}
          max={[reach, 0, reach]}
          visible={showGrid}
        />
        <FrameCamera reach={reach} />
        <CaptureCamera into={drop.cameraRef} />
        {dragModel !== null && drop.target !== null && (
          <DropPreview model={dragModel} target={drop.target} />
        )}
        {roots.map((n) => (
          <InstanceMesh
            key={n.placed.instance.id}
            node={n}
            selected={selected}
            hidden={hidden}
            gizmos={gizmos}
            register={register}
            onSelect={onSelect}
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
            // Nothing to factor out. The gizmo attaches to the inner
            // group, whose parent is the socket (or the world), so its
            // local transform IS the stored placement — TransformControls
            // edits exactly the value that gets written. Before the
            // nesting this needed the world frame un-rotated back into
            // socket space on every commit.
            factorOutLeft={undefined}
            factorOutRight={undefined}
            onCommitPosition={(p) => onMove(selectedPlaced.instance.id, p)}
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

    <SceneTransport
      selectedPlaced={selectedPlaced}
      viewMode={viewMode}
      sceneTime={sceneTime}
      onSeek={onSeek}
      onSetAnim={onSetAnim}
    />
    </div>
  );
}
