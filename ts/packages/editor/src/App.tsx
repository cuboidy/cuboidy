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
  InlineAnimationSchema,
  addAttrAtTime,
  composePartRotation,
  deleteAttrAtKey,
  duplicatePart,
  isIdentifier,
  manifestGeometry,
  mergeKeyframeAtTime,
  mirrorPart,
  moveAttrKey,
  parseGeometryText,
  parseManifest,
  parsePaletteFile,
  quatRotateVec3,
  serializeGeometry,
  setAttrAtKey,
  setEaseAtKey,
  trimTrackKeys,
  type AttrValue,
  type Axis,
  type Geometry,
  type EaseAttr,
  type EasingName,
  type InlineAnimation,
  type KeyAttr,
  type Keyframe,
  type Manifest,
  type ManifestPart,
  type Palette,
  type Part,
} from '@cuboidy/core';
import { AnimationViewport } from './components/AnimationViewport.js';
import { ConsolePanel, type ConsoleEntry } from './components/ConsolePanel.js';
import { Dock, type PanelContent } from './components/Dock.js';
import { ExportMenu } from './components/ExportMenu.js';
import { Logo } from './components/Logo.js';
import {
  Box,
  Crosshair,
  Eye,
  EyeOff,
  FolderOpen,
  Plug,
  Plus,
  Redo2,
  Undo2,
} from 'lucide-react';
import { FileDropZone } from './components/FileDropZone.js';
import { FileTree } from './components/FileTree.js';
import { ModelProperties } from './components/ModelProperties.js';
import { KeyInspectorPanel } from './components/KeyInspectorPanel.js';
import { PalettePanel } from './components/PalettePanel.js';
import { PaletteStrip } from './components/PaletteStrip.js';
import { PartProperties } from './components/PartProperties.js';
import { PartTree } from './components/PartTree.js';
import { PreviewToolbar } from './components/PreviewToolbar.js';
import { SaveButton } from './components/SaveButton.js';
import { SettingsMenu } from './components/SettingsMenu.js';
import { SourceEditor } from './components/SourceEditor.js';
import { TimelinePanel } from './components/TimelinePanel.js';
import { ViewModeToggle } from './components/ViewModeToggle.js';
import { VoxelScene } from './components/VoxelScene.js';
import { historyReducer, makeHistory } from './lib/history.js';
import {
  isGeometryPath,
  normalizePath,
  resolveProjectRefs,
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
  deleteFileInSource,
  geometryAt,
  fileText,
  geometryPaletteRefs,
  manifestText,
  mapGeometryFiles,
  mergeGeometries,
  moveFolderInSource,
  paletteFileText,
  pathBasename,
  primaryGeometry,
  remapPartPalette,
  renameFileInSource,
  rewriteExternalAnims,
  sharesPalette,
  uniquePartName,
  withManifest,
  withManifestText,
  writeFile,
} from './lib/source-ops.js';
import { synthesizeManifest } from './lib/synthesize-manifest.js';
import { useAnimationSession } from './lib/useAnimationSession.js';
import type {
  GizmoVisibility,
  LoadResult,
  LoadedSource,
  PreviewTool,
  ViewMode,
  VoxelEdit,
} from './lib/types.js';

// Debounce window for live re-parse of the geometry source view. Long
// enough that mid-keystroke typing doesn't constantly fire (and
// flicker palette/3D between transient invalid states); short enough
// that a deliberate pause feels live.
const REPARSE_DEBOUNCE_MS = 300;

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
  // Latest-value ref so the synchronous flush helpers (below) can read
  // the CURRENT text without re-binding every callback on each edit.
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const dispatchEdit = useCallback(
    (tag: string | null, apply: (c: LoadResult | null) => LoadResult | null) => {
      dispatch({ type: 'edit', tag, at: Date.now(), apply });
    },
    [],
  );
  const [hiddenParts, setHiddenParts] = useState<ReadonlySet<string>>(new Set());
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
  // Selected part for the right-panel inspector. Null = nothing
  // selected (right panel hides the properties section). Pruned at
  // render time if the name no longer exists in geometry.parts so stale
  // selections after source edits don't leak through.
  const [selectedPartName, setSelectedPartName] = useState<string | null>(null);
  // In-progress "new part" draft: non-null while the tree shows the inline
  // name field (VS Code-style). `parent` is the part it will be nested under
  // (null = root). Cleared on confirm / cancel / load.
  const [creating, setCreating] = useState<{ parent: string | null } | null>(null);
  // Live parse error on the geometry source text. Non-null only while the
  // user's currently-typed text doesn't parse. Palette panel disables
  // itself in this state so its re-serialize doesn't clobber the
  // in-progress text.
  const [geometryParseError, setGeometryParseError] = useState<string | null>(null);
  // Same role for the manifest source view. Independent timer and
  // error state, so a broken geometry doesn't block manifest editing
  // and vice versa.
  const [manifestParseError, setManifestParseError] = useState<string | null>(null);

  // Holds the timeout ID of the pending debounced reparse so we can
  // cancel it whenever new authoritative state arrives (further typing
  // resets the timer; structural edit pre-empts it entirely).
  const reparseGeometryTimer = useRef<number | null>(null);
  const reparseManifestTimer = useRef<number | null>(null);

  const cancelPendingGeometryReparse = useCallback(() => {
    if (reparseGeometryTimer.current !== null) {
      window.clearTimeout(reparseGeometryTimer.current);
      reparseGeometryTimer.current = null;
    }
  }, []);

  const cancelPendingManifestReparse = useCallback(() => {
    if (reparseManifestTimer.current !== null) {
      window.clearTimeout(reparseManifestTimer.current);
      reparseManifestTimer.current = null;
    }
  }, []);

  // Parse geometry text and land the outcome — error state plus (on success)
  // the AST amend. The single
  // implementation behind BOTH the debounced timer and the synchronous
  // flush below, so the two paths can't drift. Returns true when the
  // text parsed and the AST landed.
  const landGeometryReparse = useCallback((text: string): boolean => {
    const result = parseGeometryText(text);
    if (!result.ok) {
      setGeometryParseError(result.message);
      return false;
    }
    setGeometryParseError(null);
    dispatch({
      type: 'amend',
      apply: (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const geometries = new Map(src.geometries);
        geometries.set(src.primaryPath, result.value);
        return { ...current, source: { ...src, geometries } };
      },
    });
    return true;
  }, []);

  // Flush (not discard) a pending debounced geometry reparse: parse the
  // CURRENT text synchronously and land the amend / error now. Returns
  // false when the text doesn't parse — a structural edit must abort
  // rather than serialize from the stale AST, which would silently
  // overwrite what was just typed (audit A-6).
  const flushPendingGeometryReparse = useCallback((): boolean => {
    if (reparseGeometryTimer.current === null) return true;
    window.clearTimeout(reparseGeometryTimer.current);
    reparseGeometryTimer.current = null;
    const src = loadedRef.current?.source;
    if (src === undefined) return true;
    return landGeometryReparse((fileText(src, src.primaryPath) ?? ''));
  }, [landGeometryReparse]);

  // Manifest counterpart of landGeometryReparse: parse + amend with a full
  // reference re-resolve (geometry ASTs, bound palette, external
  // animations, project errors track the edited manifest).
  const landManifestReparse = useCallback((text: string): boolean => {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e) {
      setManifestParseError(`JSON parse: ${(e as Error).message}`);
      return false;
    }
    const result = parseManifest(json);
    if (!result.ok) {
      setManifestParseError(result.message);
      return false;
    }
    setManifestParseError(null);
    dispatch({
      type: 'amend',
      apply: (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        const refs = resolveProjectRefs(
          result.value,
          (p) => src.files.get(p),
          { path: src.primaryPath, geometry: primaryGeometry(src) },
        );
        // Destructure away the maybe-now-absent keys (a successful
        // reparse also clears any stale load-time manifest error).
        const {
          manifestError: _err,
          externalAnims: _anims,
          projectErrors: _proj,
          ...rest
        } = src;
        // A changed geometry list can pull a different primary AST in.
        return {
          ...current,
          source: {
            ...rest,
            manifest: result.value,
            geometries: refs.geometries,
            ...(refs.externalAnims !== undefined && {
              externalAnims: refs.externalAnims,
            }),
            ...(refs.projectErrors.length > 0 && {
              projectErrors: refs.projectErrors,
            }),
          },
        };
      },
    });
    return true;
  }, []);

  const flushPendingManifestReparse = useCallback((): boolean => {
    if (reparseManifestTimer.current === null) return true;
    window.clearTimeout(reparseManifestTimer.current);
    reparseManifestTimer.current = null;
    const src = loadedRef.current?.source;
    if (src === undefined) return true;
    const text = manifestText(src);
    if (text === undefined) return true;
    return landManifestReparse(text);
  }, [landManifestReparse]);

  const handleLoad = useCallback(
    (result: LoadResult) => {
      cancelPendingGeometryReparse();
      cancelPendingManifestReparse();
      // Per-file reparse timers / errors belong to the previous package.
      // (Ref + setter are stable — safe to use without listing as deps.)
      for (const t of fileReparseTimers.current.values()) {
        window.clearTimeout(t);
      }
      fileReparseTimers.current.clear();
      setFileParseErrors(new Map());
      dispatch({ type: 'replace', next: result });
      setHiddenParts(new Set());
      setSelectedPartName(null);
      setCreating(null);
      setGeometryParseError(null);
      setManifestParseError(null);
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
    [cancelPendingGeometryReparse, cancelPendingManifestReparse],
  );

  const handleReset = useCallback(() => {
    cancelPendingGeometryReparse();
    cancelPendingManifestReparse();
    for (const t of fileReparseTimers.current.values()) {
      window.clearTimeout(t);
    }
    fileReparseTimers.current.clear();
    setFileParseErrors(new Map());
    dispatch({ type: 'replace', next: null });
    setHiddenParts(new Set());
    setSelectedPartName(null);
    setCreating(null);
    setGeometryParseError(null);
    setManifestParseError(null);
    setViewMode('geometry');
  }, [cancelPendingGeometryReparse, cancelPendingManifestReparse]);

  const handleToggle = useCallback((name: string) => {
    setHiddenParts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleShowAll = useCallback(() => setHiddenParts(new Set()), []);

  const handleHideAll = useCallback(() => {
    if (loaded?.source !== undefined) {
      setHiddenParts(
        new Set(mergeGeometries(loaded.source).parts.map((p) => p.name)),
      );
    }
  }, [loaded]);

  // Geometry source-text edit (geometry tab textarea typing). Updates the text
  // immediately so every keystroke persists; schedules a debounced
  // reparse that updates the AST when it succeeds. The text remains
  // primary even while temporarily unparseable — Save / Export still
  // write what the user typed.
  const handleEditGeometryText = useCallback(
    (nextText: string) => {
      // Recorded with a per-file tag: a typing burst (keystrokes < 800ms
      // apart) is one undo entry whose pre-state is the text before the
      // burst started.
      dispatchEdit('text:geometry', (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        return { ...current, source: writeFile(src, src.primaryPath, nextText) };
      });
      cancelPendingGeometryReparse();
      reparseGeometryTimer.current = window.setTimeout(() => {
        reparseGeometryTimer.current = null;
        // The AST half of the already-recorded text edit — landGeometryReparse
        // amends, doesn't push (an entry whose undo changed only the
        // invisible AST would be a dead Ctrl+Z step).
        landGeometryReparse(nextText);
      }, REPARSE_DEBOUNCE_MS);
    },
    [dispatchEdit, cancelPendingGeometryReparse, landGeometryReparse],
  );

  // Per-file source editing for the dynamic file tabs (v0.7 packages).
  // Same shape as the geometry/manifest pipelines: record the text now
  // (per-file coalescing tag), debounce a reparse that amends derived
  // state (a geometry file's AST, the bound palette) on success.
  const [fileParseErrors, setFileParseErrors] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const fileReparseTimers = useRef<Map<string, number>>(new Map());
  const cancelAllFileReparse = useCallback(() => {
    for (const t of fileReparseTimers.current.values()) {
      window.clearTimeout(t);
    }
    fileReparseTimers.current.clear();
  }, []);
  const setFileParseError = useCallback((path: string, msg: string | null) => {
    setFileParseErrors((prev) => {
      if (msg === null && !prev.has(path)) return prev;
      const next = new Map(prev);
      if (msg === null) next.delete(path);
      else next.set(path, msg);
      return next;
    });
  }, []);

  // Parse one non-primary file's text and land the outcome (error state
  // + derived-state amend). Shared by the per-file debounce timer and
  // the synchronous flush. Returns true when the text is well-formed.
  const reparseFileNow = useCallback(
    (path: string, text: string): boolean => {
      // Which files are geometry is a manifest fact, not an extension one —
      // read it off the live source rather than the path suffix.
      const current = loadedRef.current?.source;
      const isGeometry =
        current !== undefined &&
        isGeometryPath(path, current.primaryPath, current.manifest);
      if (isGeometry) {
        const r = parseGeometryText(text);
        if (!r.ok) {
          setFileParseError(path, r.message);
          return false;
        }
        setFileParseError(path, null);
        dispatch({
          type: 'amend',
          apply: (current) => {
            const src = current?.source;
            if (
              src === undefined ||
              src.geometries.has(path) !== true
            ) {
              return current;
            }
            const geometries = new Map(src.geometries);
            geometries.set(path, r.value);
            return { ...current, source: { ...src, geometries } };
          },
        });
        return true;
      }
      if (path.endsWith('.json')) {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch (e) {
          setFileParseError(path, `JSON parse: ${(e as Error).message}`);
          return false;
        }
        setFileParseError(path, null);
        // If this file is the manifest-bound palette or an external
        // animation, re-derive that state. A schema-invalid edit
        // keeps the last good value (a reload surfaces it as a
        // project error).
        dispatch({
          type: 'amend',
          apply: (current) => {
            const src = current?.source;
            if (src === undefined) {
              return current;
            }
            let next = src;
            // Editing a palette FILE re-resolves it into every geometry
            // that points at it (§7.4), so the 3D view tracks the edit.
            if (geometryPaletteRefs(src).has(path)) {
              const pR = parsePaletteFile(json);
              if (pR.ok) {
                const colors = pR.value;
                next = mapGeometryFiles(next, (g) =>
                  sharesPalette(g, path) ? { ...g, palette: colors } : null,
                );
              }
            }
            if (src.externalAnims !== undefined) {
              let anims: Map<
                string,
                { path: string; anim: InlineAnimation }
              > | null = null;
              for (const [clip, rec] of src.externalAnims) {
                if (rec.path !== path) continue;
                const parsed = InlineAnimationSchema.safeParse(json);
                if (!parsed.success) break; // keep last good
                if (anims === null) anims = new Map(src.externalAnims);
                anims.set(clip, { path, anim: parsed.data });
              }
              if (anims !== null) next = { ...next, externalAnims: anims };
            }
            return next === src ? current : { ...current, source: next };
          },
        });
        return true;
      }
      setFileParseError(path, null);
      return true;
    },
    [setFileParseError],
  );

  const handleEditFileText = useCallback(
    (path: string, nextText: string) => {
      dispatchEdit(`text:${path}`, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined
        ) {
          return current;
        }
        if (!src.files.has(path)) return current;
        return { ...current, source: writeFile(src, path, nextText) };
      });
      const timers = fileReparseTimers.current;
      const existing = timers.get(path);
      if (existing !== undefined) window.clearTimeout(existing);
      timers.set(
        path,
        window.setTimeout(() => {
          timers.delete(path);
          reparseFileNow(path, nextText);
        }, REPARSE_DEBOUNCE_MS),
      );
    },
    [dispatchEdit, reparseFileNow],
  );

  // Flush every pending per-file reparse against the CURRENT file texts
  // (a debounce closure's text can be superseded by a structural edit —
  // the state text is authoritative). False when any flushed file is
  // currently unparseable.
  const flushPendingFileReparse = useCallback((): boolean => {
    const timers = fileReparseTimers.current;
    if (timers.size === 0) return true;
    const paths = [...timers.keys()];
    for (const t of timers.values()) window.clearTimeout(t);
    timers.clear();
    const src = loadedRef.current?.source;
    if (src === undefined) return true;
    let ok = true;
    for (const path of paths) {
      const text = src.files.get(path);
      if (text === undefined) continue;
      if (!reparseFileNow(path, text)) ok = false;
    }
    return ok;
  }, [reparseFileNow]);

  // Structural-edit gates (audit A-6). Every structural editor lands the
  // pending reparses it depends on BEFORE mutating, and aborts when the
  // corresponding text is mid-edit unparseable — serializing from the
  // last good AST would overwrite what the user just typed.
  const flushGeometryReparse = useCallback((): boolean => {
    const geometryOk = flushPendingGeometryReparse();
    const filesOk = flushPendingFileReparse();
    return geometryOk && filesOk;
  }, [flushPendingGeometryReparse, flushPendingFileReparse]);

  const flushAllReparse = useCallback((): boolean => {
    const geomOk = flushGeometryReparse();
    const manifestOk = flushPendingManifestReparse();
    return geomOk && manifestOk;
  }, [flushGeometryReparse, flushPendingManifestReparse]);

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
      if (!flushGeometryReparse()) return;
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
    [dispatchEdit, flushGeometryReparse],
  );

  // Delete an (unused) color: every higher index shifts down, so the voxels
  // of every file resolving against this palette are remapped in the SAME
  // edit — a shared palette means all its referrers, an inline one only its
  // own file. Refuses while any in-scope voxel still uses the color.
  const handleDeletePaletteColor = useCallback(
    (file: string, index: number) => {
      if (!flushGeometryReparse()) return;
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
    [dispatchEdit, flushGeometryReparse],
  );

  // Move ONE file's inline palette out to a palette file and point at it.
  // The colors are unchanged — only where they live. One undo.
  const handleExternalizePalette = useCallback(
    (file: string) => {
      if (!flushGeometryReparse()) return;
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
    [dispatchEdit, flushGeometryReparse],
  );

  // The reverse: keep the colors, drop the reference so they are written
  // into the geometry file itself. The palette file stays (it may be shared)
  // — delete it from the Files tree if it is truly orphaned.
  const handleInlinePalette = useCallback(
    (file: string) => {
      if (!flushGeometryReparse()) return;
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
    [dispatchEdit, flushGeometryReparse],
  );

  // ── File CRUD (Phase D). Folder sources with a files map only; each
  // operation is one dispatchEdit = one atomic undo step. The manifest
  // is the reference anchor, so structural file ops keep its geometry /
  // palette / animation refs in sync and re-serialize it. ──

  const handleCreateFile = useCallback(
    (path: string) => {
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined
        ) {
          return current;
        }
        const norm = normalizePath(path);
        if (norm === '' || norm.startsWith('../')) return current;
        if (
          src.files.has(norm) ||
          src.primaryPath === norm ||
          src.manifestPath === norm
        ) {
          return current;
        }
        // Creating a file used to state its role through the extension: a
        // `.cvox` name meant geometry, any other `.json` meant a palette or an
        // animation clip. With one extension for everything that signal is
        // gone, so fall back to the layout conventions of SPEC §3 — a clip
        // lives under `anims/`, the palette binding is conventionally
        // `palette.json` — and treat every other new `.json` as geometry,
        // which is the only thing this flow ever templated.
        // TODO: replace with an explicit type picker in the create UI.
        const lower = norm.toLowerCase();
        const isGeometry =
          lower.endsWith('.json') &&
          !lower.startsWith('anims/') &&
          !lower.endsWith('/palette.json') &&
          lower !== 'palette.json';
        let text: string;
        let parsed: Geometry | null = null;
        if (isGeometry) {
          // Template: one all-air part — valid with or without a palette
          // (§7.4). Part name unique model-wide (§5).
          const names = new Set(mergeGeometries(src).parts.map((p) => p.name));
          let n = 1;
          while (names.has(`part${n}`)) n += 1;
          const part: Part = {
            name: `part${n}`,
            size: { w: 1, h: 1, d: 1 },
            pivot: { pos: { x: 0.5, y: 0, z: 0.5 } },
            sockets: [],
            voxels: [[[AIR]]],
          };
          parsed = { palette: [], parts: [part] };
          text = serializeGeometry(parsed);
        } else {
          text = norm.toLowerCase().endsWith('.json') ? '{}\n' : '';
        }
        const files = new Map(src.files);
        files.set(norm, text);
        const removedFiles = new Set(src.removedFiles ?? []);
        removedFiles.delete(norm); // re-creating a removed path revives it
        let next: typeof src = { ...src, files, removedFiles };
        if (isGeometry && parsed !== null) {
          const geometries = new Map(
            src.geometries ?? [[src.primaryPath, primaryGeometry(src)]],
          );
          geometries.set(norm, parsed);
          next = { ...next, geometries };
          // Reference it from the manifest so it's part of the model
          // (unreferenced files are ignored + lint as W07).
          if (src.manifest !== undefined) {
            const geometry = manifestGeometry(src.manifest).map(normalizePath);
            if (!geometry.includes(norm)) geometry.push(norm);
            const nextManifest: Manifest = { ...src.manifest, geometry };
            next = withManifest(next, nextManifest);
          }
        }
        return { ...current, source: next };
      });
    },
    [dispatchEdit],
  );

  // Reference an existing-but-unreferenced geometry file from the manifest's
  // geometry list so its parts join the model (the fix-it for lint W07:
  // files outside the list are ignored). Re-resolves the derived maps in
  // the same edit, so one undo both drops the reference and unloads the
  // parts again.
  const handleAddFileToModel = useCallback(
    (path: string) => {
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined ||
          src.manifest === undefined
        ) {
          return current;
        }
        const norm = normalizePath(path);
        if (!src.files.has(norm)) return current;
        const geometry = manifestGeometry(src.manifest).map(normalizePath);
        if (geometry.includes(norm)) return current;
        geometry.push(norm);
        const nextManifest: Manifest = { ...src.manifest, geometry };
        const refs = resolveProjectRefs(
          nextManifest,
          (p) => src.files.get(p),
          { path: src.primaryPath, geometry: primaryGeometry(src) },
        );
        const {
          externalAnims: _anims,
          projectErrors: _proj,
          ...rest
        } = src;
        return {
          ...current,
          source: {
            ...withManifest(rest, nextManifest),
            geometries: refs.geometries,
            ...(refs.externalAnims !== undefined && {
              externalAnims: refs.externalAnims,
            }),
            ...(refs.projectErrors.length > 0 && {
              projectErrors: refs.projectErrors,
            }),
          },
        };
      });
    },
    [dispatchEdit],
  );

  const handleRenameFile = useCallback(
    (oldPath: string, newPath: string) => {
      const from = normalizePath(oldPath);
      const to = normalizePath(newPath);
      // Land any pending reparses first: the rename re-keys the file's
      // AST/geometry entry, and a timer firing later (keyed to the OLD
      // path) would no-op, leaving a stale AST under the new name.
      flushPendingFileReparse();
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined
        ) {
          return current;
        }
        const next = renameFileInSource(src, from, to);
        return next === null ? current : { ...current, source: next };
      });
      // Re-key any live parse error for the renamed file.
      setFileParseErrors((prev) => {
        if (!prev.has(from)) return prev;
        const next = new Map(prev);
        const msg = next.get(from)!;
        next.delete(from);
        next.set(to, msg);
        return next;
      });
    },
    [dispatchEdit, flushPendingFileReparse],
  );

  // Relocate a whole folder (and everything under it) so its new path is
  // `newDir`. One dispatchEdit = one undo step: moveFolderInSource folds
  // the per-file rename atomically — any single rejection (e.g. a
  // manifest-less geometry file) aborts the entire move, leaving the
  // source untouched. The Files tree gates the operation so a valid one
  // never half-applies. Shared by folder drag-move and folder rename.
  const relocateFolder = useCallback(
    (from: string, newDir: string) => {
      if (newDir === from) return;
      flushPendingFileReparse();
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined
        ) {
          return current;
        }
        const next = moveFolderInSource(src, from, newDir);
        return next === null ? current : { ...current, source: next };
      });
      // Re-key live parse errors under the folder by path prefix.
      setFileParseErrors((prev) => {
        const prefix = `${from}/`;
        let next: Map<string, string> | null = null;
        for (const [p, msg] of prev) {
          if (!p.startsWith(prefix)) continue;
          if (next === null) next = new Map(prev);
          next.delete(p);
          next.set(`${newDir}${p.slice(from.length)}`, msg);
        }
        return next ?? prev;
      });
    },
    [dispatchEdit, flushPendingFileReparse],
  );

  // Move a folder INTO destDir ('' = package root), keeping its name.
  const handleMoveFolder = useCallback(
    (srcDir: string, destDir: string) => {
      const from = normalizePath(srcDir);
      const dest = normalizePath(destDir);
      if (dest === from || dest.startsWith(`${from}/`)) return; // self/descendant
      const name = from.slice(from.lastIndexOf('/') + 1);
      relocateFolder(from, dest === '' ? name : `${dest}/${name}`);
    },
    [relocateFolder],
  );

  // Rename a folder in place (its last path segment), moving every file
  // under it to the new prefix.
  const handleRenameFolder = useCallback(
    (oldDir: string, newName: string) => {
      const from = normalizePath(oldDir);
      const i = from.lastIndexOf('/');
      const parent = i === -1 ? '' : from.slice(0, i);
      relocateFolder(
        from,
        normalizePath(parent === '' ? newName : `${parent}/${newName}`),
      );
    },
    [relocateFolder],
  );

  const handleDeleteFile = useCallback(
    (path: string) => {
      const p = normalizePath(path);
      // A pending reparse for the deleted path must not fire afterwards
      // (its error/amend would resurrect state for a gone file).
      const t = fileReparseTimers.current.get(p);
      if (t !== undefined) {
        window.clearTimeout(t);
        fileReparseTimers.current.delete(p);
      }
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined
        ) {
          return current;
        }
        const next = deleteFileInSource(src, p);
        return next === null ? current : { ...current, source: next };
      });
      setFileParseErrors((prev) => {
        if (!prev.has(p)) return prev;
        const next = new Map(prev);
        next.delete(p);
        return next;
      });
    },
    [dispatchEdit],
  );

  // Delete a whole folder — every file under it, atomically (one undo).
  // Aborts if the folder holds a pinned file (the primary geometry); the
  // Files tree only offers the affordance when it doesn't. Draft (empty)
  // folders have no files here and are pruned in the tree's UI state.
  const handleDeleteFolder = useCallback(
    (dir: string) => {
      const from = normalizePath(dir);
      const prefix = `${from}/`;
      // Cancel pending reparses for files about to vanish (a later timer
      // would resurrect state for a gone file).
      for (const key of [...fileReparseTimers.current.keys()]) {
        if (!key.startsWith(prefix)) continue;
        window.clearTimeout(fileReparseTimers.current.get(key)!);
        fileReparseTimers.current.delete(key);
      }
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.files === undefined
        ) {
          return current;
        }
        const targets = [...src.files.keys()]
          .filter((k) => k.startsWith(prefix))
          .sort();
        if (targets.length === 0) return current;
        let next: LoadedSource = src;
        for (const k of targets) {
          const stepped = deleteFileInSource(next, k);
          if (stepped === null) return current; // a pinned file aborts
          next = stepped;
        }
        return { ...current, source: next };
      });
      setFileParseErrors((prev) => {
        let next: Map<string, string> | null = null;
        for (const key of prev.keys()) {
          if (!key.startsWith(prefix)) continue;
          if (next === null) next = new Map(prev);
          next.delete(key);
        }
        return next ?? prev;
      });
    },
    [dispatchEdit],
  );

  // Rewrite ONE part's geometry (pivot / sockets), routed to whichever
  // geometry file defines it — part names are unique model-wide (§5), so the
  // build runs on exactly one file. `build` returning the same part is a
  // no-op (mapGeometryFiles then returns the source unchanged, and the
  // history reducer drops the entry). Backs PartProperties' Geometry section.
  const mutateGeometryPart = useCallback(
    (tag: string | null, partName: string, build: (part: Part) => Part) => {
      if (!flushGeometryReparse()) return;
      dispatchEdit(tag, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const nextSrc = mapGeometryFiles(src, (geometry) => {
          const i = geometry.parts.findIndex((p) => p.name === partName);
          if (i < 0) return null;
          const built = build(geometry.parts[i]!);
          if (built === geometry.parts[i]) return null;
          const parts = geometry.parts.slice();
          parts[i] = built;
          return { ...geometry, parts };
        });
        return nextSrc === src ? current : { ...current, source: nextSrc };
      });
    },
    [dispatchEdit, flushGeometryReparse],
  );

  // Adapter for PartProperties' Geometry section: (partName, build, tag?) —
  // the component supplies coalescing tags (e.g. a live pivot-axis drag) while
  // mutateGeometryPart takes the tag first.
  const handleEditPart = useCallback(
    (partName: string, build: (part: Part) => Part, tag?: string) => {
      mutateGeometryPart(tag ?? null, partName, build);
    },
    [mutateGeometryPart],
  );

  // Begin creating a part: open the inline draft row in the tree. The draft is
  // nested under the selected part when a manifest is loaded (so the new part
  // becomes its child); otherwise it goes to the root. Nothing is written until
  // the user confirms a name.
  const handleStartCreatePart = useCallback(() => {
    const src = loaded?.source;
    if (src === undefined) return;
    // Parenting writes the manifest, so it needs a clean manifest AST — with a
    // manifest syntax error, fall back to a root part (geometry only, no clobber).
    const canParent =
      src.manifest !== undefined &&
      manifestParseError === null;
    const parent =
      canParent &&
      selectedPartName !== null &&
      mergeGeometries(src).parts.some((p) => p.name === selectedPartName)
        ? selectedPartName
        : null;
    setCreating({ parent });
  }, [loaded, selectedPartName, manifestParseError]);

  const handleCancelCreatePart = useCallback(() => setCreating(null), []);

  // Append a new CONCRETE part derived from an existing one (duplicate /
  // mirror — the cuboidy-part CLI's editor twin). Geometry only, matching
  // the CLI: the new part lands in the SAME geometry file as its source and
  // gets no manifest rig entry (set parent/position afterward via the Rig
  // fields). `make` builds the part from the source + a model-wide-unique
  // name; that name is computed up front so the new part can be selected.
  const insertDerivedPart = useCallback(
    (
      sourceName: string,
      base: string,
      make: (source: Part, newName: string) => Part,
    ) => {
      if (!flushGeometryReparse()) return;
      const cur = loadedRef.current?.source;
      if (cur === undefined) return;
      const merged = mergeGeometries(cur);
      const existing = new Set(merged.parts.map((p) => p.name));
      if (!existing.has(sourceName)) return;
      const newName = uniquePartName(existing, base);
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const m = mergeGeometries(src);
        const source = m.parts.find((p) => p.name === sourceName);
        if (source === undefined || m.parts.some((p) => p.name === newName)) {
          return current;
        }
        const file = m.files.get(sourceName) ?? src.primaryPath;
        const newPart = make(source, newName);
        const nextSrc = mapGeometryFiles(src, (geometry, path) =>
          path === file ? { ...geometry, parts: [...geometry.parts, newPart] } : null,
        );
        return nextSrc === src ? current : { ...current, source: nextSrc };
      });
      setSelectedPartName(newName);
    },
    [dispatchEdit, flushGeometryReparse],
  );

  const handleDuplicatePart = useCallback(
    (name: string) => {
      insertDerivedPart(name, `${name}-copy`, (source, newName) =>
        duplicatePart(source, newName),
      );
    },
    [insertDerivedPart],
  );

  // Reflect the part IN PLACE (same name), a single geometry mutation — not
  // a new part. Matches `cuboidy-part mirror`.
  const handleMirrorPart = useCallback(
    (name: string, axis: Axis) => {
      mutateGeometryPart(null, name, (p) => mirrorPart(p, axis, p.name));
    },
    [mutateGeometryPart],
  );

  // Confirm the draft: append a 1×1×1 solid block (palette index 0, or AIR if
  // the palette is empty) named `name`, and — when a `parent` is given — add a
  // manifest entry parenting it there. Both files change in ONE dispatchEdit,
  // so it's a single atomic undo step. Re-guards uniqueness (the UI validates,
  // but a race could sneak a dup in). Then selects the new part.
  const handleConfirmCreatePart = useCallback(
    (name: string, parent: string | null, file?: string) => {
      if (!flushAllReparse()) return;
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        // Uniqueness is model-wide (§5): guard against a name defined in
        // ANY geometry file.
        if (mergeGeometries(src).parts.some((p) => p.name === name)) {
          return current;
        }
        // Target geometry file: the draft row's picker choice, as long
        // as it's still a loaded geometry file; else the primary.
        const target =
          file !== undefined &&
          src.geometries.has(file) === true
            ? file
            : src.primaryPath;
        const targetGeometry =
          target !== src.primaryPath
            ? (src.geometries.get(target) ?? primaryGeometry(src))
            : primaryGeometry(src);
        const seed = targetGeometry.palette.length > 0 ? 0 : AIR;
        const newPart: Part = {
          name,
          size: { w: 1, h: 1, d: 1 },
          pivot: { pos: { x: 0.5, y: 0, z: 0.5 } },
          sockets: [],
          voxels: [[[seed]]],
        };
        const nextSrc = mapGeometryFiles(src, (geometry, path) =>
          path === target
            ? { ...geometry, parts: [...geometry.parts, newPart] }
            : null,
        );
        if (parent !== null && src.manifest !== undefined) {
          const parts: ManifestPart[] = [...src.manifest.parts, { name, parent }];
          const nextManifest: Manifest = { ...src.manifest, parts };
          return { ...current, source: withManifest(nextSrc, nextManifest) };
        }
        return { ...current, source: nextSrc };
      });
      setManifestParseError(null);
      setSelectedPartName(name);
      setCreating(null);
    },
    [dispatchEdit, flushAllReparse],
  );

  // Move a part's declaration to another geometry file, atomically (one
  // dispatchEdit = one undo). The manifest is untouched — part names,
  // not paths, are the cross-file join key, so no references need fixing
  // up. Palette: with a manifest binding the shared palette makes indices
  // portable; WITHOUT one each file's inline palette gives them meaning,
  // so the moved voxels are remapped (missing colors appended to the
  // target palette).
  const handleMovePart = useCallback(
    (name: string, targetPath: string) => {
      if (!flushGeometryReparse()) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.geometries === undefined ||
          !src.geometries.has(targetPath)
        ) {
          return current;
        }
        const fromPath = mergeGeometries(src).files.get(name);
        if (fromPath === undefined || fromPath === targetPath) return current;
        const fromGeometry =
          fromPath === src.primaryPath
            ? primaryGeometry(src)
            : src.geometries.get(fromPath);
        const toGeometry =
          targetPath === src.primaryPath
            ? primaryGeometry(src)
            : src.geometries.get(targetPath);
        if (fromGeometry === undefined || toGeometry === undefined) return current;
        const part = fromGeometry.parts.find((p) => p.name === name);
        if (part === undefined) return current;
        let moved = part;
        let toPalette = toGeometry.palette;
        // Color indices are portable only when both files resolve against
        // the SAME palette; otherwise the moved voxels must be remapped.
        const samePalette =
          fromGeometry.paletteRef !== undefined &&
          toGeometry.paletteRef !== undefined &&
          normalizePath(fromGeometry.paletteRef) ===
            normalizePath(toGeometry.paletteRef);
        if (!samePalette) {
          const remapped = remapPartPalette(part, fromGeometry.palette, toPalette);
          moved = remapped.part;
          toPalette = remapped.palette;
        }
        const nextSrc = mapGeometryFiles(src, (geometry, path) => {
          if (path === fromPath) {
            return { ...geometry, parts: geometry.parts.filter((p) => p.name !== name) };
          }
          if (path === targetPath) {
            return { ...geometry, palette: toPalette, parts: [...geometry.parts, moved] };
          }
          return null;
        });
        return { ...current, source: nextSrc };
      });
    },
    [dispatchEdit, flushGeometryReparse],
  );

  // Rename a part everywhere it's referenced, atomically (one dispatchEdit =
  // one undo). The name is a cross-file join key, so a piecemeal rename would
  // leave dangling references. Rewrites:
  //   geometry     — the part's `name`
  //   manifest — the entry `name`, any `parent` pointing at it, and every inline
  //              animation track keyed by the old name (re-keyed, order kept)
  //   external — every resolved §6.3 animation file whose tracks key the old
  //              name (files map + externalAnims, same undo step)
  const handleRenamePart = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName || !isIdentifier(newName)) return;
      if (!flushAllReparse()) return;
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        // Existence / collision checks are model-wide (§5) — the part may
        // live in any geometry file.
        const allParts = mergeGeometries(src).parts;
        if (!allParts.some((p) => p.name === oldName)) return current;
        if (allParts.some((p) => p.name === newName)) return current;
        let nextSrc = mapGeometryFiles(src, (geometry) => {
          let changed = false;
          const parts: Part[] = geometry.parts.map((p) => {
            if (p.name !== oldName) return p;
            changed = true;
            return { ...p, name: newName };
          });
          return changed ? { ...geometry, parts } : null;
        });
        // §6.3 external animation files reference the part by name too.
        nextSrc = rewriteExternalAnims(nextSrc, (anim) => {
          if (!Object.hasOwn(anim.parts, oldName)) return null;
          const nextTracks: InlineAnimation['parts'] = {};
          for (const [pName, track] of Object.entries(anim.parts)) {
            nextTracks[pName === oldName ? newName : pName] = track;
          }
          return { ...anim, parts: nextTracks };
        });
        if (src.manifest !== undefined) {
          const m = src.manifest;
          const nextMParts: ManifestPart[] = m.parts.map((mp) => {
            let nmp: ManifestPart = mp;
            if (nmp.name === oldName) nmp = { ...nmp, name: newName };
            if (nmp.parent === oldName) nmp = { ...nmp, parent: newName };
            return nmp;
          });
          let nextManifest: Manifest = { ...m, parts: nextMParts };
          if (m.animations !== undefined) {
            const rebuilt: NonNullable<Manifest['animations']> = {};
            let changed = false;
            for (const [aName, anim] of Object.entries(m.animations)) {
              if (typeof anim === 'string' || !Object.hasOwn(anim.parts, oldName)) {
                rebuilt[aName] = anim;
                continue;
              }
              const nextTracks: InlineAnimation['parts'] = {};
              for (const [pName, track] of Object.entries(anim.parts)) {
                nextTracks[pName === oldName ? newName : pName] = track;
              }
              rebuilt[aName] = { ...anim, parts: nextTracks };
              changed = true;
            }
            if (changed) nextManifest = { ...nextManifest, animations: rebuilt };
          }
          return { ...current, source: withManifest(nextSrc, nextManifest) };
        }
        return { ...current, source: nextSrc };
      });
      setManifestParseError(null);
      setSelectedPartName(newName);
      // Carry a hidden part's visibility over to the new name.
      setHiddenParts((prev) => {
        if (!prev.has(oldName)) return prev;
        const next = new Set(prev);
        next.delete(oldName);
        next.add(newName);
        return next;
      });
    },
    [dispatchEdit, flushAllReparse],
  );

  // Delete a part, cleaning up its references atomically (one undo). Removes
  // the geometry part; in the manifest drops its entry, re-parents its children to
  // its own parent (grandparent, or root if none), and drops its animation
  // tracks (inline AND resolved external files). No confirmation: undo is the
  // safety net (same as clip delete).
  const handleDeletePart = useCallback(
    (name: string) => {
      if (!flushAllReparse()) return;
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        // Model-wide check (§5): the part may live in any geometry file.
        const allParts = mergeGeometries(src).parts;
        if (!allParts.some((p) => p.name === name)) return current;
        let nextSrc = mapGeometryFiles(src, (geometry) =>
          geometry.parts.some((p) => p.name === name)
            ? { ...geometry, parts: geometry.parts.filter((p) => p.name !== name) }
            : null,
        );
        nextSrc = rewriteExternalAnims(nextSrc, (anim) => {
          if (!Object.hasOwn(anim.parts, name)) return null;
          const { [name]: _dropped, ...restTracks } = anim.parts;
          return { ...anim, parts: restTracks };
        });
        if (src.manifest !== undefined) {
          const m = src.manifest;
          const grandparent = m.parts.find((mp) => mp.name === name)?.parent;
          const nextMParts: ManifestPart[] = [];
          for (const mp of m.parts) {
            if (mp.name === name) continue; // drop the deleted part's entry
            if (mp.parent === name) {
              if (grandparent !== undefined) {
                nextMParts.push({ ...mp, parent: grandparent });
              } else {
                const { parent: _drop, ...rest } = mp; // re-root
                nextMParts.push(rest);
              }
            } else {
              nextMParts.push(mp);
            }
          }
          let nextManifest: Manifest = { ...m, parts: nextMParts };
          if (m.animations !== undefined) {
            const rebuilt: NonNullable<Manifest['animations']> = {};
            let changed = false;
            for (const [aName, anim] of Object.entries(m.animations)) {
              if (typeof anim === 'string' || !Object.hasOwn(anim.parts, name)) {
                rebuilt[aName] = anim;
                continue;
              }
              const { [name]: _dropped, ...restTracks } = anim.parts;
              rebuilt[aName] = { ...anim, parts: restTracks };
              changed = true;
            }
            if (changed) nextManifest = { ...nextManifest, animations: rebuilt };
          }
          return { ...current, source: withManifest(nextSrc, nextManifest) };
        }
        return { ...current, source: nextSrc };
      });
      setManifestParseError(null);
      setSelectedPartName((prev) => (prev === name ? null : prev));
      setHiddenParts((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    },
    [dispatchEdit, flushAllReparse],
  );

  // Manifest source-text edit (manifest tab textarea typing). Same
  // shape as the geometry counterpart but uses JSON.parse + parseManifest.
  // No-ops on a source with no manifest file to edit.
  const handleEditManifestText = useCallback(
    (nextText: string) => {
      dispatchEdit('text:manifest', (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        return { ...current, source: withManifestText(src, nextText) };
      });
      cancelPendingManifestReparse();
      reparseManifestTimer.current = window.setTimeout(() => {
        reparseManifestTimer.current = null;
        // Re-runs reference resolution on success so the derived maps
        // (geometry ASTs, bound palette, external animations, project
        // errors) track the edited manifest.
        landManifestReparse(nextText);
      }, REPARSE_DEBOUNCE_MS);
    },
    [dispatchEdit, cancelPendingManifestReparse, landManifestReparse],
  );

  // Single-part edits coming from PartTree (D&D parent change) and
  // PartProperties (parent dropdown, position inputs). Both funnel
  // into a small manifest mutation that ensures an entry exists for
  // the affected part, re-serializes the manifest text, and clears
  // any stale parse-error state.
  //
  // No-ops when no manifest is loaded — the UI disables both entry
  // points in that case, but the defensive guard keeps a runtime
  // error from racing source-tab edits that drop the manifest.
  const mutateManifestPart = useCallback(
    (
      tag: string | null,
      partName: string,
      build: (entry: ManifestPart) => ManifestPart,
    ) => {
      if (!flushPendingManifestReparse()) return;
      dispatchEdit(tag, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        if (src.manifest === undefined) return current;
        const parts = src.manifest.parts.slice();
        const i = parts.findIndex((p) => p.name === partName);
        const base: ManifestPart = i >= 0 ? parts[i]! : { name: partName };
        const next = build(base);
        if (i >= 0) parts[i] = next;
        else parts.push(next);
        const nextManifest: Manifest = { ...src.manifest, parts };
        return { ...current, source: withManifest(src, nextManifest) };
      });
      setManifestParseError(null);
    },
    [dispatchEdit, flushPendingManifestReparse],
  );

  // Model-level manifest fields (name / version) — the cuboidy.json data that
  // isn't per-part. Same re-serialize + clear-error shape as mutateManifestPart
  // but rewrites the top-level object. Backs the Model panel.
  const mutateManifest = useCallback(
    (tag: string | null, build: (m: Manifest) => Manifest) => {
      if (!flushPendingManifestReparse()) return;
      dispatchEdit(tag, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        if (src.manifest === undefined) return current;
        const nextManifest = build(src.manifest);
        if (nextManifest === src.manifest) return current;
        return { ...current, source: withManifest(src, nextManifest) };
      });
      setManifestParseError(null);
    },
    [dispatchEdit, flushPendingManifestReparse],
  );

  const handleChangeModelName = useCallback(
    (name: string) => {
      mutateManifest(null, (m) => (m.name === name ? m : { ...m, name }));
    },
    [mutateManifest],
  );

  const handleChangeModelVersion = useCallback(
    (version: string) => {
      mutateManifest(null, (m) => {
        const v = version.trim();
        if (v === '') {
          if (m.version === undefined) return m;
          const { version: _drop, ...rest } = m;
          return rest;
        }
        if (m.version === v) return m;
        // Keep version right after name for a tidy diff even when it was
        // absent before (a bare `{ ...m, version }` would append it last).
        const { name, version: _old, ...rest } = m;
        return { name, version: v, ...rest };
      });
    },
    [mutateManifest],
  );

  const handleChangePartParent = useCallback(
    (partName: string, parent: string | null) => {
      // Discrete select — always its own undo entry.
      mutateManifestPart(null, partName, (entry) => {
        if (parent === null) {
          const { parent: _drop, ...rest } = entry;
          return rest;
        }
        return { ...entry, parent };
      });
    },
    [mutateManifestPart],
  );

  const handleChangePartPosition = useCallback(
    (partName: string, axis: 0 | 1 | 2, value: number) => {
      // Live number input commits per keystroke — coalesce a burst on one
      // axis into one entry.
      mutateManifestPart(`part:pos:${partName}:${axis}`, partName, (entry) => {
        const cur = entry.position ?? [0, 0, 0];
        const next: [number, number, number] = [cur[0], cur[1], cur[2]];
        next[axis] = value;
        return { ...entry, position: next };
      });
    },
    [mutateManifestPart],
  );

  // Move-gizmo drag commit (design §3): the whole drag lands as ONE
  // whole-position write = one undo entry (vs the per-axis coalescing
  // tags of the inspector's number inputs). mutateManifestPart creates
  // the manifest entry if the part didn't have one — dragging an
  // unplaced part places it.
  const handleGizmoMovePart = useCallback(
    (partName: string, position: [number, number, number]) => {
      mutateManifestPart(null, partName, (entry) => ({ ...entry, position }));
    },
    [mutateManifestPart],
  );

  // Rotate-gizmo drag commit: same one-undo shape. All-zero = identity
  // drops the field, matching the inspector's checkbox convention
  // (absent `rotation` is the SPEC default).
  const handleGizmoRotatePart = useCallback(
    (partName: string, rotation: [number, number, number]) => {
      mutateManifestPart(null, partName, (entry) => {
        if (rotation.every((v) => v === 0)) {
          const { rotation: _drop, ...rest } = entry;
          return rest;
        }
        return { ...entry, rotation };
      });
    },
    [mutateManifestPart],
  );

  // Pivot drag commit — ALWAYS compensated (design §2.3): ONE
  // dispatchEdit rewrites the geometry pivot AND the manifest so the
  // rendered model doesn't move, only the marker does. The part's own
  // position gains q_local·Δ (q_local = q_rotation ⊗ q_pivot — its
  // voxels are drawn at −pivot inside the rotated frame); each DIRECT
  // child loses Δ (children live inside that same rotated frame, so
  // the parent's compensation would carry them by exactly +Δ there).
  // Compensation values are derived math, rounded to 0.001 — tight
  // enough to keep the invariant, sane enough for the file.
  const handleGizmoMovePivot = useCallback(
    (partName: string, pos: [number, number, number]) => {
      if (!flushAllReparse()) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const part = mergeGeometries(src).parts.find(
          (p) => p.name === partName,
        );
        if (part === undefined) return current;
        const op = part.pivot.pos;
        if (op.x === pos[0] && op.y === pos[1] && op.z === pos[2]) {
          return current;
        }
        const delta: [number, number, number] = [
          pos[0] - op.x,
          pos[1] - op.y,
          pos[2] - op.z,
        ];
        const nextSrc = mapGeometryFiles(src, (geometry) => {
          const i = geometry.parts.findIndex((p) => p.name === partName);
          if (i < 0) return null;
          const parts = geometry.parts.slice();
          parts[i] = {
            ...parts[i]!,
            pivot: {
              ...parts[i]!.pivot,
              pos: { x: pos[0], y: pos[1], z: pos[2] },
            },
          };
          return { ...geometry, parts };
        });
        if (nextSrc === src) return current;
        if (nextSrc.manifest === undefined) {
          // No rig to keep in place — a plain geometry edit.
          return { ...current, source: nextSrc };
        }
        const round3 = (v: number) => Math.round(v * 1000) / 1000;
        const m = nextSrc.manifest;
        const parts = m.parts.slice();
        const idx = parts.findIndex((p) => p.name === partName);
        const base: ManifestPart = idx >= 0 ? parts[idx]! : { name: partName };
        const pivotRot = part.pivot.rot;
        const qLocal = composePartRotation(
          base.rotation,
          pivotRot === undefined
            ? undefined
            : [pivotRot.x, pivotRot.y, pivotRot.z],
        );
        const off = quatRotateVec3(qLocal, delta);
        const bp = base.position ?? [0, 0, 0];
        const moved: ManifestPart = {
          ...base,
          position: [
            round3(bp[0] + off[0]),
            round3(bp[1] + off[1]),
            round3(bp[2] + off[2]),
          ],
        };
        if (idx >= 0) parts[idx] = moved;
        else parts.push(moved);
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i]!;
          if (p.parent !== partName || p.name === partName) continue;
          const cp = p.position ?? [0, 0, 0];
          parts[i] = {
            ...p,
            position: [
              round3(cp[0] - delta[0]),
              round3(cp[1] - delta[1]),
              round3(cp[2] - delta[2]),
            ],
          };
        }
        const nextManifest: Manifest = { ...m, parts };
        return { ...current, source: withManifest(nextSrc, nextManifest) };
      });
      setManifestParseError(null);
    },
    [dispatchEdit, flushAllReparse],
  );

  // Pivot rotate commit — writes the geometry-side pivot.rot (§7.7
  // q_pivot; the gizmo factored the manifest rotation out upstream).
  // All-zero drops the optional rot.
  const handleGizmoRotatePivot = useCallback(
    (partName: string, rot: [number, number, number]) => {
      mutateGeometryPart(null, partName, (p) => {
        if (rot.every((v) => v === 0)) {
          const { rot: _drop, ...pivRest } = p.pivot;
          return { ...p, pivot: pivRest };
        }
        return {
          ...p,
          pivot: { ...p.pivot, rot: { x: rot[0], y: rot[1], z: rot[2] } },
        };
      });
    },
    [mutateGeometryPart],
  );

  // One completed voxel-tool stroke (design §2.6) — every painted /
  // erased / attached cell of the drag lands as ONE geometry edit =
  // one undo. The grid is then FITTED to the result's solid cells
  // (§2.7): attach grows it, erase shrinks it, and pre-existing empty
  // margins (lint W04) heal along the way. Either direction shifts
  // voxels, pivot.pos and every socket.pos together — the render is
  // unchanged because the −pivot draw offset cancels the shift exactly
  // (no manifest compensation needed). The geometry view, which draws raw
  // coordinates, re-origins once at commit.
  const handleStrokeVoxels = useCallback(
    (partName: string, edits: readonly VoxelEdit[]) => {
      if (edits.length === 0) return;
      const byKey = new Map(
        edits.map((e) => [`${e.x},${e.y},${e.z}`, e.value]),
      );
      mutateGeometryPart(null, partName, (p) => {
        const { w, h, d } = p.size;
        // Tight bounds of the result's solid cells, and whether any
        // cell actually changes.
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        let changed = false;
        const consider = (x: number, y: number, z: number) => {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        };
        for (let y = 0; y < h; y++) {
          for (let z = 0; z < d; z++) {
            for (let x = 0; x < w; x++) {
              const base = p.voxels[y]![z]![x]!;
              const nv = byKey.get(`${x},${y},${z}`);
              if (nv !== undefined && nv !== base) changed = true;
              if ((nv ?? base) !== AIR) consider(x, y, z);
            }
          }
        }
        for (const e of edits) {
          const inB =
            e.x >= 0 && e.x < w && e.y >= 0 && e.y < h && e.z >= 0 && e.z < d;
          if (inB || e.value === AIR) continue;
          changed = true;
          consider(e.x, e.y, e.z);
        }
        if (!changed) return p;
        if (minX === Infinity) {
          // Every solid cell erased — keep a 1³ empty part (W05 flags
          // it; deleting the part stays an explicit tree operation).
          // Origin unchanged, so pivot/sockets stay put.
          return { ...p, size: { w: 1, h: 1, d: 1 }, voxels: [[[AIR]]] };
        }
        const sx = -minX;
        const sy = -minY;
        const sz = -minZ;
        const nw = maxX - minX + 1;
        const nh = maxY - minY + 1;
        const nd = maxZ - minZ + 1;
        if (sx === 0 && sy === 0 && sz === 0 && nw === w && nh === h && nd === d) {
          // Bounds already tight — in-place cell edits only.
          const voxels = p.voxels.map((layer, y) =>
            layer.map((row, z) =>
              row.map((v, x) => byKey.get(`${x},${y},${z}`) ?? v),
            ),
          );
          return { ...p, voxels };
        }
        const voxels: number[][][] = [];
        for (let y = 0; y < nh; y++) {
          const layer: number[][] = [];
          for (let z = 0; z < nd; z++) {
            const row: number[] = [];
            for (let x = 0; x < nw; x++) {
              const bx = x - sx;
              const by = y - sy;
              const bz = z - sz;
              const base =
                bx >= 0 && bx < w && by >= 0 && by < h && bz >= 0 && bz < d
                  ? p.voxels[by]![bz]![bx]!
                  : AIR;
              row.push(byKey.get(`${bx},${by},${bz}`) ?? base);
            }
            layer.push(row);
          }
          voxels.push(layer);
        }
        return {
          ...p,
          size: { w: nw, h: nh, d: nd },
          voxels,
          pivot: {
            ...p.pivot,
            pos: {
              x: p.pivot.pos.x + sx,
              y: p.pivot.pos.y + sy,
              z: p.pivot.pos.z + sz,
            },
          },
          sockets: p.sockets.map((s) => ({
            ...s,
            pos: { x: s.pos.x + sx, y: s.pos.y + sy, z: s.pos.z + sz },
          })),
        };
      });
    },
    [mutateGeometryPart],
  );

  // Socket drag commits — part-local geometry edits through the shared
  // geometry mutation (one undo each).
  const handleGizmoMoveSocket = useCallback(
    (partName: string, socketName: string, pos: [number, number, number]) => {
      mutateGeometryPart(null, partName, (p) => ({
        ...p,
        sockets: p.sockets.map((s) =>
          s.name === socketName
            ? { ...s, pos: { x: pos[0], y: pos[1], z: pos[2] } }
            : s,
        ),
      }));
    },
    [mutateGeometryPart],
  );

  const handleGizmoRotateSocket = useCallback(
    (partName: string, socketName: string, rot: [number, number, number]) => {
      mutateGeometryPart(null, partName, (p) => ({
        ...p,
        sockets: p.sockets.map((s) => {
          if (s.name !== socketName) return s;
          // All-zero = identity — drop the optional rot entirely.
          if (rot.every((v) => v === 0)) {
            const { rot: _drop, ...rest } = s;
            return rest;
          }
          return { ...s, rot: { x: rot[0], y: rot[1], z: rot[2] } };
        }),
      }));
    },
    [mutateGeometryPart],
  );

  const handleChangePartRotation = useCallback(
    (partName: string, axis: 0 | 1 | 2, value: number) => {
      mutateManifestPart(`part:rot:${partName}:${axis}`, partName, (entry) => {
        const cur = entry.rotation ?? [0, 0, 0];
        const next: [number, number, number] = [cur[0], cur[1], cur[2]];
        next[axis] = value;
        return { ...entry, rotation: next };
      });
    },
    [mutateManifestPart],
  );

  // Checkbox on/off: absent `rotation` is the SPEC default (identity), so
  // unchecking drops the field from the JSON instead of writing [0,0,0].
  const handleTogglePartRotation = useCallback(
    (partName: string, on: boolean) => {
      mutateManifestPart(null, partName, (entry) => {
        if (on) return { ...entry, rotation: entry.rotation ?? [0, 0, 0] };
        const { rotation: _drop, ...rest } = entry;
        return rest;
      });
    },
    [mutateManifestPart],
  );

  const handleCreateManifest = useCallback(() => {
    if (!flushAllReparse()) return;
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
  }, [dispatchEdit, flushAllReparse]);

  // ─── Animation (keyframe editor) edits ──────────────────────────────
  //
  // The `animations` analog of mutateManifestPart: immutably updates one
  // clip and routes the write to where the clip LIVES — an inline object
  // goes back into the manifest (text kept in sync); a §6.3 string ref
  // goes into the referenced external file (files map + externalAnims),
  // leaving the manifest untouched. No-ops on an unresolved ref (load
  // error) or when no manifest is loaded.
  const mutateManifestAnimation = useCallback(
    (
      tag: string | null,
      animName: string,
      build: (anim: InlineAnimation) => InlineAnimation,
    ) => {
      if (!flushPendingManifestReparse()) return;
      dispatchEdit(tag, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        if (src.manifest === undefined) return current;
        const prev = src.manifest.animations?.[animName];
        if (prev === undefined) return current;
        if (typeof prev === 'string') {
          const rec = src.externalAnims?.get(animName);
          if (rec === undefined) return current; // unresolved ref
          const built = build(rec.anim);
          if (built === rec.anim) return current;
          const externalAnims = new Map(src.externalAnims);
          externalAnims.set(animName, { path: rec.path, anim: built });
          return {
            ...current,
            source: {
              ...writeFile(src, rec.path, JSON.stringify(built, null, 2) + '\n'),
              externalAnims,
            },
          };
        }
        const built = build(prev);
        // A no-op build must return `current` itself, or the fresh wrapper
        // objects below would defeat the history reducer's `next === present`
        // no-op detection and record a junk undo entry.
        if (built === prev) return current;
        const animations = { ...src.manifest.animations, [animName]: built };
        const nextManifest: Manifest = { ...src.manifest, animations };
        return { ...current, source: withManifest(src, nextManifest) };
      });
      setManifestParseError(null);
    },
    [dispatchEdit, flushPendingManifestReparse],
  );

  // Overwrite an existing key's attribute value. Vec3 fields commit per
  // keystroke (live NumberInput) — coalesce per key+attr; the visible
  // checkbox is discrete and always pushes.
  const handleSetAnimField = useCallback(
    (
      animName: string,
      part: string,
      timeKey: string,
      attr: KeyAttr,
      value: AttrValue,
    ) => {
      const tag =
        attr === 'visible'
          ? null
          : `anim:set:${animName}:${part}:${timeKey}:${attr}`;
      mutateManifestAnimation(tag, animName, (anim) => {
        const track = anim.parts[part];
        if (track === undefined || track[timeKey] === undefined) return anim;
        return {
          ...anim,
          parts: { ...anim.parts, [part]: setAttrAtKey(track, timeKey, attr, value) },
        };
      });
    },
    [mutateManifestAnimation],
  );

  // Set or clear (undefined) one attribute's ease at an existing key.
  // Discrete dropdown change — always its own undo entry (tag null).
  const handleSetAnimEase = useCallback(
    (
      animName: string,
      part: string,
      timeKey: string,
      attr: EaseAttr,
      ease: EasingName | undefined,
    ) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const track = anim.parts[part];
        if (track === undefined) return anim;
        const nextTrack = setEaseAtKey(track, timeKey, attr, ease);
        if (nextTrack === track) return anim;
        return { ...anim, parts: { ...anim.parts, [part]: nextTrack } };
      });
    },
    [mutateManifestAnimation],
  );

  // Add (or merge) a key for `attr` at `time`; the helper seeds the §6.6 0.0
  // key and creates the part's track if absent.
  const handleAddAnimKey = useCallback(
    (animName: string, part: string, time: number, attr: KeyAttr, value: AttrValue) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const track = anim.parts[part] ?? {};
        const { track: nextTrack } = addAttrAtTime(track, time, attr, value);
        return { ...anim, parts: { ...anim.parts, [part]: nextTrack } };
      });
    },
    [mutateManifestAnimation],
  );

  // Remove one attribute key; prune the part's track if it becomes empty.
  const handleDeleteAnimKey = useCallback(
    (animName: string, part: string, timeKey: string, attr: KeyAttr) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const track = anim.parts[part];
        if (track === undefined) return anim;
        const nextTrack = deleteAttrAtKey(track, timeKey, attr);
        const parts = { ...anim.parts };
        if (Object.keys(nextTrack).length === 0) delete parts[part];
        else parts[part] = nextTrack;
        return { ...anim, parts };
      });
    },
    [mutateManifestAnimation],
  );

  // Paste a copied keyframe: field-wise merge at `time` on `part`. One
  // discrete undo entry per paste (tag null).
  const handlePasteAnimKeyframe = useCallback(
    (animName: string, part: string, time: number, kf: Keyframe) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const track = anim.parts[part] ?? {};
        const { track: nextTrack } = mergeKeyframeAtTime(track, time, kf);
        if (nextTrack === track) return anim;
        return { ...anim, parts: { ...anim.parts, [part]: nextTrack } };
      });
    },
    [mutateManifestAnimation],
  );

  // Retime one attribute key (timeline marker drag). The helper is a pure
  // rename; same-attr collisions are blocked by the drag clamp in the UI.
  const handleMoveAnimKey = useCallback(
    (
      animName: string,
      part: string,
      fromTimeKey: string,
      toTime: number,
      attr: KeyAttr,
    ) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const track = anim.parts[part];
        if (track === undefined) return anim;
        const { track: nextTrack } = moveAttrKey(track, fromTimeKey, toTime, attr);
        if (nextTrack === track) return anim;
        return { ...anim, parts: { ...anim.parts, [part]: nextTrack } };
      });
    },
    [mutateManifestAnimation],
  );

  // Drop every key beyond the clip's duration (the lint badge's Trim action).
  // Parts whose track empties out are removed entirely.
  const handleTrimClip = useCallback(
    (animName: string) => {
      mutateManifestAnimation(null, animName, (anim) => {
        const parts: InlineAnimation['parts'] = {};
        for (const [name, track] of Object.entries(anim.parts)) {
          const trimmed = trimTrackKeys(track, anim.duration);
          if (Object.keys(trimmed).length > 0) parts[name] = trimmed;
        }
        return { ...anim, parts };
      });
    },
    [mutateManifestAnimation],
  );

  const handleSetClipDuration = useCallback(
    (animName: string, duration: number) => {
      // Live number input — coalesce a typing burst into one entry.
      mutateManifestAnimation(`anim:duration:${animName}`, animName, (anim) => ({
        ...anim,
        duration,
      }));
    },
    [mutateManifestAnimation],
  );

  const handleSetClipLoop = useCallback(
    (animName: string, loop: boolean) => {
      mutateManifestAnimation(null, animName, (anim) => ({ ...anim, loop }));
    },
    [mutateManifestAnimation],
  );

  // Seed a new empty inline clip (unique identifier-safe name) and switch to
  // the anim view. Can't go through mutateManifestAnimation since the entry
  // doesn't exist yet.
  const handleCreateAnimationClip = useCallback(() => {
    if (!flushPendingManifestReparse()) return;
    dispatchEdit(null, (current) => {
      if (current?.source === undefined) return current;
      const src = current.source;
      if (src.manifest === undefined) return current;
      const existing = src.manifest.animations ?? {};
      let n = 1;
      let name = `clip${n}`;
      while (existing[name] !== undefined) {
        n += 1;
        name = `clip${n}`;
      }
      const newClip: InlineAnimation = { duration: 1, loop: true, parts: {} };
      const animations = { ...existing, [name]: newClip };
      const nextManifest: Manifest = { ...src.manifest, animations };
      return { ...current, source: withManifest(src, nextManifest) };
    });
    // Outside the apply closure for reducer purity (see handleCreateManifest).
    setViewMode('anim');
    setLayout((l) => openPanelById(l, 'preview'));
  }, [dispatchEdit, flushPendingManifestReparse]);

  // Rename a clip, preserving its position in the animations map (rebuild
  // entries in insertion order, swapping the key) so the JSON diff is one
  // line. Collision checks use Object.hasOwn — `animations['constructor']`
  // would be truthy via the prototype chain — and run against ALL keys
  // (string-ref animations included).
  const handleRenameClip = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName || !isIdentifier(newName)) return;
      if (!flushPendingManifestReparse()) return;
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        if (src.manifest === undefined) return current;
        const animations = src.manifest.animations;
        if (animations === undefined || !Object.hasOwn(animations, oldName)) {
          return current;
        }
        if (Object.hasOwn(animations, newName)) return current;
        const next: NonNullable<Manifest['animations']> = {};
        for (const [k, v] of Object.entries(animations)) {
          next[k === oldName ? newName : k] = v;
        }
        const nextManifest: Manifest = { ...src.manifest, animations: next };
        // An external clip's resolution is keyed by clip name — re-key it
        // (the referenced file itself is untouched by a clip rename).
        let externalAnims = src.externalAnims;
        const ext = externalAnims?.get(oldName);
        if (externalAnims !== undefined && ext !== undefined) {
          const rebuilt = new Map(externalAnims);
          rebuilt.delete(oldName);
          rebuilt.set(newName, ext);
          externalAnims = rebuilt;
        }
            return {
              ...current,
              source: { ...withManifest(src, nextManifest), ...(externalAnims !== undefined && { externalAnims }), },
            };
      });
      setManifestParseError(null);
    },
    [dispatchEdit, flushPendingManifestReparse],
  );

  // Delete a clip. No confirmation — undo is the safety net. Deleting the
  // last clip drops the `animations` property entirely (SPEC: absent → no
  // animations; cleaner authored JSON).
  const handleDeleteClip = useCallback(
    (name: string) => {
      if (!flushPendingManifestReparse()) return;
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        if (src.manifest === undefined) return current;
        const animations = src.manifest.animations;
        if (animations === undefined || !Object.hasOwn(animations, name)) {
          return current;
        }
        const { [name]: _dropped, ...rest } = animations;
        let nextManifest: Manifest;
        if (Object.keys(rest).length === 0) {
          const { animations: _all, ...m } = src.manifest;
          nextManifest = m;
        } else {
          nextManifest = { ...src.manifest, animations: rest };
        }
              // Deleting an external clip removes the manifest entry only; the
        // referenced file stays (it may be shared — delete it from the
        // Files tree if it's truly orphaned).
        let externalAnims = src.externalAnims;
        if (externalAnims?.has(name) === true) {
          const rebuilt = new Map(externalAnims);
          rebuilt.delete(name);
          externalAnims = rebuilt;
        }
        return {
          ...current,
          source: { ...withManifest(src, nextManifest), ...(externalAnims !== undefined && { externalAnims }), },
        };
      });
      setManifestParseError(null);
    },
    [dispatchEdit, flushPendingManifestReparse],
  );

  // Move an inline clip out to its own file (§6.3): write
  // `anims/<name>.json` (unique-suffixed if taken) and swap the manifest
  // value to the reference path. One dispatchEdit = one undo.
  const handleExternalizeClip = useCallback(
    (name: string) => {
      if (!flushPendingManifestReparse()) return;
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        if (src.manifest === undefined || src.files === undefined) {
          return current;
        }
        const anim = src.manifest.animations?.[name];
        if (anim === undefined || typeof anim === 'string') return current;
        let path = `anims/${name}.json`;
        let n = 2;
        while (src.files.has(path)) path = `anims/${name}-${n++}.json`;
        const files = new Map(src.files);
        files.set(path, JSON.stringify(anim, null, 2) + '\n');
        const externalAnims = new Map(src.externalAnims ?? []);
        externalAnims.set(name, { path, anim });
        const animations = { ...src.manifest.animations, [name]: path };
        const nextManifest: Manifest = { ...src.manifest, animations };
        return {
          ...current,
          source: { ...withManifest(src, nextManifest), files, externalAnims },
        };
      });
      setManifestParseError(null);
    },
    [dispatchEdit, flushPendingManifestReparse],
  );

  // The reverse: copy an external clip's object back into the manifest.
  // The referenced file is kept (it may be shared) — it just becomes
  // unreferenced; delete it from the Files tree if it's orphaned.
  const handleInlineClip = useCallback(
    (name: string) => {
      if (!flushPendingManifestReparse()) return;
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        if (src.manifest === undefined) return current;
        const ref = src.manifest.animations?.[name];
        if (typeof ref !== 'string') return current;
        const rec = src.externalAnims?.get(name);
        if (rec === undefined) return current; // unresolved ref
        const externalAnims = new Map(src.externalAnims);
        externalAnims.delete(name);
        const animations = { ...src.manifest.animations, [name]: rec.anim };
        const nextManifest: Manifest = { ...src.manifest, animations };
        return {
          ...current,
          source: { ...withManifest(src, nextManifest), externalAnims },
        };
      });
      setManifestParseError(null);
    },
    [dispatchEdit, flushPendingManifestReparse],
  );

  // Remove a part's whole track from a clip (the timeline's per-part ×).
  const handleClearPartTrack = useCallback(
    (animName: string, part: string) => {
      mutateManifestAnimation(null, animName, (anim) => {
        if (anim.parts[part] === undefined) return anim;
        const { [part]: _dropped, ...parts } = anim.parts;
        return { ...anim, parts };
      });
    },
    [mutateManifestAnimation],
  );

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
    if (src === undefined) {
      setGeometryParseError(null);
      setManifestParseError(null);
      return;
    }
    const geometryR = parseGeometryText((fileText(src, src.primaryPath) ?? ''));
    setGeometryParseError(geometryR.ok ? null : geometryR.message);
    if (src.manifestPath !== undefined) {
      let err: string | null = null;
      try {
        const r = parseManifest(JSON.parse((manifestText(src) ?? '')));
        if (!r.ok) err = r.message;
      } catch (e) {
        err = `JSON parse: ${(e as Error).message}`;
      }
      setManifestParseError(err);
    } else {
      setManifestParseError(null);
    }
    // Per-file (non-primary) parse errors need the same re-derivation:
    // the restored snapshot can predate or postdate the text a live
    // error was computed from. Mirrors the per-file typing pipeline —
    // geometry files parse as geometry, other .json only for
    // well-formedness.
    setFileParseErrors(() => {
      const next = new Map<string, string>();
      if (src.files === undefined) return next;
      for (const [path, text] of src.files) {
        if (path === src.primaryPath) continue; // covered by geometryParseError
        if (path === src.manifestPath) continue;
        if (isGeometryPath(path, src.primaryPath, src.manifest)) {
          const r = parseGeometryText(text);
          if (!r.ok) next.set(path, r.message);
        } else if (path.endsWith('.json')) {
          try {
            JSON.parse(text);
          } catch (e) {
            next.set(path, `JSON parse: ${(e as Error).message}`);
          }
        }
      }
      return next;
    });
  }, []);

  // React flushes discrete events synchronously, so consecutive Ctrl+Z
  // presses each see fresh history state through this closure.
  const performUndo = useCallback(() => {
    if (history.past.length === 0) return;
    const target = history.past[history.past.length - 1]!;
    // Discard (don't flush) every pending reparse — their closures hold
    // pre-undo text; firing after the restore would graft a post-edit
    // AST onto the restored text (audit A-6). revalidateRestored
    // re-derives the error gates from the restored text synchronously.
    cancelPendingGeometryReparse();
    cancelPendingManifestReparse();
    cancelAllFileReparse();
    dispatch({ type: 'undo' });
    revalidateRestored(target);
  }, [
    history,
    cancelPendingGeometryReparse,
    cancelPendingManifestReparse,
    cancelAllFileReparse,
    revalidateRestored,
  ]);

  const performRedo = useCallback(() => {
    if (history.future.length === 0) return;
    const target = history.future[0]!;
    cancelPendingGeometryReparse();
    cancelPendingManifestReparse();
    cancelAllFileReparse();
    dispatch({ type: 'redo' });
    revalidateRestored(target);
  }, [
    history,
    cancelPendingGeometryReparse,
    cancelPendingManifestReparse,
    cancelAllFileReparse,
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
    // Every editing tool writes geometry files (and move/rotate the
    // manifest too) — any of them mid-edit unparseable disables the
    // tools, matching the inspector.
    const parseBroken =
      manifestParseError !== null ||
      geometryParseError !== null ||
      fileParseErrors.size > 0;
    if (effectiveViewMode === 'anim') {
      d.move = 'Rest editing lives in the Rig and Geometry views';
      d.rotate = 'Rest editing lives in the Rig and Geometry views';
      d.attach = 'Voxel editing lives in the Rig and Geometry views for now';
      d.erase = 'Voxel editing lives in the Rig and Geometry views for now';
      d.paint = 'Voxel editing lives in the Rig and Geometry views for now';
    } else if (parseBroken) {
      const msg = 'Fix the syntax errors first';
      d.move = msg;
      d.rotate = msg;
      d.attach = msg;
      d.erase = msg;
      d.paint = msg;
    }
    return d;
  }, [
    effectiveViewMode,
    manifestParseError,
    geometryParseError,
    fileParseErrors,
  ]);
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
        // The paint tool's color choices come from the SELECTED part's
        // effective palette (§6.10 — unbound multi-file models resolve
        // per defining file), so the painted index means the right
        // color in the right file.
        const stripPalette =
          (effectiveSelectedPart !== null
            ? partPalettes?.get(effectiveSelectedPart)
            : undefined) ?? (modelGeometry ?? primaryGeometry(source)).palette;
        const clampedColor =
          stripPalette.length === 0
            ? -1
            : Math.min(activeColorIndex, stripPalette.length - 1);
        return {
          title,
          fill: true,
          body: (
            <>
              {/* Panel-local toolbar: the view-mode switch belongs to the
                  Preview panel, so it floats over the 3D's top-right rather
                  than the global header (panel-system design A2). The gizmo
                  toggles sit beside it — they only affect this panel too.
                  The tool switch (preview-editing design §2.1) floats over
                  the top-left. */}
              <div className="preview-toolbar-overlay">
                <PreviewToolbar
                  tool={effectivePreviewTool}
                  disabled={previewToolDisabled}
                  onSetTool={setPreviewTool}
                />
              </div>
              <div className="view-mode-overlay">
                <div
                  className="gizmo-toggles"
                  role="group"
                  aria-label="Selected-part gizmos"
                >
                  <button
                    type="button"
                    className={gizmoVis.pivot ? 'active' : ''}
                    aria-pressed={gizmoVis.pivot}
                    title="Show the selected part's pivot"
                    onClick={() => handleToggleGizmo('pivot')}
                  >
                    <Crosshair size={14} />
                  </button>
                  <button
                    type="button"
                    className={gizmoVis.sockets ? 'active' : ''}
                    aria-pressed={gizmoVis.sockets}
                    title="Show the selected part's sockets"
                    onClick={() => handleToggleGizmo('sockets')}
                  >
                    <Plug size={14} />
                  </button>
                  <button
                    type="button"
                    className={gizmoVis.frame ? 'active' : ''}
                    aria-pressed={gizmoVis.frame}
                    title="Show the selected part's bounding frame"
                    onClick={() => handleToggleGizmo('frame')}
                  >
                    <Box size={14} />
                  </button>
                </div>
                <ViewModeToggle
                  mode={effectiveViewMode}
                  rigAvailable={rigAvailable}
                  animAvailable={animAvailable}
                  onChange={handleViewModeChange}
                />
              </div>
              {effectiveViewMode === 'anim' &&
              animManifest !== undefined ? (
                <AnimationViewport
                  geometry={modelGeometry ?? primaryGeometry(source)}
                  manifest={animManifest}
                  hiddenParts={hiddenParts}
                  session={animSession}
                  manifestEditsDisabled={manifestParseError !== null}
                  partPalettes={partPalettes}
                  selectedPart={effectiveSelectedPart}
                  gizmos={gizmoVis}
                  onSelectPart={setSelectedPartName}
                  framingKey={framingKey}
                  onCreateClip={handleCreateAnimationClip}
                />
              ) : (
                <VoxelScene
                  geometry={modelGeometry ?? primaryGeometry(source)}
                  manifest={source.manifest}
                  viewMode={effectiveViewMode}
                  hiddenParts={hiddenParts}
                  partPalettes={partPalettes}
                  selectedPart={effectiveSelectedPart}
                  gizmos={gizmoVis}
                  onSelectPart={setSelectedPartName}
                  tool={effectivePreviewTool}
                  onMovePart={handleGizmoMovePart}
                  onRotatePart={handleGizmoRotatePart}
                  onMovePivot={handleGizmoMovePivot}
                  onRotatePivot={handleGizmoRotatePivot}
                  onMoveSocket={handleGizmoMoveSocket}
                  onRotateSocket={handleGizmoRotateSocket}
                  activeColorIndex={clampedColor}
                  onStrokeVoxels={handleStrokeVoxels}
                  framingKey={framingKey}
                />
              )}
              {(effectivePreviewTool === 'paint' ||
                effectivePreviewTool === 'attach') && (
                <div className="palette-strip-overlay">
                  <PaletteStrip
                    palette={stripPalette}
                    active={clampedColor}
                    onPick={setActiveColorIndex}
                  />
                </div>
              )}
            </>
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
              onChange={handleEditGeometryText}
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
                onChange={handleEditManifestText}
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
        const modelParts = merged?.parts ?? primaryGeometry(source).parts;
        const visibleCount = modelParts.length - hiddenParts.size;
        const existingNames = new Set(modelParts.map((p) => p.name));
        let n = 1;
        while (existingNames.has(`part${n}`)) n += 1;
        const createSuggested = `part${n}`;
        // Multi-geometry: the create draft offers a target-file picker.
        // Insertion order of `geometries` is geometry-list order, so the
        // first entry is the primary (the single-file default).
        const geometryPaths =
          (source.geometries.size ?? 0) > 1
            ? [...(source.geometries.keys() ?? [])]
            : undefined;
        return {
          title: 'Parts',
          // Fill panel: the toolbar sits OUTSIDE the scroller (only the
          // tree scrolls). Inside it, the drag auto-scroll zone at the
          // scroller's top edge hid behind the sticky toolbar — an
          // upward drag only scrolled once the pointer cleared it.
          fill: true,
          body: (
            <>
              <div className="parts-toolbar">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={
                    geometryParseError !== null || fileParseErrors.size > 0
                  }
                  title={
                    geometryParseError !== null || fileParseErrors.size > 0
                      ? 'Fix the geometry file errors to add parts'
                      : 'New part (child of the selected part)'
                  }
                  onClick={handleStartCreatePart}
                >
                  <Plus size={13} />
                  New part
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleShowAll}
                  disabled={hiddenParts.size === 0}
                >
                  <Eye size={13} />
                  Show all
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleHideAll}
                  disabled={visibleCount === 0}
                >
                  <EyeOff size={13} />
                  Hide all
                </button>
              </div>
              <div className="parts-scroll">
                <PartTree
                  parts={modelParts}
                  partFiles={
                    (source.geometries.size ?? 0) > 1
                      ? partFiles
                      : undefined
                  }
                  manifest={manifest}
                  hiddenParts={hiddenParts}
                  selectedPart={effectiveSelectedPart}
                  dndEnabled={manifest !== undefined}
                  creating={creating}
                  createSuggested={createSuggested}
                  geometryFiles={geometryPaths}
                  validateNewName={(name) =>
                    isIdentifier(name) && !existingNames.has(name)
                  }
                  renameEnabled={
                    geometryParseError === null &&
                    fileParseErrors.size === 0 &&
                    !(manifest !== undefined && manifestParseError !== null)
                  }
                  onToggleVisibility={handleToggle}
                  onSelectPart={setSelectedPartName}
                  onChangeParent={handleChangePartParent}
                  onConfirmCreate={(name, file) =>
                    handleConfirmCreatePart(name, creating?.parent ?? null, file)
                  }
                  onCancelCreate={handleCancelCreatePart}
                  onRenamePart={handleRenamePart}
                />
              </div>
            </>
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
                  geometryParseError !== null ||
                  fileParseErrors.size > 0 ||
                  (manifest !== undefined && manifestParseError !== null)
                }
                geometryFiles={movePaths}
                partFile={partFiles?.get(effectiveSelectedPart)}
                moveDisabled={
                  geometryParseError !== null || fileParseErrors.size > 0
                }
                geometryEditsDisabled={
                  geometryParseError !== null || fileParseErrors.size > 0
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
                geometryParseError !== null ||
                fileParseErrors.size > 0 ||
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
      case 'console': {
        // Derived, not stored: the model's current problems. Live parse
        // errors mirror the in-editor banners; the dropped-comments notice
        // is load-time only (it can't change until the next load).
        const entries: ConsoleEntry[] = [];
        if (geometryParseError !== null) {
          entries.push({
            severity: 'error',
            source: source.primaryPath,
            message: (
              <>
                <strong>Error:</strong> {geometryParseError}
              </>
            ),
          });
        }
        const manifestErr =
          manifestParseError ??
          source.manifestError ??
          null;
        if (manifestErr !== null) {
          entries.push({
            severity: 'error',
            source:
              source.manifestPath ??
              'cuboidy.json',
            message: (
              <>
                <strong>Error:</strong> {manifestErr}
              </>
            ),
          });
        }
        if (source.projectErrors !== undefined) {
          for (const pe of source.projectErrors) {
            entries.push({
              severity: 'error',
              source: pe.file,
              message: pe.message,
            });
          }
        }
        for (const [p, msg] of fileParseErrors) {
          entries.push({
            severity: 'error',
            source: p,
            message: (
              <>
                <strong>Error:</strong> {msg}
              </>
            ),
          });
        }
        return { title, body: <ConsolePanel entries={entries} /> };
      }
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
