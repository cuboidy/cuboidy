import { useEffect, useMemo } from 'react';
import type { LibraryModel, Library } from '../lib/library.js';
import { anyPlaying, type Scene } from '../lib/scene-doc.js';
import { placeScene } from '../lib/scene-resolve.js';
import { useSceneClock } from '../lib/useSceneClock.js';
import type { SceneGizmos, SceneTool, SceneViewMode } from '../lib/view.js';
import type { DropTarget } from '../lib/drop.js';
import { SceneView } from './SceneView.js';

// The view panel's stateful shell: the scene clock and the ANIMATED
// placeScene live here, inside the panel subtree, so a running clip
// re-renders this panel alone. They used to live in App, where every rAF
// tick changed `time`, rebuilt renderPanel's closure and re-rendered all
// seven panel bodies — the tree, the source view, everything — for a
// frame only the 3D view could show.
export function SceneViewPanel({
  scene,
  library,
  view,
  animUnavailable,
  tool,
  toolDisabled,
  gizmos,
  hidden,
  selected,
  onSelect,
  dragModel,
  onDropTarget,
  onDropModel,
  onSetTool,
  onToggleGizmo,
  onChangeViewMode,
  onMove,
  onRotate,
  onSetAnim,
}: {
  scene: Scene;
  library: Library;
  view: SceneViewMode;
  animUnavailable: string | undefined;
  tool: SceneTool;
  toolDisabled: Partial<Record<SceneTool, string>>;
  gizmos: SceneGizmos;
  hidden: ReadonlySet<string>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  dragModel: LibraryModel | null;
  onDropTarget: (target: DropTarget | null) => void;
  onDropModel: (model: string, at: DropTarget | null) => void;
  onSetTool: (tool: SceneTool) => void;
  onToggleGizmo: (kind: keyof SceneGizmos) => void;
  onChangeViewMode: (mode: SceneViewMode) => void;
  onMove: (id: string, pos: [number, number, number]) => void;
  onRotate: (id: string, rot: [number, number, number]) => void;
  onSetAnim: (
    id: string,
    anim: { clip: string; playing: boolean; at?: number } | null,
  ) => void;
}) {
  // One clock for the scene, running only while something plays — and
  // only while this view is watching. Rig view stops it rather than
  // merely ignoring it: a clock nobody reads is frames nobody sees.
  const playing = anyPlaying(scene) && view === 'anim';
  const { time, seek } = useSceneClock(playing);
  const placed = useMemo(
    () => placeScene(scene, library, time, { rest: view === 'rig' }),
    [scene, library, time, view],
  );

  // The RENDERED (animated) scene, for tests. Where an instance ENDED UP
  // is the only way to tell an attachment that took effect from one that
  // merely says it did, and a canvas cannot be asked. Lives with the
  // view: the probe describes what is on screen.
  useEffect(() => {
    const w = window as unknown as { __scene?: unknown };
    w.__scene = placed;
    return () => {
      delete w.__scene;
    };
  }, [placed]);

  return (
    <SceneView
      placed={placed}
      selected={selected}
      viewMode={view}
      animUnavailable={animUnavailable}
      tool={tool}
      toolDisabled={toolDisabled}
      gizmos={gizmos}
      hidden={hidden}
      onSelect={onSelect}
      dragModel={dragModel}
      onDropTarget={onDropTarget}
      onDropModel={onDropModel}
      onSetTool={onSetTool}
      onToggleGizmo={onToggleGizmo}
      onChangeViewMode={onChangeViewMode}
      onMove={onMove}
      onRotate={onRotate}
      sceneTime={time}
      onSeek={seek}
      onSetAnim={onSetAnim}
    />
  );
}
