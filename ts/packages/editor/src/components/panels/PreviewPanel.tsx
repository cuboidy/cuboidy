import { Box, Crosshair, Plug, Plus } from 'lucide-react';
import type { Geometry, Manifest, Palette } from '@cuboidy/core';
import { AnimationViewport } from '../scene/AnimationViewport.js';
import { PaletteStrip } from '../ui/PaletteStrip.js';
import { PreviewToolbar } from '../ui/PreviewToolbar.js';
import { ViewModeToggle } from '../ui/ViewModeToggle.js';
import { VoxelScene } from '../scene/VoxelScene.js';
import type { AnimationSession } from '../../lib/useAnimationSession.js';
import { ToggleGroup, ToolOverlay, Transport, ViewOverlay } from '@cuboidy/ui';
import type { GizmoVisibility, PreviewTool, ViewMode, VoxelEdit } from '@cuboidy/ui';

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

  // The transport lives here rather than inside the anim viewport, so it
  // is present in every view. It used to appear and disappear with the
  // view mode, which jumped the layout and made the preview the one place
  // in either app where an unavailable control is HIDDEN instead of
  // disabled with its reason on it.
  //
  // Cause before consequence: a model with no animations says so, rather
  // than telling you to switch to a view that would then say the same.
  const transportDisabled =
    session.inline === undefined
      ? 'This model has no animations yet'
      : viewMode !== 'anim'
        ? 'Switch to Anim view to play'
        : !session.hasTimeline
          ? 'This clip has no keyframes yet'
          : undefined;

  return (
    <>
      {/* The stage is what the overlays anchor to, so the tool bar sits
          over the 3D and not over the transport below it. */}
      <div className="preview-stage">
      <ToolOverlay>
        <PreviewToolbar tool={tool} disabled={toolDisabled} onSetTool={onSetTool} />
      </ToolOverlay>
      <ViewOverlay>
        <ToggleGroup
          label="Selected-part gizmos"
          items={[
            {
              id: 'pivot',
              icon: Crosshair,
              label: "Show the selected part's pivot",
              on: gizmos.pivot,
            },
            {
              id: 'sockets',
              icon: Plug,
              label: "Show the selected part's sockets",
              on: gizmos.sockets,
            },
            {
              id: 'frame',
              icon: Box,
              label: "Show the selected part's bounding frame",
              on: gizmos.frame,
            },
          ]}
          onToggle={onToggleGizmo}
        />
        <ViewModeToggle
          mode={viewMode}
          rigAvailable={rigAvailable}
          animAvailable={animAvailable}
          onChange={onChangeViewMode}
        />
      </ViewOverlay>
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
      </div>

      <Transport
        playing={session.playing}
        time={session.time}
        duration={session.duration}
        {...(transportDisabled !== undefined && { disabled: transportDisabled })}
        onToggle={() => session.setPlaying((p) => !p)}
        onScrub={session.scrub}
      >
        {session.inlineNames.length > 1 ? (
          <select
            className="anim-select"
            value={session.activeName}
            aria-label="Animation"
            onChange={(e) => session.setSelectedClip(e.target.value)}
          >
            {session.inlineNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          session.inline !== undefined && (
            <span className="anim-name">{session.activeName}</span>
          )
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
      </Transport>
    </>
  );
}
