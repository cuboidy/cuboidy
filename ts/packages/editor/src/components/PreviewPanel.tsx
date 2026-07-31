import { Box, Crosshair, Plug } from 'lucide-react';
import type { Geometry, Manifest, Palette } from '@cuboidy/core';
import { AnimationViewport } from './AnimationViewport.js';
import { PaletteStrip } from './PaletteStrip.js';
import { PreviewToolbar } from './PreviewToolbar.js';
import { ViewModeToggle } from './ViewModeToggle.js';
import { VoxelScene } from './VoxelScene.js';
import type { AnimationSession } from '../lib/useAnimationSession.js';
import type {
  GizmoVisibility,
  PreviewTool,
  ViewMode,
  VoxelEdit,
} from '../lib/types.js';

interface Props {
  geometry: Geometry;
  manifest?: Manifest | undefined;
  // The animation-facing manifest: §6.3 string refs already replaced by
  // their resolved clips. Undefined when the model has no manifest.
  animManifest?: Manifest | undefined;
  // Per-part palettes for a multi-file model whose files keep their own
  // colors (§7.4). Undefined when one palette covers everything.
  partPalettes?: ReadonlyMap<string, Palette> | undefined;
  // The palette the paint/attach strip offers: the SELECTED part's, so a
  // painted index means the right color in the right file.
  stripPalette: Palette;
  activeColorIndex: number;
  viewMode: ViewMode;
  rigAvailable: boolean;
  animAvailable: boolean;
  tool: PreviewTool;
  toolDisabled: Partial<Record<PreviewTool, string>>;
  gizmos: GizmoVisibility;
  hiddenParts: ReadonlySet<string>;
  selectedPart: string | null;
  manifestEditsDisabled: boolean;
  session: AnimationSession;
  // Bumped on load; the viewports re-frame the camera only when this
  // changes, never on document edits.
  framingKey: number;
  onSetTool: (tool: PreviewTool) => void;
  onToggleGizmo: (kind: keyof GizmoVisibility) => void;
  onChangeViewMode: (mode: ViewMode) => void;
  onSelectPart: (name: string | null) => void;
  onPickColor: (index: number) => void;
  onCreateClip: () => void;
  onMovePart: (name: string, position: [number, number, number]) => void;
  onRotatePart: (name: string, rotation: [number, number, number]) => void;
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
  onStrokeVoxels: (name: string, edits: readonly VoxelEdit[]) => void;
}

// The 3D preview, plus the controls that belong to THIS panel rather than
// the global header (panel-system design A2): the tool switch floats over
// the top-left, the gizmo toggles and view-mode switch over the top-right,
// and the palette strip appears only for the tools that paint.
export function PreviewPanel({
  geometry,
  manifest,
  animManifest,
  partPalettes,
  stripPalette,
  activeColorIndex,
  viewMode,
  rigAvailable,
  animAvailable,
  tool,
  toolDisabled,
  gizmos,
  hiddenParts,
  selectedPart,
  manifestEditsDisabled,
  session,
  framingKey,
  onSetTool,
  onToggleGizmo,
  onChangeViewMode,
  onSelectPart,
  onPickColor,
  onCreateClip,
  onMovePart,
  onRotatePart,
  onMovePivot,
  onRotatePivot,
  onMoveSocket,
  onRotateSocket,
  onStrokeVoxels,
}: Props) {
  // Palettes shrink and the selection moves between files, so the stored
  // choice is clamped at use rather than reset on every change.
  const activeColor =
    stripPalette.length === 0
      ? -1
      : Math.min(activeColorIndex, stripPalette.length - 1);

  return (
    <>
      <div className="preview-toolbar-overlay">
        <PreviewToolbar tool={tool} disabled={toolDisabled} onSetTool={onSetTool} />
      </div>
      <div className="view-mode-overlay">
        <div className="gizmo-toggles" role="group" aria-label="Selected-part gizmos">
          <GizmoToggle
            on={gizmos.pivot}
            title="Show the selected part's pivot"
            onClick={() => onToggleGizmo('pivot')}
          >
            <Crosshair size={14} />
          </GizmoToggle>
          <GizmoToggle
            on={gizmos.sockets}
            title="Show the selected part's sockets"
            onClick={() => onToggleGizmo('sockets')}
          >
            <Plug size={14} />
          </GizmoToggle>
          <GizmoToggle
            on={gizmos.frame}
            title="Show the selected part's bounding frame"
            onClick={() => onToggleGizmo('frame')}
          >
            <Box size={14} />
          </GizmoToggle>
        </div>
        <ViewModeToggle
          mode={viewMode}
          rigAvailable={rigAvailable}
          animAvailable={animAvailable}
          onChange={onChangeViewMode}
        />
      </div>
      {viewMode === 'anim' && animManifest !== undefined ? (
        <AnimationViewport
          geometry={geometry}
          manifest={animManifest}
          hiddenParts={hiddenParts}
          session={session}
          manifestEditsDisabled={manifestEditsDisabled}
          partPalettes={partPalettes}
          selectedPart={selectedPart}
          gizmos={gizmos}
          onSelectPart={onSelectPart}
          framingKey={framingKey}
          onCreateClip={onCreateClip}
        />
      ) : (
        <VoxelScene
          geometry={geometry}
          manifest={manifest}
          viewMode={viewMode}
          hiddenParts={hiddenParts}
          partPalettes={partPalettes}
          selectedPart={selectedPart}
          gizmos={gizmos}
          onSelectPart={onSelectPart}
          tool={tool}
          onMovePart={onMovePart}
          onRotatePart={onRotatePart}
          onMovePivot={onMovePivot}
          onRotatePivot={onRotatePivot}
          onMoveSocket={onMoveSocket}
          onRotateSocket={onRotateSocket}
          activeColorIndex={activeColor}
          onStrokeVoxels={onStrokeVoxels}
          framingKey={framingKey}
        />
      )}
      {(tool === 'paint' || tool === 'attach') && (
        <div className="palette-strip-overlay">
          <PaletteStrip
            palette={stripPalette}
            active={activeColor}
            onPick={onPickColor}
          />
        </div>
      )}
    </>
  );
}

function GizmoToggle({
  on,
  title,
  onClick,
  children,
}: {
  on: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={on ? 'active' : ''}
      aria-pressed={on}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
