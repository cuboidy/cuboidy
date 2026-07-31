import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  AIR,
  type Geometry,
  type Manifest,
  type Part,
  type Palette,
} from '@cuboidy/core';
import { ConsolePanel, type ConsoleEntry } from './components/ConsolePanel.js';
import { Dock, type PanelContent } from './components/Dock.js';
import { ExportMenu } from './components/ExportMenu.js';
import { Logo } from './components/Logo.js';
import {
  FolderOpen,
  Plus,
  Redo2,
  Undo2,
} from 'lucide-react';
import { FileDropZone } from './components/FileDropZone.js';
import { FileTree } from './components/FileTree.js';
import { ModelProperties } from './components/ModelProperties.js';
import { KeyInspectorPanel } from './components/KeyInspectorPanel.js';
import { PalettePanel } from './components/PalettePanel.js';
import { PreviewPanel } from './components/PreviewPanel.js';
import { PartProperties } from './components/PartProperties.js';
import { PartsPanel } from './components/PartsPanel.js';
import { SaveButton } from './components/SaveButton.js';
import { SettingsMenu } from './components/SettingsMenu.js';
import { SourceEditor } from './components/SourceEditor.js';
import { TimelinePanel } from './components/TimelinePanel.js';
import { historyReducer, makeHistory } from './lib/history.js';
import {
  normalizePath,
} from './lib/load-model.js';
import {
  addPanelAt,
  closePanelAt,
  filePanel,
  filePanelPath,
  initialLayout,
  isPanelVisible,
  openPanelById,
  placePanelBeside,
  placedPanels,
  splitLeafWith,
  withActiveAt,
  withRatioAt,
  ALL_PANELS,
  type Edge,
  type LayoutNode,
  type LeafId,
  type Side,
} from './lib/layout.js';
import {
  fileText,
  geometryAt,
  manifestText,
  mapGeometryFiles,
  mergeGeometries,
  paletteFileText,
  applyFileEdit,
  pathBasename,
  primaryGeometry,
  sharesPalette,
  withManifest,
  writeFile,
} from './lib/source-ops.js';
import { synthesizeManifest } from './lib/synthesize-manifest.js';
import { useAnimationEdits } from './lib/useAnimationEdits.js';
import { useFileOps } from './lib/useFileOps.js';
import { usePartEdits } from './lib/usePartEdits.js';
import { useAnimationSession } from './lib/useAnimationSession.js';
import type {
  GizmoVisibility,
  LoadResult,
  PreviewTool,
  ViewMode,
} from './lib/types.js';

// What the Palette panel is pointed at: one geometry file, its resolved
// colors, and — when those colors live in a shared palette file — the path
// they came from.
interface PaletteTargetInfo {
  file: string;
  palette: Palette;
  ref?: string;
}

export function App() {
  // The loaded document plus its undo/redo history, in one pure reducer.
  // Every structural mutation goes through `dispatchEdit` (recorded, with
  // optional coalescing tag); reparse successes `amend` (AST half of an
  // already-recorded text edit); load/reset `replace` (history cleared).
  const [history, dispatch] = useReducer(
    historyReducer<LoadResult | null>,
    null,
    makeHistory<LoadResult | null>,
  );
  const loaded = history.present;
  // Latest-value ref so a handler can read the CURRENT document without
  // re-binding every callback on each edit.
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const dispatchEdit = useCallback(
    (tag: string | null, apply: (c: LoadResult | null) => LoadResult | null) => {
      dispatch({ type: 'edit', tag, at: Date.now(), apply });
    },
    [],
  );
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
  // Active preview tool (design §2.1). Kept as the user's raw choice —
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
  // Syntax errors on the CURRENTLY TYPED text, per file path. One map
  // covers every file — the primary geometry and the manifest are just
  // entries in it like any other. Derived from the text by applyFileEdit,
  // so undo/redo re-derives rather than restoring it.
  const [fileParseErrors, setFileParseErrors] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const setFileParseError = useCallback((path: string, msg: string | null) => {
    setFileParseErrors((prev) => {
      if (msg === null && !prev.has(path)) return prev;
      const next = new Map(prev);
      if (msg === null) next.delete(path);
      else next.set(path, msg);
      return next;
    });
  }, []);
  // Named views onto the same map, for the panels that speak in terms of
  // "the geometry source" and "the manifest source".
  const geometryParseError =
    loaded?.source === undefined
      ? null
      : (fileParseErrors.get(loaded.source.primaryPath) ?? null);
  const manifestParseError =
    loaded?.source?.manifestPath === undefined
      ? null
      : (fileParseErrors.get(loaded.source.manifestPath) ?? null);
  // THE structural-edit gate (audit A-6). A structural edit re-serializes
  // an AST over a file's text, so it must not run while any text is
  // mid-edit unparseable — the last good AST would silently overwrite what
  // the user just typed. This is a STATE check on the current text; the
  // gate it replaces keyed off whether a debounce timer was pending, which
  // let an edit through the moment that timer had fired and REPORTED the
  // error.
  const editsBlocked = fileParseErrors.size > 0;

  // Part + rig editing, and the selection it acts on (lib/usePartEdits).
  const {
    hiddenParts,
    selectedPartName,
    setSelectedPartName,
    creating,
    resetPartState,
    handleToggle,
    handleShowAll,
    handleHideAll,
    handleEditPart,
    handleStartCreatePart,
    handleCancelCreatePart,
    handleConfirmCreatePart,
    handleDuplicatePart,
    handleMirrorPart,
    handleMovePart,
    handleRenamePart,
    handleDeletePart,
    handleChangeModelName,
    handleChangeModelVersion,
    handleChangePartParent,
    handleChangePartPosition,
    handleChangePartRotation,
    handleTogglePartRotation,
    handleGizmoMovePart,
    handleGizmoRotatePart,
    handleGizmoMovePivot,
    handleGizmoRotatePivot,
    handleGizmoMoveSocket,
    handleGizmoRotateSocket,
    handleStrokeVoxels,
  } = usePartEdits({
    loaded,
    loadedRef,
    dispatchEdit,
    editsBlocked,
    manifestParseError,
  });

  const handleLoad = useCallback(
    (result: LoadResult) => {
      setFileParseErrors(new Map());
      dispatch({ type: 'replace', next: result });
      resetPartState();
      setFramingKey((k) => k + 1);
      const hasManifest =
        result.source !== undefined &&
        result.source.manifest !== undefined;
      setViewMode(hasManifest ? 'rig' : 'geometry');
      setLayout((l) => openPanelById(l, 'preview'));
      // A load that carries problems (a manifest that didn't parse, an
      // unresolved reference) foregrounds the Console so the notice isn't
      // silently hidden behind the Timeline tab.
      if (
        result.source !== undefined &&
        (result.source.manifestError !== undefined ||
          (result.source.projectErrors?.length ?? 0) > 0)
      ) {
        setLayout((l) => openPanelById(l, 'console'));
      }
    },
    [resetPartState],
  );

  const handleReset = useCallback(() => {
    setFileParseErrors(new Map());
    dispatch({ type: 'replace', next: null });
    resetPartState();
    setViewMode('geometry');
  }, [resetPartState]);

  // ONE source-text edit path for every file — the primary geometry, the
  // manifest and every other package file alike. The text is recorded and
  // its derived state re-computed in the SAME dispatch, so there is no
  // window in which the two disagree and nothing to flush before a
  // structural edit. applyFileEdit does the deriving; text that does not
  // parse only records the text and reports the error.
  const handleEditFileText = useCallback(
    (path: string, nextText: string) => {
      const src = loadedRef.current?.source;
      if (src === undefined) return;
      setFileParseError(path, applyFileEdit(src, path, nextText).error);
      // Recorded with a per-file tag: a typing burst (keystrokes < 800ms
      // apart) is one undo entry whose pre-state is the text before the
      // burst started.
      dispatchEdit(`text:${path}`, (current) => {
        const cur = current?.source;
        if (cur === undefined) return current;
        const { source } = applyFileEdit(cur, path, nextText);
        return source === cur ? current : { ...current, source };
      });
    },
    [dispatchEdit, setFileParseError],
  );

  // ── Palette editing. SPEC §7.4: a palette belongs to a GEOMETRY FILE,
  // either spelled out inline or referenced from a shared palette file. So
  // every operation here names the file it acts on — the panel picks that
  // from the selected part. A reference routes the write to the palette
  // file, and therefore to every geometry file sharing it; an inline
  // palette is rewritten in place. There is no model-wide palette and no
  // precedence rule left to reconcile. ──

  // Overwrite a file's palette colors (edit / add).
  const handleEditPalette = useCallback(
    (file: string, next: Palette, tag?: string) => {
      if (editsBlocked) return;
      dispatchEdit(tag ?? null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const geometry = geometryAt(src, file);
        if (geometry === undefined) return current;
        if (geometry.paletteRef === undefined) {
          const nextSrc = mapGeometryFiles(src, (g, path) =>
            path === file ? { ...g, palette: next } : null,
          );
          return nextSrc === src ? current : { ...current, source: nextSrc };
        }
        // Referenced: the palette FILE is the source of truth. Refresh the
        // resolved copy on every geometry pointing at it so the 3D view
        // updates without a reload.
        const ref = normalizePath(geometry.paletteRef);
        const withColors = mapGeometryFiles(src, (g) =>
          sharesPalette(g, ref) ? { ...g, palette: next } : null,
        );
        return {
          ...current,
          source: writeFile(withColors, ref, paletteFileText(next)),
        };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // Delete an (unused) color: every higher index shifts down, so the voxels
  // of every file resolving against this palette are remapped in the SAME
  // edit — a shared palette means all its referrers, an inline one only its
  // own file. Refuses while any in-scope voxel still uses the color.
  const handleDeletePaletteColor = useCallback(
    (file: string, index: number) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const geometry = geometryAt(src, file);
        if (geometry === undefined) return current;
        const palette = geometry.palette;
        if (index < 0 || index >= palette.length) return current;
        const ref =
          geometry.paletteRef !== undefined
            ? normalizePath(geometry.paletteRef)
            : undefined;
        const inScope = (g: Geometry, path: string): boolean =>
          ref === undefined ? path === file : sharesPalette(g, ref);

        for (const [path, g] of src.geometries) {
          if (!inScope(g, path)) continue;
          for (const part of g.parts) {
            for (const layer of part.voxels) {
              for (const row of layer) {
                if (row.includes(index)) return current;
              }
            }
          }
        }

        const nextPalette = palette.filter((_, i) => i !== index);
        const nextSrc = mapGeometryFiles(src, (g, path) => {
          if (!inScope(g, path)) return null;
          const parts: Part[] = g.parts.map((part) => {
            let changed = false;
            const voxels = part.voxels.map((layer) =>
              layer.map((row) =>
                row.map((idx) => {
                  if (idx !== AIR && idx > index) {
                    changed = true;
                    return idx - 1;
                  }
                  return idx;
                }),
              ),
            );
            return changed ? { ...part, voxels } : part;
          });
          return { ...g, parts, palette: nextPalette };
        });
        if (ref === undefined) return { ...current, source: nextSrc };
        return {
          ...current,
          source: writeFile(nextSrc, ref, paletteFileText(nextPalette)),
        };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // Move ONE file's inline palette out to a palette file and point at it.
  // The colors are unchanged — only where they live. One undo.
  const handleExternalizePalette = useCallback(
    (file: string) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined || src.files === undefined) return current;
        const geometry = geometryAt(src, file);
        if (geometry === undefined) return current;
        if (geometry.paletteRef !== undefined) return current;
        if (geometry.palette.length === 0) return current;
        let path = 'palette.json';
        let n = 2;
        while (src.files.has(path)) path = `palette-${n++}.json`;
        const nextSrc = mapGeometryFiles(src, (g, at) =>
          at === file ? { ...g, paletteRef: path } : null,
        );
        const files = new Map(nextSrc.files);
        files.set(path, paletteFileText(geometry.palette));
        return { ...current, source: { ...nextSrc, files } };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // The reverse: keep the colors, drop the reference so they are written
  // into the geometry file itself. The palette file stays (it may be shared)
  // — delete it from the Files tree if it is truly orphaned.
  const handleInlinePalette = useCallback(
    (file: string) => {
      if (editsBlocked) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        if (geometryAt(src, file)?.paletteRef === undefined) return current;
        const nextSrc = mapGeometryFiles(src, (g, path) => {
          if (path !== file) return null;
          const { paletteRef: _drop, ...rest } = g;
          return rest;
        });
        return nextSrc === src ? current : { ...current, source: nextSrc };
      });
    },
    [dispatchEdit, editsBlocked],
  );

  // Package file create / rename / move / delete (lib/useFileOps).
  const {
    handleCreateFile,
    handleAddFileToModel,
    handleRenameFile,
    handleMoveFolder,
    handleRenameFolder,
    handleDeleteFile,
    handleDeleteFolder,
  } = useFileOps({ dispatchEdit, setFileParseErrors });


  const handleCreateManifest = useCallback(() => {
    if (editsBlocked) return;
    dispatchEdit(null, (current) => {
      if (current?.source === undefined) return current;
      const src = current.source;
      const manifest = synthesizeManifest(primaryGeometry(src), src.primaryPath);
      // A successful synthesis clears any stale load-time manifest error.
      const { manifestError: _dropped, ...rest } = src;
      const next = withManifest(
        {
          ...rest,
          // A lone-file load becomes a package here, taking its name from
          // the manifest just synthesized; a real folder keeps its own.
          folderName: src.folderName ?? manifest.name,
          synthetic: true,
        },
        manifest,
      );
      return { ...current, source: next };
    });
    // View switches live OUTSIDE the apply closure — reducer appliers must
    // stay pure (StrictMode double-invokes them). The button is only
    // reachable when a source is loaded, so switching unconditionally is
    // safe even if the edit no-opped.
    setViewMode('rig');
    setLayout((l) => openPanelById(l, 'preview'));
  }, [dispatchEdit, editsBlocked]);

  // Creating a clip moves the editor to the anim view. Layout state lives
  // here, so the hook calls back rather than reaching for it.
  const onClipCreated = useCallback(() => {
    setViewMode('anim');
    setLayout((l) => openPanelById(l, 'preview'));
  }, []);
  // Every keyframe-editor edit (lib/useAnimationEdits).
  const {
    handleSetAnimField,
    handleSetAnimEase,
    handleAddAnimKey,
    handleDeleteAnimKey,
    handlePasteAnimKeyframe,
    handleMoveAnimKey,
    handleTrimClip,
    handleSetClipDuration,
    handleSetClipLoop,
    handleCreateAnimationClip,
    handleRenameClip,
    handleDeleteClip,
    handleExternalizeClip,
    handleInlineClip,
    handleClearPartTrack,
  } = useAnimationEdits({ dispatchEdit, editsBlocked, onClipCreated });

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  // ─── Undo / Redo ─────────────────────────────────────────────────────

  // Re-derive the parse-error gates from a restored snapshot's text. A
  // restored state can be a mid-error typing burst's pre-state, so blindly
  // clearing the errors would re-enable structural edits that re-serialize
  // from a stale AST and clobber the text. A synchronous parse on a
  // user-initiated undo is cheap.
  const revalidateRestored = useCallback((restored: LoadResult | null) => {
    const src = restored?.source;
    setFileParseErrors(() => {
      const next = new Map<string, string>();
      if (src === undefined) return next;
      for (const [path, text] of src.files) {
        const { error } = applyFileEdit(src, path, text);
        if (error !== null) next.set(path, error);
      }
      return next;
    });
  }, []);

  // React flushes discrete events synchronously, so consecutive Ctrl+Z
  // presses each see fresh history state through this closure.
  const performUndo = useCallback(() => {
    if (history.past.length === 0) return;
    const target = history.past[history.past.length - 1]!;
    dispatch({ type: 'undo' });
    revalidateRestored(target);
  }, [
    history,
    revalidateRestored,
  ]);

  const performRedo = useCallback(() => {
    if (history.future.length === 0) return;
    const target = history.future[0]!;
    dispatch({ type: 'redo' });
    revalidateRestored(target);
  }, [
    history,
    revalidateRestored,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) return;
      // Mid-IME-composition keystrokes are the IME's business.
      if (e.isComposing || e.keyCode === 229) return;
      // Inside a text field, the browser's native undo applies (source
      // textareas, number inputs); only intercept document-level undo
      // elsewhere.
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest(
          'textarea, input, select, [contenteditable=""], [contenteditable="true"]',
        ) !== null
      ) {
        return;
      }
      e.preventDefault();
      if (isUndo) performUndo();
      else performRedo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [performUndo, performRedo]);

  const source = loaded?.source;
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

  // Preview toolbar availability (design §2.1/§2.2): a disabled tool
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

  // The animation-facing manifest: §6.3 string refs replaced by their
  // resolved external clips, so the session / viewport / timeline treat
  // every clip uniformly. Unresolved refs (load errors) stay strings and
  // are filtered out downstream as before.
  const animManifest = useMemo(() => {
    if (source?.manifest === undefined) {
      return undefined;
    }
    const m = source.manifest;
    if (m.animations === undefined || source.externalAnims === undefined) {
      return m;
    }
    let changed = false;
    const animations: NonNullable<Manifest['animations']> = {};
    for (const [name, anim] of Object.entries(m.animations)) {
      const ext =
        typeof anim === 'string' ? source.externalAnims.get(name) : undefined;
      if (ext !== undefined) {
        animations[name] = ext.anim;
        changed = true;
      } else {
        animations[name] = anim;
      }
    }
    return changed ? { ...m, animations } : m;
  }, [source]);
  // Clip name → external file path, for the timeline's storage label and
  // the Externalize / Inline toggle.
  const clipRefs = useMemo(() => {
    const m = new Map<string, string>();
    if (source?.manifest?.animations !== undefined) {
      for (const [name, anim] of Object.entries(source.manifest.animations)) {
        if (typeof anim === 'string') m.set(name, normalizePath(anim));
      }
    }
    return m;
  }, [source]);
  const modelGeometry = useMemo((): Geometry | undefined => {
    if (source === undefined || merged === undefined) return undefined;
    return { palette: primaryGeometry(source).palette, parts: merged.parts };
  }, [source, merged]);
  // Per-part render palettes (SPEC §7.4): every part resolves against its
  // own defining file's palette. Only needed for multi-file models — with
  // one file, modelGeometry's palette already covers everything. Files
  // sharing a palette file resolve to equal colors, so this is a no-op for
  // them in practice; it exists for files that keep their own.
  const partPalettes = useMemo(() => {
    if (source?.geometries === undefined || source.geometries.size <= 1) {
      return undefined;
    }
    const m = new Map<string, Palette>();
    for (const [path, g] of source.geometries) {
      const geometry = path === source.primaryPath ? primaryGeometry(source) : g;
      for (const part of geometry.parts) {
        if (!m.has(part.name)) m.set(part.name, geometry.palette);
      }
    }
    return m;
  }, [source]);
  // What the Palette panel edits (§7.4): the palette of the geometry file
  // that DEFINES the selected part — pick a part, edit its colors. With no
  // selection it falls back to the primary file. `ref` is set when those
  // colors live in a shared palette file, which is what the panel reports
  // and what Inline / Externalize toggle.
  const paletteTarget = useMemo((): PaletteTargetInfo | undefined => {
    if (source === undefined) return undefined;
    const file =
      (effectiveSelectedPart !== null
        ? partFiles?.get(effectiveSelectedPart)
        : undefined) ?? source.primaryPath;
    const geometry = geometryAt(source, file) ?? primaryGeometry(source);
    return {
      file,
      palette: geometry.palette,
      ...(geometry.paletteRef !== undefined && {
        ref: normalizePath(geometry.paletteRef),
      }),
    };
  }, [source, effectiveSelectedPart, partFiles]);

  // Dock layout tree (resizable, rearrangeable). In-memory only — layout is
  // session-scoped by design (no persistence); "Reset layout" restores it.
  // Null = every panel closed (empty dock); App renders an add-panel state.
  const [layout, setLayout] = useState<LayoutNode | null>(initialLayout);

  // Display title for any panel. Static for tool panels; the source files take
  // their actual file name so the dock tab reads "voxels.json" / "cuboidy.json"
  // (matching the file tree). Used for both tab labels and the + menu.
  const panelTitle = useCallback(
    (id: LeafId): string => {
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
  // Layout mutations no-op on a null (empty) dock — they only fire from a
  // rendered Dock, but the guard keeps the reducer total.
  const handleResize = useCallback((path: Side[], ratio: number) => {
    setLayout((current) => (current === null ? null : withRatioAt(current, path, ratio)));
  }, []);
  const handleActivatePanel = useCallback((path: Side[], id: LeafId) => {
    setLayout((current) => (current === null ? null : withActiveAt(current, path, id)));
  }, []);
  const handleClosePanel = useCallback((path: Side[], id: LeafId) => {
    setLayout((current) => (current === null ? null : closePanelAt(current, path, id)));
  }, []);
  const handleAddPanel = useCallback((path: Side[], id: LeafId) => {
    setLayout((current) => (current === null ? null : addPanelAt(current, path, id)));
  }, []);
  const handleSplitLeaf = useCallback(
    (toPath: Side[], edge: Edge, id: LeafId, fromPath: Side[]) => {
      setLayout((current) =>
        current === null ? null : splitLeafWith(current, toPath, edge, id, fromPath),
      );
    },
    [],
  );
  const handleReorderPanel = useCallback(
    (
      toPath: Side[],
      targetId: LeafId,
      before: boolean,
      id: LeafId,
      fromPath: Side[],
    ) => {
      setLayout((current) =>
        current === null
          ? null
          : placePanelBeside(current, toPath, targetId, before, id, fromPath),
      );
    },
    [],
  );
  const handleResetLayout = useCallback(() => setLayout(initialLayout), []);
  // Re-open a panel by id — brings it forward if placed, else re-adds it (and
  // seeds a fresh leaf from an empty dock). Drives both the tree-file clicks
  // and the empty-dock add buttons.
  const handleReopenPanel = useCallback((id: LeafId) => {
    setLayout((l) => openPanelById(l, id));
  }, []);
  // Click a file in the tree → bring its panel forward (re-opening it if
  // it was closed). The primary geometry maps to the classic geometry panel,
  // cuboidy.json to the manifest panel, anything else to a dynamic
  // per-file tab.
  const handleOpenPath = useCallback(
    (path: string) => {
      const src = loaded?.source;
      if (src === undefined) return;
      const id: LeafId =
        path === src.primaryPath
          ? 'geometry'
          : src.manifestPath === path
            ? 'manifest'
            : filePanel(path);
      setLayout((l) => openPanelById(l, id));
    },
    [loaded],
  );
  // The model's current problems, for the Console panel. Derived, never
  // stored. fileParseErrors already covers EVERY file including the primary
  // geometry and the manifest, so it is listed once — the panel used to
  // push those two separately as well, and reported each of them twice.
  const consoleEntries = useMemo((): ConsoleEntry[] => {
    const entries: ConsoleEntry[] = [];
    if (source === undefined) return entries;
    for (const [path, msg] of fileParseErrors) {
      entries.push({
        severity: 'error',
        source: path,
        message: (
          <>
            <strong>Error:</strong> {msg}
          </>
        ),
      });
    }
    // A load-time manifest error stands until the text is edited, at which
    // point fileParseErrors takes over reporting it.
    const manifestPath = source.manifestPath ?? 'cuboidy.json';
    if (
      source.manifestError !== undefined &&
      !fileParseErrors.has(manifestPath)
    ) {
      entries.push({
        severity: 'error',
        source: manifestPath,
        message: (
          <>
            <strong>Error:</strong> {source.manifestError}
          </>
        ),
      });
    }
    for (const pe of source.projectErrors ?? []) {
      entries.push({ severity: 'error', source: pe.file, message: pe.message });
    }
    return entries;
  }, [source, fileParseErrors]);

  // Error per file path (parse errors on live-edited files + load-time
  // project errors) — red names in the Files tree.
  const treeFileErrors = useMemo(() => {
    const m = new Map<string, string>();
    if (source === undefined) return m;
    for (const pe of source.projectErrors ?? []) m.set(pe.file, pe.message);
    for (const [p, msg] of fileParseErrors) m.set(p, msg);
    const mErr =
      manifestParseError ??
      source.manifestError;
    if (
      mErr !== undefined &&
      mErr !== null &&
      source.manifestPath !== undefined
    ) {
      m.set(source.manifestPath, mErr);
    }
    if (geometryParseError !== null) m.set(source.primaryPath, geometryParseError);
    return m;
  }, [source, fileParseErrors, geometryParseError, manifestParseError]);

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
    onAddAnimKey: handleAddAnimKey,
    onDeleteAnimKey: handleDeleteAnimKey,
    onMoveAnimKey: handleMoveAnimKey,
    onClearPartTrack: handleClearPartTrack,
    onPasteAnimKeyframe: handlePasteAnimKeyframe,
  });
  // Any panel not currently placed anywhere — offered by each leaf's + menu so
  // a closed panel can be reopened (and by the empty-dock state, where the set
  // is everything).
  const closedPanels = useMemo(() => {
    const placed = layout === null ? new Set<LeafId>() : placedPanels(layout);
    return ALL_PANELS.filter((id) => !placed.has(id)).map((id) => ({
      id,
      title: panelTitle(id),
    }));
  }, [layout, panelTitle]);

  // Per-panel content for the dock's tab rows. The leaf owns the tab header,
  // so each panel supplies just { title, fill?, body }. The source panels
  // (preview / geometry / manifest) were the in-center TabBar's tabs; they now
  // `fill` their leaf and manage their own scrolling (3D canvas, textareas).
  const getPanel = (id: LeafId): PanelContent | null => {
    if (source === undefined) return null;
    const manifest = source.manifest;
    const title = panelTitle(id);
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
      const err = fileParseErrors.get(fpath);
      return {
        title,
        fill: true,
        body: (
          <SourceEditor
            text={entry}
            {...(err !== undefined && { parseError: err })}
            onChange={(t) => handleEditFileText(fpath, t)}
          />
        ),
      };
    }
    switch (id) {
      case 'preview': {
        // The paint strip offers the SELECTED part's effective palette, so
        // a painted index means the right color in the right file (§7.4).
        const stripPalette =
          (effectiveSelectedPart !== null
            ? partPalettes?.get(effectiveSelectedPart)
            : undefined) ?? (modelGeometry ?? primaryGeometry(source)).palette;
        return {
          title,
          fill: true,
          body: (
            <PreviewPanel
              geometry={modelGeometry ?? primaryGeometry(source)}
              manifest={source.manifest}
              animManifest={animManifest}
              partPalettes={partPalettes}
              stripPalette={stripPalette}
              activeColorIndex={activeColorIndex}
              viewMode={effectiveViewMode}
              rigAvailable={rigAvailable}
              animAvailable={animAvailable}
              tool={effectivePreviewTool}
              toolDisabled={previewToolDisabled}
              gizmos={gizmoVis}
              hiddenParts={hiddenParts}
              selectedPart={effectiveSelectedPart}
              manifestEditsDisabled={manifestParseError !== null}
              session={animSession}
              framingKey={framingKey}
              onSetTool={setPreviewTool}
              onToggleGizmo={handleToggleGizmo}
              onChangeViewMode={handleViewModeChange}
              onSelectPart={setSelectedPartName}
              onPickColor={setActiveColorIndex}
              onCreateClip={handleCreateAnimationClip}
              onMovePart={handleGizmoMovePart}
              onRotatePart={handleGizmoRotatePart}
              onMovePivot={handleGizmoMovePivot}
              onRotatePivot={handleGizmoRotatePivot}
              onMoveSocket={handleGizmoMoveSocket}
              onRotateSocket={handleGizmoRotateSocket}
              onStrokeVoxels={handleStrokeVoxels}
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
              manifest={animManifest}
              hasManifest={manifest !== undefined}
              manifestEditsDisabled={manifestParseError !== null}
              clipRefs={clipRefs}
              onExternalizeClip={handleExternalizeClip}
              onInlineClip={handleInlineClip}
              onTrimClip={handleTrimClip}
              onSetClipDuration={handleSetClipDuration}
              onSetClipLoop={handleSetClipLoop}
              onCreateClip={handleCreateAnimationClip}
              onRenameClip={handleRenameClip}
              onDeleteClip={handleDeleteClip}
            />
          ),
        };
      case 'inspector':
        return {
          title,
          body: (
            <KeyInspectorPanel
              session={animSession}
              manifestEditsDisabled={manifestParseError !== null}
              onSetAnimField={handleSetAnimField}
              onSetAnimEase={handleSetAnimEase}
              onDeleteAnimKey={handleDeleteAnimKey}
            />
          ),
        };
      case 'geometry':
        return {
          title,
          fill: true,
          body: (
            <SourceEditor
              text={(fileText(source, source.primaryPath) ?? '')}
              {...(geometryParseError !== null && { parseError: geometryParseError })}
              onChange={(t) => handleEditFileText(source.primaryPath, t)}
            />
          ),
        };
      case 'manifest':
        return {
          title,
          fill: true,
          body:
            source.manifestPath !== undefined ? (
              <SourceEditor
                text={(manifestText(source) ?? '')}
                {...(manifestParseError !== null && {
                  parseError: manifestParseError,
                })}
                onChange={(t) => handleEditFileText(source.manifestPath!, t)}
              />
            ) : (
              <div className="panel-empty manifest-empty">
                <p>No manifest in this model yet.</p>
                <button
                  type="button"
                  className="btn btn-create btn-sm"
                  onClick={handleCreateManifest}
                >
                  <Plus size={13} />
                  Create manifest
                </button>
              </div>
            ),
        };
      case 'model':
        return {
          title,
          body: (
            <ModelProperties
              manifest={manifest}
              disabled={manifestParseError !== null}
              onChangeName={handleChangeModelName}
              onChangeVersion={handleChangeModelVersion}
              onCreateManifest={handleCreateManifest}
            />
          ),
        };
      case 'files':
        return {
          title,
          body: (
            <FileTree
              source={source}
              fileErrors={treeFileErrors}
              onOpenPath={handleOpenPath}
              onCreateManifest={handleCreateManifest}
              onCreateFile={handleCreateFile}
              onRenameFile={handleRenameFile}
              onMoveFolder={handleMoveFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFile={handleDeleteFile}
              onDeleteFolder={handleDeleteFolder}
              onAddFileToModel={handleAddFileToModel}
            />
          ),
        };
      case 'parts': {
        const multiFile = source.geometries.size > 1;
        return {
          title: 'Parts',
          fill: true,
          body: (
            <PartsPanel
              parts={merged?.parts ?? primaryGeometry(source).parts}
              partFiles={multiFile ? partFiles : undefined}
              geometryFiles={multiFile ? [...source.geometries.keys()] : undefined}
              manifest={manifest}
              hiddenParts={hiddenParts}
              selectedPart={effectiveSelectedPart}
              creating={creating}
              editsBlocked={editsBlocked}
              onStartCreate={handleStartCreatePart}
              onShowAll={handleShowAll}
              onHideAll={handleHideAll}
              onToggleVisibility={handleToggle}
              onSelectPart={setSelectedPartName}
              onChangeParent={handleChangePartParent}
              onConfirmCreate={(name, file) =>
                handleConfirmCreatePart(name, creating?.parent ?? null, file)
              }
              onCancelCreate={handleCancelCreatePart}
              onRenamePart={handleRenamePart}
            />
          ),
        };
      }
      case 'properties': {
        // Multi-geometry: the inspector shows a defining-file field whose
        // change moves the part. Same source as the parts panel picker.
        const movePaths =
          (source.geometries.size ?? 0) > 1
            ? [...(source.geometries.keys() ?? [])]
            : undefined;
        return {
          title: 'Properties',
          body:
            effectiveSelectedPart !== null ? (
              <PartProperties
                selectedPart={effectiveSelectedPart}
                geometry={modelGeometry ?? primaryGeometry(source)}
                manifest={manifest}
                manifestEditsDisabled={manifestParseError !== null}
                renameDisabled={
                  editsBlocked ||
                  (manifest !== undefined && manifestParseError !== null)
                }
                geometryFiles={movePaths}
                partFile={partFiles?.get(effectiveSelectedPart)}
                moveDisabled={
                  editsBlocked
                }
                geometryEditsDisabled={
                  editsBlocked
                }
                onChangeParent={handleChangePartParent}
                onChangePosition={handleChangePartPosition}
                onChangeRotation={handleChangePartRotation}
                onToggleRotation={handleTogglePartRotation}
                onRenamePart={handleRenamePart}
                onDeletePart={handleDeletePart}
                onCreateManifest={handleCreateManifest}
                onMovePart={handleMovePart}
                onEditPart={handleEditPart}
                onDuplicatePart={handleDuplicatePart}
                onMirrorPart={handleMirrorPart}
              />
            ) : (
              <p className="panel-empty">
                Select a part to edit its properties.
              </p>
            ),
        };
      }
      case 'palette': {
        const target: PaletteTargetInfo = paletteTarget ?? {
          file: source.primaryPath,
          palette: primaryGeometry(source).palette,
        };
        const shared = target.ref !== undefined;
        // A reference that didn't resolve (missing / invalid file) shows an
        // empty palette plus a reason, rather than silently pretending the
        // geometry file declares no colors.
        const unresolved = shared && target.palette?.length === 0;
        // Usage counts span every file resolving against this palette: a
        // shared one covers its referrers, an inline one just its own file.
        const scopeParts = shared
          ? (merged?.parts ?? primaryGeometry(source).parts).filter((p) => {
              const g = geometryAt(source, partFiles?.get(p.name) ?? '');
              return g !== undefined && sharesPalette(g, target.ref!);
            })
          : (geometryAt(source, target.file)?.parts ?? primaryGeometry(source).parts);
        return {
          title: 'Palette',
          body: (
            <PalettePanel
              palette={target.palette ?? []}
              parts={scopeParts}
              target={{
                file: target.file,
                ...(target.ref !== undefined && { ref: target.ref }),
              }}
              disabled={
                editsBlocked ||
                unresolved
              }
              disabledReason={
                unresolved
                  ? `The palette ${target.file} points at (${target.ref}) is missing or invalid — fix that file to edit these colors.`
                  : undefined
              }
              onChange={(next, tag) => handleEditPalette(target.file, next, tag)}
              onDeleteColor={(index) =>
                handleDeletePaletteColor(target.file, index)
              }
              onExternalize={
                !shared &&
                source.files !== undefined &&
                (target.palette?.length ?? 0) > 0
                  ? () => handleExternalizePalette(target.file)
                  : undefined
              }
              onInline={
                shared && !unresolved
                  ? () => handleInlinePalette(target.file)
                  : undefined
              }
            />
          ),
        };
      }
      case 'console':
        return { title, body: <ConsolePanel entries={consoleEntries} /> };
    }
    // Unreachable for static ids (the switch is exhaustive over them);
    // satisfies TS now that LeafId also includes dynamic file ids.
    return null;
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="brand">
            <Logo />
            <h1>Cuboidy</h1>
          </div>
          {/* ⚙ view/workspace settings (Reset layout) — a separate concern
              from the right-side document/session controls, so it lives by
              the brand, not next to Save/Export. A hairline sets it off from
              the wordmark. */}
          {source !== undefined && (
            <>
              <span className="header-divider" aria-hidden="true" />
              <SettingsMenu onResetLayout={handleResetLayout} />
            </>
          )}
        </div>
        <div className="header-right">
          {source !== undefined && (
            <>
              <div className="header-group">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={history.past.length === 0}
                  title="Undo (Ctrl+Z)"
                  aria-label="Undo"
                  onClick={performUndo}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={history.future.length === 0}
                  title="Redo (Ctrl+Shift+Z)"
                  aria-label="Redo"
                  onClick={performRedo}
                >
                  <Redo2 size={16} />
                </button>
              </div>
              <span className="header-divider" aria-hidden="true" />
              <div className="header-group">
                <SaveButton source={source} />
                <ExportMenu source={source} />
              </div>
              <span className="header-divider" aria-hidden="true" />
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
        </div>
      </header>
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
                  onClick={() => handleReopenPanel(p.id)}
                >
                  <Plus size={13} />
                  {p.title}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn"
              onClick={handleResetLayout}
            >
              Reset layout
            </button>
          </div>
        ) : (
          <Dock
            node={layout}
            getPanel={getPanel}
            closedPanels={closedPanels}
            onResize={handleResize}
            onActivate={handleActivatePanel}
            onClose={handleClosePanel}
            onAdd={handleAddPanel}
            onSplit={handleSplitLeaf}
            onReorder={handleReorderPanel}
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
