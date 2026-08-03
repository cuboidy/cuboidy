import {
  useCallback,
  useMemo,
  useState,
} from 'react';
import { type Geometry } from '@cuboidy/core';
import { type ConsoleEntry } from './components/panels/ConsolePanel.js';
import { lintSource } from './lib/lint.js';

import { ExportMenu } from './components/ui/ExportMenu.js';
import { FolderOpen, Plus } from 'lucide-react';
import { FileDropZone } from './components/ui/FileDropZone.js';
import { SaveButton } from './components/ui/SaveButton.js';
import { SettingsMenu } from './components/ui/SettingsMenu.js';
import { animManifestOf, clipRefsOf, modelGeometryOf, partPalettesOf, paletteTargetOf, type PaletteTargetInfo } from './lib/derived-model.js';
import { buildConsoleEntries, buildTreeFileErrors } from './components/panels/console-entries.js';
import { renderEditorPanel } from './components/panels/registry.js';

import { mergeGeometries, pathBasename } from './lib/source-ops.js';
import { useAnimationEdits } from './lib/useAnimationEdits.js';
import { useFileOps } from './lib/useFileOps.js';
import { usePaletteEdits } from './lib/usePaletteEdits.js';
import { usePartEdits } from './lib/usePartEdits.js';
import { useProjectDocument } from './lib/useProjectDocument.js';
import { useAnimationSession } from './lib/useAnimationSession.js';
import type { LoadResult } from './lib/types.js';
import { AppHeader, Dock, HeaderDivider, HeaderGroup, UndoRedoGroup, isPanelVisible, useDockLayout } from '@cuboidy/ui';
import {
  ALL_PANELS,
  MAIN_PANEL,
  filePanel,
  filePanelPath,
  initialLayout,
} from './lib/panels.js';
import type {
  GizmoVisibility,
  PanelContent,
  PreviewTool,
  ViewMode,
} from '@cuboidy/ui';
import type { PanelId } from './lib/panels.js';

export function App() {
  // The document, its undo history, and the parse state that gates
  // structural edits (lib/useProjectDocument).
  const {
    loaded,
    loadedRef,
    canUndo,
    canRedo,
    dispatchEdit,
    replaceDocument,
    fileParseErrors,
    setFileParseErrors,
    geometryParseError,
    manifestParseError,
    editsBlocked,
    handleEditFileText,
    performUndo,
    performRedo,
  } = useProjectDocument();
  const [viewMode, setViewMode] = useState<ViewMode>('geometry');
  // Per-kind visibility of the selected part's preview gizmos (pivot /
  // sockets / frame), toggled from the preview overlay. The flags outlive
  // selection changes and loads — they're a viewer preference, not model
  // state.
  const [gizmoVis, setGizmoVis] = useState<GizmoVisibility>({
    pivot: true,
    sockets: true,
    frame: true,
  });
  const handleToggleGizmo = useCallback((kind: keyof GizmoVisibility) => {
    setGizmoVis((v) => ({ ...v, [kind]: !v[kind] }));
  }, []);
  // Active preview tool. Kept as the user's raw choice —
  // the effective tool (computed below with the availability map) falls
  // back to 'select' while the choice isn't usable in the current view,
  // and comes back when it is.
  const [previewTool, setPreviewTool] = useState<PreviewTool>('select');
  // Bumped on model load; the 3D viewports recompute their camera
  // framing (orbit target + distance) only when this changes or the
  // view switches — never on document edits, so moving a part can't
  // drag the viewpoint along.
  const [framingKey, setFramingKey] = useState(0);
  // Paint/attach tools' active color — an index into the selected
  // part's effective palette, picked from the preview's PaletteStrip.
  // Clamped at use (palettes shrink; selection changes files).
  const [activeColorIndex, setActiveColorIndex] = useState(0);

  // The grouped edit hooks ride into the panel registry wholesale; App
  // destructures only what its own body reads.
  // Part + rig editing, and the selection it acts on (lib/usePartEdits).
  const partEdits = usePartEdits({
    loaded,
    loadedRef,
    dispatchEdit,
    editsBlocked,
    manifestParseError,
  });
  const { selectedPartName, resetPartState } = partEdits;

  // Palette editing (lib/usePaletteEdits).
  const paletteEdits = usePaletteEdits({ dispatchEdit, editsBlocked });

  // Package file create / rename / move / delete (lib/useFileOps).
  const fileOps = useFileOps({ dispatchEdit, setFileParseErrors });

  const source = loaded?.source;

  // Display title for any panel. Static for tool panels; the source files take
  // their actual file name so the dock tab reads "voxels.json" / "cuboidy.json"
  // (matching the file tree). Used for both tab labels and the + menu.
  const panelTitle = useCallback(
    (id: PanelId): string => {
      const fpath = filePanelPath(id);
      if (fpath !== null) return pathBasename(fpath);
      switch (id) {
        case 'files':
          return 'Files';
        case 'model':
          return 'Model';
        case 'parts':
          return 'Parts';
        case 'properties':
          return 'Properties';
        case 'palette':
          return 'Palette';
        case 'inspector':
          return 'Key Inspector';
        case 'preview':
          return 'Preview';
        case 'timeline':
          return 'Timeline';
        case 'console':
          return 'Console';
        case 'geometry':
          return source?.primaryPath ?? 'voxels.json';
        case 'manifest':
          return source?.manifestPath ?? 'cuboidy.json';
        default:
          return id;
      }
    },
    [source],
  );

  // Dock layout tree (resizable, rearrangeable): state, the six Dock
  // handlers, closed-panel list, reset and reopen all come from the
  // shared hook. In-memory only — layout is session-scoped by design (no
  // persistence); "Reset layout" restores the initial arrangement. Null =
  // every panel closed; App renders an add-panel state.
  const dock = useDockLayout<PanelId>({
    initial: initialLayout,
    allPanels: ALL_PANELS,
    titleOf: panelTitle,
    mainPanel: MAIN_PANEL,
  });
  const { layout, closedPanels, openPanel } = dock;

  // Creating a clip moves the editor to the anim view. Layout state lives
  // here, so the hook calls back rather than reaching for it.
  const onClipCreated = useCallback(() => {
    setViewMode('anim');
    openPanel('preview');
  }, [openPanel]);
  // Every keyframe-editor edit (lib/useAnimationEdits).
  const animationEdits = useAnimationEdits({
    dispatchEdit,
    editsBlocked,
    onClipCreated,
  });

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);
  const rigAvailable =
    source !== undefined && source.manifest !== undefined;
  // The anim view doubles as the animation editor, so it's reachable for any
  // rigged model (a manifest with no animations shows an empty state with a
  // "Create animation" action). Same requirement as rig view: a manifest.
  const animAvailable = rigAvailable;
  // Guard against a stale selection: if the user switched to anim/rig and
  // then edited the source so the requirement no longer holds, fall back to
  // the most specific still-valid view rather than rendering a broken pane.
  const effectiveViewMode: ViewMode =
    viewMode === 'anim' && !animAvailable
      ? rigAvailable
        ? 'rig'
        : 'geometry'
      : viewMode === 'rig' && !rigAvailable
        ? 'geometry'
        : viewMode;

  // Preview toolbar availability: a disabled tool
  // carries its reason as the tooltip. Move edits the manifest, so it
  // needs the rig view and a clean manifest AST. The not-yet-built
  // tools stay visible (the toolbar is the locked design) but disabled.
  const previewToolDisabled = useMemo(() => {
    const d: Partial<Record<PreviewTool, string>> = {};
    if (effectiveViewMode === 'anim') {
      d.move = 'Rest editing lives in the Rig and Geometry views';
      d.rotate = 'Rest editing lives in the Rig and Geometry views';
      d.attach = 'Voxel editing lives in the Rig and Geometry views for now';
      d.erase = 'Voxel editing lives in the Rig and Geometry views for now';
      d.paint = 'Voxel editing lives in the Rig and Geometry views for now';
    } else if (editsBlocked) {
      const msg = 'Fix the syntax errors first';
      d.move = msg;
      d.rotate = msg;
      d.attach = msg;
      d.erase = msg;
      d.paint = msg;
    }
    return d;
  }, [effectiveViewMode, editsBlocked]);
  const effectivePreviewTool: PreviewTool =
    previewToolDisabled[previewTool] !== undefined ? 'select' : previewTool;

  // The display model: all geometry files' parts merged (Phase C), with
  // the SPEC §6.10 palette precedence applied for rendering — a manifest-
  // bound external palette wins over the inline one. Editing surfaces
  // (PalettePanel, source text) keep operating on the real per-file data.
  const merged = useMemo(
    () => (source === undefined ? undefined : mergeGeometries(source)),
    [source],
  );
  const partFiles = merged?.files;

  // Core's lint over the current model — the same `lintGeometry` +
  // `validateProject` the CLI runs, so the editor and `cuboidy-lint`
  // cannot disagree about a package. Derived from `source`, which is
  // reparsed as text is typed, so findings follow the edit.
  const lintDiagnostics = useMemo(
    () => (source === undefined ? [] : lintSource(source)),
    [source],
  );

  // Prune a selection that points at a part the model no longer
  // contains (e.g., user edited the source view to remove it). Done
  // at render time rather than via effect so downstream components
  // never see the dangling name even for one frame.
  const effectiveSelectedPart = useMemo(() => {
    if (selectedPartName === null || merged === undefined) return null;
    return merged.parts.some((p) => p.name === selectedPartName)
      ? selectedPartName
      : null;
  }, [selectedPartName, merged]);

  // The pure derivations live in lib/derived-model; App keeps thin memos.
  const animManifest = useMemo(
    () => (source === undefined ? undefined : animManifestOf(source)),
    [source],
  );
  // Clip name → external file path, for the timeline's storage label and
  // the Externalize / Inline toggle.
  const clipRefs = useMemo(
    () => (source === undefined ? new Map<string, string>() : clipRefsOf(source)),
    [source],
  );
  const modelGeometry = useMemo(
    (): Geometry | undefined =>
      source === undefined || merged === undefined
        ? undefined
        : modelGeometryOf(source, merged.parts),
    [source, merged],
  );
  // What the panels render: the WHOLE model — every geometry file's parts
  // plus every part written inline (SPEC §6.13). This used to fall back to
  // the primary geometry file, which an all-inline model does not have.
  const viewGeometry: Geometry = modelGeometry ?? { palette: [], parts: [] };
  // Per-part render palettes (SPEC §7.4 / §6.13): every part resolves
  // against its own source's colors — its defining file's, or, for a part
  // written inline in the manifest, whatever §6.13 resolved for it.
  //
  // Skipped when the parts CANNOT disagree: one geometry file and nothing
  // inline, where modelGeometry's palette already covers everything. Any
  // inline part makes the map necessary even in a one-file model, because
  // it takes its colors from the manifest rather than from that file.
  const partPalettes = useMemo(
    () => (source === undefined ? undefined : partPalettesOf(source)),
    [source],
  );
  // What the Palette panel edits (§7.4) — see paletteTargetOf.
  const paletteTarget = useMemo(
    (): PaletteTargetInfo | undefined =>
      source === undefined
        ? undefined
        : paletteTargetOf(source, effectiveSelectedPart, partFiles, merged?.parts),
    [source, effectiveSelectedPart, partFiles, merged],
  );

  // Geometry files a part can be created in or moved to. Undefined for a
  // single-geometry model, where there is no choice to offer.
  const geometryPaths = useMemo(
    () =>
      source !== undefined && source.geometries.size > 1
        ? [...source.geometries.keys()]
        : undefined,
    [source],
  );

  const handleLoad = useCallback(
    (result: LoadResult) => {
      replaceDocument(result);
      resetPartState();
      setFramingKey((k) => k + 1);
      const hasManifest =
        result.source !== undefined &&
        result.source.manifest !== undefined;
      setViewMode(hasManifest ? 'rig' : 'geometry');
      openPanel('preview');
      // A load that carries problems (a manifest that didn't parse, an
      // unresolved reference) foregrounds the Console so the notice isn't
      // silently hidden behind the Timeline tab.
      if (
        result.source !== undefined &&
        (result.source.manifestError !== undefined ||
          (result.source.projectErrors?.length ?? 0) > 0)
      ) {
        openPanel('console');
      }
    },
    [replaceDocument, resetPartState, openPanel],
  );

  const handleReset = useCallback(() => {
    replaceDocument(null);
    resetPartState();
    setViewMode('geometry');
    // A paint color is per-model state: index 3 in the next model is a
    // different (or missing) color.
    setActiveColorIndex(0);
  }, [replaceDocument, resetPartState]);

  // Click a file in the tree → bring its panel forward (re-opening it if
  // it was closed). The primary geometry maps to the classic geometry panel,
  // cuboidy.json to the manifest panel, anything else to a dynamic
  // per-file tab.
  const handleOpenPath = useCallback(
    (path: string) => {
      const src = loaded?.source;
      if (src === undefined) return;
      const id: PanelId =
        path === src.primaryPath
          ? 'geometry'
          : src.manifestPath === path
            ? 'manifest'
            : filePanel(path);
      openPanel(id);
    },
    [loaded, openPanel],
  );
  // Console entries + the Files tree's red names, assembled beside the
  // panel that shows them (components/panels/console-entries).
  const consoleEntries = useMemo(
    (): ConsoleEntry[] =>
      source === undefined
        ? []
        : buildConsoleEntries(
            source,
            fileParseErrors,
            manifestParseError,
            lintDiagnostics,
          ),
    [source, fileParseErrors, manifestParseError, lintDiagnostics],
  );
  const treeFileErrors = useMemo(
    () =>
      source === undefined
        ? new Map<string, string>()
        : buildTreeFileErrors(
            source,
            fileParseErrors,
            manifestParseError,
            geometryParseError,
          ),
    [source, fileParseErrors, geometryParseError, manifestParseError],
  );

  // Shared animation session (active clip, playback time, selected key). Owned
  // here so the Preview viewport and the Timeline panel are separate dock
  // panels reading the same state. The clock/Space follow the anim viewport;
  // the lane-editing keys follow the Timeline panel's visibility.
  const animSession = useAnimationSession({
    geometry: modelGeometry,
    manifest: animManifest,
    clockEnabled: effectiveViewMode === 'anim' && animManifest !== undefined,
    editKeysEnabled:
      layout !== null && isPanelVisible(layout, 'timeline') && animManifest !== undefined,
    onAddAnimKey: animationEdits.handleAddAnimKey,
    onDeleteAnimKey: animationEdits.handleDeleteAnimKey,
    onMoveAnimKey: animationEdits.handleMoveAnimKey,
    onClearPartTrack: animationEdits.handleClearPartTrack,
    onPasteAnimKeyframe: animationEdits.handlePasteAnimKeyframe,
  });
  // Per-panel content for the dock's tab rows, built by the registry
  // (components/panels/registry) from one context bag. The edit hooks
  // ride wholesale, so the wiring lives beside the panels.
  const getPanel = (id: PanelId): PanelContent | null => {
    if (source === undefined) return null;
    return renderEditorPanel(id, {
      source,
      panelTitle,
      fileParseErrors,
      geometryParseError,
      manifestParseError,
      editsBlocked,
      onEditFileText: handleEditFileText,
      merged,
      viewGeometry,
      animManifest,
      clipRefs,
      partPalettes,
      paletteTarget,
      geometryPaths,
      effectiveSelectedPart,
      treeFileErrors,
      consoleEntries,
      effectiveViewMode,
      rigAvailable,
      animAvailable,
      effectivePreviewTool,
      previewToolDisabled,
      gizmoVis,
      framingKey,
      activeColorIndex,
      onSetPreviewTool: setPreviewTool,
      onToggleGizmo: handleToggleGizmo,
      onChangeViewMode: handleViewModeChange,
      onPickColor: setActiveColorIndex,
      onOpenPath: handleOpenPath,
      animSession,
      partEdits,
      animationEdits,
      paletteEdits,
      fileOps,
    });
  };

  return (
    <div className="app">
      <AppHeader
        product="Editor"
        left={source !== undefined ? (
            <SettingsMenu onResetLayout={dock.reset} />
          ) : undefined}
        right={
          <>
            {source !== undefined && (
              <>
                <UndoRedoGroup
                  canUndo={canUndo}
                  canRedo={canRedo}
                  onUndo={performUndo}
                  onRedo={performRedo}
                />
                <HeaderDivider />
                <HeaderGroup>
                  <SaveButton source={source} />
                  <ExportMenu source={source} />
                </HeaderGroup>
                <HeaderDivider />
              </>
            )}
            {loaded !== null && (
              <button
                type="button"
                className="btn"
                title="Load a different model"
                onClick={handleReset}
              >
                <FolderOpen size={14} />
                Load another
              </button>
            )}
          </>
        }
      />
      <main className="main">
        {source === undefined ? (
          <FileDropZone onLoad={handleLoad} />
        ) : layout === null ? (
          <div className="dock-empty">
            <p className="dock-empty-title">All panels are closed.</p>
            <div className="dock-empty-actions">
              {closedPanels.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className="btn btn-create"
                  onClick={() => openPanel(p.id)}
                >
                  <Plus size={13} />
                  {p.title}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn"
              onClick={dock.reset}
            >
              Reset layout
            </button>
          </div>
        ) : (
          <Dock
            node={layout}
            getPanel={getPanel}
            closedPanels={closedPanels}
            onResize={dock.onResize}
            onActivate={dock.onActivate}
            onClose={dock.onClose}
            onAdd={dock.onAdd}
            onSplit={dock.onSplit}
            onReorder={dock.onReorder}
          />
        )}
      </main>
      {loaded !== null && loaded.source === undefined && (
        <Notices loaded={loaded} />
      )}
    </div>
  );
}

// Hard load failure only (no source → no dock → no Console panel): the
// error strip renders under the drop zone. Loaded-model problems live in
// the Console panel instead.
function Notices({ loaded }: { loaded: LoadResult }) {
  return (
    <aside className="notices">
      {loaded.error !== undefined && (
        <div className="notice error">
          <strong>Error:</strong> {loaded.error}
        </div>
      )}
    </aside>
  );
}
