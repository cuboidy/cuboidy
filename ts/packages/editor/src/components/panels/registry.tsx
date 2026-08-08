import type { Geometry, Manifest, Palette } from '@cuboidy/core';
import type {
  GizmoVisibility,
  PanelContent,
  PreviewTool,
  ViewMode,
} from '@cuboidy/ui';
import { ConsolePanel, type ConsoleEntry } from './ConsolePanel.js';
import { FileTree } from './FileTree.js';
import { KeyInspectorPanel } from './KeyInspectorPanel.js';
import { ModelProperties } from './ModelProperties.js';
import { PalettePanel } from './PalettePanel.js';
import { PartProperties } from './PartProperties.js';
import { PartsPanel } from './PartsPanel.js';
import { PreviewPanel } from './PreviewPanel.js';
import { SourceEditor } from './SourceEditor.js';
import { TimelinePanel } from './TimelinePanel.js';
import type { PaletteTargetInfo } from '../../lib/derived-model.js';
import { filePanelPath, type PanelId } from '../../lib/panels.js';
import { fileText, manifestText, mergeGeometries } from '../../lib/source-ops.js';
import type { LoadedSource } from '../../lib/types.js';
import type { useAnimationEdits } from '../../lib/useAnimationEdits.js';
import type { AnimationSession } from '../../lib/useAnimationSession.js';
import type { useFileOps } from '../../lib/useFileOps.js';
import type { usePaletteEdits } from '../../lib/usePaletteEdits.js';
import type { usePartEdits } from '../../lib/usePartEdits.js';

// Everything the panel bodies read, gathered off App. The edit hooks ride
// wholesale (ReturnType of each), so a handler added to a hook is
// available here without a second declaration — the prop lists cannot
// drift from what the hooks provide.
export interface EditorPanelContext {
  source: LoadedSource;
  panelTitle: (id: PanelId) => string;
  // Document + parse state.
  fileParseErrors: ReadonlyMap<string, string>;
  geometryParseError: string | null;
  manifestParseError: string | null;
  editsBlocked: boolean;
  onEditFileText: (path: string, nextText: string) => void;
  // Derived model (lib/derived-model + App's thin memos).
  merged: ReturnType<typeof mergeGeometries> | undefined;
  viewGeometry: Geometry;
  animManifest: Manifest | undefined;
  clipRefs: ReadonlyMap<string, string>;
  partPalettes: Map<string, Palette> | undefined;
  paletteTarget: PaletteTargetInfo | undefined;
  // Package files by KIND, from their content — what each owning panel
  // offers. Palettes and clips list them ALL, since either may be shared
  // and the panel filters out the one already in use; geometry lists
  // only the UNREFERENCED, because adopting one that is already in the
  // model would be a no-op rather than a re-point.
  paletteFiles: readonly string[];
  clipFiles: readonly string[];
  unreferencedGeometry: readonly string[];
  geometryPaths: readonly string[] | undefined;
  effectiveSelectedPart: string | null;
  treeFileErrors: ReadonlyMap<string, string>;
  consoleEntries: ConsoleEntry[];
  // View state.
  effectiveViewMode: ViewMode;
  rigAvailable: boolean;
  animAvailable: boolean;
  effectivePreviewTool: PreviewTool;
  previewToolDisabled: Partial<Record<PreviewTool, string>>;
  gizmoVis: GizmoVisibility;
  showGrid: boolean;
  framingKey: number;
  activeColorIndex: number;
  onSetPreviewTool: (tool: PreviewTool) => void;
  onToggleGizmo: (kind: keyof GizmoVisibility) => void;
  onToggleGrid: () => void;
  onChangeViewMode: (mode: ViewMode) => void;
  onPickColor: (index: number) => void;
  onOpenPath: (path: string) => void;
  // The shared animation session and the grouped edit hooks.
  animSession: AnimationSession;
  partEdits: ReturnType<typeof usePartEdits>;
  animationEdits: ReturnType<typeof useAnimationEdits>;
  paletteEdits: ReturnType<typeof usePaletteEdits>;
  fileOps: ReturnType<typeof useFileOps>;
}

// Per-panel content for the dock's tab rows. The leaf owns the tab
// header, so each panel supplies just { title, fill?, body }. The source
// panels (preview / geometry / manifest) `fill` their leaf and manage
// their own scrolling (3D canvas, textareas).
export function renderEditorPanel(
  id: PanelId,
  ctx: EditorPanelContext,
): PanelContent | null {
  const { source, animSession, partEdits, animationEdits } = ctx;
  const manifest = source.manifest;
  const title = ctx.panelTitle(id);
  const partFiles = ctx.merged?.files;
  // Dynamic per-file editor tabs (v0.7): any package file the Files
  // tree opened that isn't the primary geometry / manifest pair.
  const fpath = filePanelPath(id);
  if (fpath !== null) {
    const entry = source.files.get(fpath);
    if (entry === undefined) {
      return {
        title,
        body: <p className="panel-empty">File not found in this package.</p>,
      };
    }
    const err = ctx.fileParseErrors.get(fpath);
    return {
      title,
      fill: true,
      body: (
        <SourceEditor
          text={entry}
          {...(err !== undefined && { parseError: err })}
          onChange={(t) => ctx.onEditFileText(fpath, t)}
        />
      ),
    };
  }
  switch (id) {
    case 'preview': {
      // The paint strip offers the SELECTED part's effective palette, so
      // a painted index means the right color in the right file (§7.4).
      const stripPalette =
        (ctx.effectiveSelectedPart !== null
          ? ctx.partPalettes?.get(ctx.effectiveSelectedPart)
          : undefined) ?? ctx.viewGeometry.palette;
      return {
        title,
        fill: true,
        body: (
          <PreviewPanel
            geometry={ctx.viewGeometry}
            manifest={manifest}
            animManifest={ctx.animManifest}
            partPalettes={ctx.partPalettes}
            stripPalette={stripPalette}
            activeColorIndex={ctx.activeColorIndex}
            viewMode={ctx.effectiveViewMode}
            rigAvailable={ctx.rigAvailable}
            animAvailable={ctx.animAvailable}
            tool={ctx.effectivePreviewTool}
            toolDisabled={ctx.previewToolDisabled}
            gizmos={ctx.gizmoVis}
            showGrid={ctx.showGrid}
            hiddenParts={partEdits.hiddenParts}
            selectedPart={ctx.effectiveSelectedPart}
            manifestEditsDisabled={ctx.manifestParseError !== null}
            session={animSession}
            framingKey={ctx.framingKey}
            onSetTool={ctx.onSetPreviewTool}
            onToggleGizmo={ctx.onToggleGizmo}
            onToggleGrid={ctx.onToggleGrid}
            onChangeViewMode={ctx.onChangeViewMode}
            onSelectPart={partEdits.setSelectedPartName}
            onPickColor={ctx.onPickColor}
            onCreateClip={animationEdits.handleCreateAnimationClip}
            onMovePart={partEdits.handleGizmoMovePart}
            onRotatePart={partEdits.handleGizmoRotatePart}
            onMovePivot={partEdits.handleGizmoMovePivot}
            onRotatePivot={partEdits.handleGizmoRotatePivot}
            onMoveSocket={partEdits.handleGizmoMoveSocket}
            onRotateSocket={partEdits.handleGizmoRotateSocket}
            onStrokeVoxels={partEdits.handleStrokeVoxels}
          />
        ),
      };
    }
    case 'timeline':
      return {
        title,
        fill: true,
        body: (
          <TimelinePanel
            session={animSession}
            manifest={ctx.animManifest}
            hasManifest={manifest !== undefined}
            manifestEditsDisabled={ctx.manifestParseError !== null}
            clipRefs={ctx.clipRefs}
            clipFiles={ctx.clipFiles}
            onExternalizeClip={animationEdits.handleExternalizeClip}
            onInlineClip={animationEdits.handleInlineClip}
            onUseClipFile={animationEdits.handleUseClipFile}
            onTrimClip={animationEdits.handleTrimClip}
            onSetClipDuration={animationEdits.handleSetClipDuration}
            onSetClipLoop={animationEdits.handleSetClipLoop}
            onCreateClip={animationEdits.handleCreateAnimationClip}
            onRenameClip={animationEdits.handleRenameClip}
            onDeleteClip={animationEdits.handleDeleteClip}
          />
        ),
      };
    case 'inspector':
      return {
        title,
        body: (
          <KeyInspectorPanel
            session={animSession}
            manifestEditsDisabled={ctx.manifestParseError !== null}
            onSetAnimField={animationEdits.handleSetAnimField}
            onSetAnimEase={animationEdits.handleSetAnimEase}
            onDeleteAnimKey={animationEdits.handleDeleteAnimKey}
          />
        ),
      };
    case 'geometry': {
      // An all-inline model (§6.13) has no geometry FILE to open here;
      // its shapes are in cuboidy.json, which the manifest tab shows.
      const primary = source.primaryPath;
      return {
        title,
        fill: true,
        body:
          primary === undefined ? (
            <p className="panel-empty">
              This model keeps every part&apos;s geometry in the manifest —
              open cuboidy.json to edit it as text.
            </p>
          ) : (
            <SourceEditor
              text={fileText(source, primary) ?? ''}
              {...(ctx.geometryParseError !== null && {
                parseError: ctx.geometryParseError,
              })}
              onChange={(t) => ctx.onEditFileText(primary, t)}
            />
          ),
      };
    }
    case 'manifest':
      return {
        title,
        fill: true,
        body: (
          <SourceEditor
            text={manifestText(source) ?? ''}
            {...(ctx.manifestParseError !== null && {
              parseError: ctx.manifestParseError,
            })}
            onChange={(t) => ctx.onEditFileText(source.manifestPath, t)}
          />
        ),
      };
    case 'model':
      return {
        title,
        body: (
          <ModelProperties
            manifest={manifest}
            disabled={ctx.manifestParseError !== null}
            onChangeName={partEdits.handleChangeModelName}
            onChangeVersion={partEdits.handleChangeModelVersion}
          />
        ),
      };
    case 'files':
      return {
        title,
        // A `fill` panel so the toolbar can sit outside the tree's
        // scroller — see FileTree.
        fill: true,
        body: (
          <FileTree
            source={source}
            fileErrors={ctx.treeFileErrors}
            onOpenPath={ctx.onOpenPath}
            onCreateFile={ctx.fileOps.handleCreateFile}
            onRenameFile={ctx.fileOps.handleRenameFile}
            onMoveFolder={ctx.fileOps.handleMoveFolder}
            onRenameFolder={ctx.fileOps.handleRenameFolder}
            onDeleteFile={ctx.fileOps.handleDeleteFile}
            onDeleteFolder={ctx.fileOps.handleDeleteFolder}
          />
        ),
      };
    case 'parts': {
      return {
        title: 'Parts',
        fill: true,
        body: (
          <PartsPanel
            parts={ctx.merged?.parts ?? ctx.viewGeometry.parts}
            partFiles={ctx.geometryPaths !== undefined ? partFiles : undefined}
            geometryFiles={ctx.geometryPaths}
            manifest={manifest}
            hiddenParts={partEdits.hiddenParts}
            selectedPart={ctx.effectiveSelectedPart}
            creating={partEdits.creating}
            editsBlocked={ctx.editsBlocked}
            unreferencedGeometry={ctx.unreferencedGeometry}
            onAddGeometryFile={ctx.fileOps.handleAddFileToModel}
            onStartCreate={partEdits.handleStartCreatePart}
            onShowAll={partEdits.handleShowAll}
            onHideAll={partEdits.handleHideAll}
            onToggleVisibility={partEdits.handleToggle}
            onSelectPart={partEdits.setSelectedPartName}
            onChangeParent={partEdits.handleChangePartParent}
            onConfirmCreate={(name, file) =>
              partEdits.handleConfirmCreatePart(
                name,
                partEdits.creating?.parent ?? null,
                file,
              )
            }
            onCancelCreate={partEdits.handleCancelCreatePart}
            onRenamePart={partEdits.handleRenamePart}
          />
        ),
      };
    }
    case 'properties':
      return {
        title: 'Properties',
        body:
          ctx.effectiveSelectedPart !== null ? (
            <PartProperties
              selectedPart={ctx.effectiveSelectedPart}
              geometry={ctx.viewGeometry}
              manifest={manifest}
              manifestEditsDisabled={ctx.manifestParseError !== null}
              renameDisabled={ctx.editsBlocked}
              geometryFiles={ctx.geometryPaths}
              partFile={partFiles?.get(ctx.effectiveSelectedPart)}
              moveDisabled={ctx.editsBlocked}
              geometryEditsDisabled={ctx.editsBlocked}
              onChangeParent={partEdits.handleChangePartParent}
              onChangePosition={partEdits.handleChangePartPosition}
              onChangeRotation={partEdits.handleChangePartRotation}
              onToggleRotation={partEdits.handleTogglePartRotation}
              onRenamePart={partEdits.handleRenamePart}
              onDeletePart={partEdits.handleDeletePart}
              onMovePart={partEdits.handleMovePart}
              onEditPart={partEdits.handleEditPart}
              onRenameSocket={partEdits.handleRenameSocket}
              onDeleteSocket={partEdits.handleDeleteSocket}
              onPublishSocket={partEdits.handlePublishSocket}
              onDuplicatePart={partEdits.handleDuplicatePart}
              onMirrorPart={partEdits.handleMirrorPart}
            />
          ) : (
            <p className="panel-empty">
              Select a part to edit its properties.
            </p>
          ),
      };
    case 'palette': {
      // paletteTarget is defined whenever a source is, and already
      // handles the manifest-palette case (§6.13), so this is only a
      // type-level floor.
      const target: PaletteTargetInfo = ctx.paletteTarget ?? {
        palette: ctx.viewGeometry.palette,
        scopeParts: ctx.viewGeometry.parts,
        unresolved: false,
      };
      const shared = target.ref !== undefined;
      const { paletteEdits } = ctx;
      return {
        title: 'Palette',
        body: (
          <PalettePanel
            palette={target.palette}
            parts={target.scopeParts}
            target={{
              ...(target.file !== undefined && { file: target.file }),
              ...(target.ref !== undefined && { ref: target.ref }),
            }}
            disabled={ctx.editsBlocked || target.unresolved}
            disabledReason={
              target.unresolved
                ? `The palette ${target.file ?? 'cuboidy.json'} points at (${target.ref}) is missing or invalid — pick another one above, or fix that file.`
                : undefined
            }
            // The binding survives an unresolved reference on purpose:
            // re-pointing is how that state gets fixed. Only a mid-edit
            // parse error locks it, where a rewrite would clobber text.
            bindingLocked={ctx.editsBlocked || manifest === undefined}
            onChange={(next, tag) =>
              paletteEdits.handleEditPalette(target.file, next, tag)
            }
            onDeleteColor={(index) =>
              paletteEdits.handleDeletePaletteColor(target.file, index)
            }
            paletteFiles={ctx.paletteFiles}
            // The three storage moves, offered only where they mean
            // something: no "new file" once referenced or with no colors
            // to write, no "inline" unless a reference resolved.
            onExternalize={
              !shared && target.palette.length > 0
                ? () => paletteEdits.handleExternalizePalette(target.file)
                : undefined
            }
            onInline={
              shared && !target.unresolved
                ? () => paletteEdits.handleInlinePalette(target.file)
                : undefined
            }
            onUsePaletteFile={(ref) =>
              paletteEdits.handleUsePaletteFile(target.file, ref)
            }
          />
        ),
      };
    }
    case 'console':
      return { title, body: <ConsolePanel entries={ctx.consoleEntries} /> };
  }
  // Unreachable for static ids (the switch is exhaustive over them);
  // satisfies TS now that PanelId also includes dynamic file ids.
  return null;
}
