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
  parseCvox,
  parseManifest,
  parsePaletteFile,
  quatRotateVec3,
  serializeColor,
  serializeCvox,
  setAttrAtKey,
  setEaseAtKey,
  trimTrackKeys,
  type AttrValue,
  type Axis,
  type Cvox,
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
import { synthesizeManifest } from './lib/synthesize-manifest.js';
import { useAnimationSession } from './lib/useAnimationSession.js';
import type {
  FileEntry,
  GizmoVisibility,
  LoadResult,
  LoadedSource,
  PreviewTool,
  ViewMode,
  VoxelEdit,
} from './lib/types.js';

// Debounce window for live re-parse of the cvox source view. Long
// enough that mid-keystroke typing doesn't constantly fire (and
// flicker palette/3D between transient invalid states); short enough
// that a deliberate pause feels live.
const REPARSE_DEBOUNCE_MS = 300;

// v0.7 multi-cvox (Phase C): the DISPLAY model is the union of every
// geometry file's parts, in geometry-list order. The primary file's
// live AST (source.cvox) overrides its load-time snapshot in
// source.geometries so mid-edit state stays current. A cross-file
// duplicate name keeps the first definition (validateProject flags the
// error). `files` records each part's defining file — edit routing and
// the part tree's file badges.
function mergeGeometries(src: LoadedSource): {
  parts: Part[];
  files: ReadonlyMap<string, string>;
} {
  const files = new Map<string, string>();
  if (src.kind !== 'folder' || src.geometries === undefined) {
    return { parts: src.cvox.parts, files };
  }
  const parts: Part[] = [];
  for (const [path, g] of src.geometries) {
    const cvox = path === src.cvoxFile.name ? src.cvox : g;
    for (const part of cvox.parts) {
      if (files.has(part.name)) continue;
      files.set(part.name, path);
      parts.push(part);
    }
  }
  return { parts, files };
}

// Rewrite a part's voxel indices from one inline palette to another,
// appending colors the target palette lacks (exact rgba match). AIR and
// out-of-range indices pass through unchanged (the latter are lint
// errors either way). Used when moving a part between UNBOUND files,
// where each file's inline palette gives indices their meaning (§6.10)
// — without the remap the moved part would silently change color.
function remapPartPalette(
  part: Part,
  from: Palette,
  to: Palette,
): { part: Part; palette: Palette } {
  const palette = [...to];
  const map = new Map<number, number>();
  for (const layer of part.voxels) {
    for (const row of layer) {
      for (const v of row) {
        if (v < 0 || v >= from.length || map.has(v)) continue;
        const c = from[v]!;
        let j = palette.findIndex(
          (t) => t.r === c.r && t.g === c.g && t.b === c.b && t.a === c.a,
        );
        if (j === -1) {
          j = palette.length;
          palette.push(c);
        }
        map.set(v, j);
      }
    }
  }
  const identity = [...map].every(([a, b]) => a === b);
  if (identity && palette.length === to.length) return { part, palette: to };
  const voxels = part.voxels.map((layer) =>
    layer.map((row) => row.map((v) => map.get(v) ?? v)),
  );
  return { part: { ...part, voxels }, palette };
}

// Apply `fn` to every geometry file's AST (or the single cvox for
// cvox-only / synthetic sources). Returns the source with each CHANGED
// file kept fully in sync: geometries map, the files snapshot (so
// export sees the edit), and — when the primary file changed — the live
// cvox/cvoxFile pair the rest of the editor reads. `fn` returns null
// for "no change to this file".
function pathBasename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

function mapGeometryFiles<S extends LoadedSource>(
  src: S,
  fn: (cvox: Cvox, path: string) => Cvox | null,
): S {
  if (src.kind !== 'folder' || src.geometries === undefined) {
    const next = fn(src.cvox, src.cvoxFile.name);
    if (next === null) return src;
    return {
      ...src,
      cvox: next,
      cvoxFile: { ...src.cvoxFile, text: serializeCvox(next) },
    };
  }
  let geometries: Map<string, Cvox> | null = null;
  let files: Map<string, FileEntry> | null = null;
  let primaryPatch: Pick<typeof src, 'cvox' | 'cvoxFile'> | null = null;
  for (const [path, g] of src.geometries) {
    const cur = path === src.cvoxFile.name ? src.cvox : g;
    const next = fn(cur, path);
    if (next === null) continue;
    const text = serializeCvox(next);
    if (geometries === null) geometries = new Map(src.geometries);
    geometries.set(path, next);
    if (src.files !== undefined) {
      if (files === null) files = new Map(src.files);
      files.set(path, { name: path, text });
    }
    if (path === src.cvoxFile.name) {
      primaryPatch = { cvox: next, cvoxFile: { ...src.cvoxFile, text } };
    }
  }
  if (geometries === null) return src;
  return {
    ...src,
    geometries,
    ...(files !== null && { files }),
    ...(primaryPatch !== null && primaryPatch),
  };
}

// Rewrite every resolved external animation (§6.3) with `fn`, updating
// BOTH the externalAnims map and the referenced file's text in the same
// source patch — so a part rename/delete is one undo across manifest,
// geometry AND external animation files. `fn` returns null for "no
// change to this clip". Two clips may reference one file; they carry
// the same parsed object, so `fn` rewrites the shared file identically.
function rewriteExternalAnims<S extends LoadedSource>(
  src: S,
  fn: (anim: InlineAnimation) => InlineAnimation | null,
): S {
  if (src.kind !== 'folder' || src.externalAnims === undefined) return src;
  const folder: Extract<LoadedSource, { kind: 'folder' }> = src;
  let anims: Map<string, { path: string; anim: InlineAnimation }> | null = null;
  let files: Map<string, FileEntry> | null = null;
  for (const [clip, rec] of folder.externalAnims!) {
    const built = fn(rec.anim);
    if (built === null || built === rec.anim) continue;
    if (anims === null) anims = new Map(folder.externalAnims);
    anims.set(clip, { path: rec.path, anim: built });
    if (folder.files !== undefined) {
      if (files === null) files = new Map(folder.files);
      files.set(rec.path, {
        name: rec.path,
        text: JSON.stringify(built, null, 2) + '\n',
      });
    }
  }
  if (anims === null) return src;
  const next: Extract<LoadedSource, { kind: 'folder' }> = {
    ...folder,
    externalAnims: anims,
    ...(files !== null && { files }),
  };
  return next as S;
}

type FolderSource = Extract<LoadedSource, { kind: 'folder' }>;

// Pure per-file rename/move over a folder source: a full-path rename IS
// a move (§8). Returns the updated source, or null if disallowed (the
// manifest anchor, a name clash in the target, a manifest-less geometry
// file, or a reference losing its §8 extension). Kept side-effect-free
// so a folder move can fold it over every contained file, so the
// manifest / palette / external-anim reference-following lives in ONE
// place shared by single-file rename and whole-folder move.
function renameFileInSource(
  src: FolderSource,
  from: string,
  to: string,
): FolderSource | null {
  if (src.files === undefined) return null;
  if (from === to || to === '' || to.startsWith('../')) return null;
  if (src.manifestFile?.name === from) return null; // the anchor
  if (src.files.has(to) || src.manifestFile?.name === to) return null;
  const entry = src.files.get(from);
  if (entry === undefined) return null;
  const isPrimary = src.cvoxFile.name === from;
  const inGeometry = src.geometries?.has(from) === true;
  // Geometry renames must be recorded in the manifest — without one the
  // loader can't find the file next time. And a reference keeps its §8
  // extension.
  if (isPrimary || inGeometry) {
    if (src.manifest === undefined) return null;
    if (!to.toLowerCase().endsWith('.cvox')) return null;
  }
  const isBoundPalette =
    src.manifest?.palette !== undefined &&
    normalizePath(src.manifest.palette) === from;
  if (isBoundPalette && !to.toLowerCase().endsWith('.json')) return null;
  const isAnimRef =
    src.manifest?.animations !== undefined &&
    Object.values(src.manifest.animations).some(
      (a) => typeof a === 'string' && normalizePath(a) === from,
    );
  if (isAnimRef && !to.toLowerCase().endsWith('.json')) return null;

  const files = new Map(src.files);
  files.delete(from);
  files.set(to, { name: to, text: entry.text });
  const removedFiles = new Set(src.removedFiles ?? []);
  removedFiles.add(from);
  removedFiles.delete(to);
  let next: FolderSource = { ...src, files, removedFiles };

  if (src.geometries?.has(from) === true) {
    const geometries = new Map(src.geometries);
    const cvox = geometries.get(from)!;
    geometries.delete(from);
    geometries.set(to, cvox);
    next = { ...next, geometries };
  }
  if (isPrimary) {
    next = { ...next, cvoxFile: { ...src.cvoxFile, name: to } };
  }
  // Keep the resolved externalAnims records pointing at the new path —
  // timeline edits write through `rec.path`, so a stale one would
  // resurrect the old file and orphan the manifest's ref.
  if (src.externalAnims !== undefined) {
    let anims: Map<string, { path: string; anim: InlineAnimation }> | null =
      null;
    for (const [clip, rec] of src.externalAnims) {
      if (rec.path !== from) continue;
      if (anims === null) anims = new Map(src.externalAnims);
      anims.set(clip, { path: to, anim: rec.anim });
    }
    if (anims !== null) next = { ...next, externalAnims: anims };
  }

  if (src.manifest !== undefined) {
    let m = src.manifest;
    let changed = false;
    if (isPrimary || inGeometry) {
      const geometry = manifestGeometry(m).map((g) =>
        normalizePath(g) === from ? to : normalizePath(g),
      );
      m = { ...m, geometry };
      changed = true;
    }
    if (isBoundPalette) {
      m = { ...m, palette: to };
      changed = true;
    }
    if (m.animations !== undefined) {
      const rebuilt: NonNullable<Manifest['animations']> = {};
      let animChanged = false;
      for (const [aName, anim] of Object.entries(m.animations)) {
        if (typeof anim === 'string' && normalizePath(anim) === from) {
          rebuilt[aName] = to;
          animChanged = true;
        } else {
          rebuilt[aName] = anim;
        }
      }
      if (animChanged) {
        m = { ...m, animations: rebuilt };
        changed = true;
      }
    }
    if (changed) {
      const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
      next = {
        ...next,
        manifest: m,
        manifestFile: {
          ...baseFile,
          text: JSON.stringify(m, null, 2) + '\n',
        },
      };
    }
  }
  return next;
}

// Relocate a whole folder: fold renameFileInSource over every file under
// `from`, re-prefixing each to `newDir`. Backs both drag-move (newDir =
// destination/name) and rename (newDir = parent/newName). Returns null
// (whole-move aborts) if the folder holds no files or any file rejects.
function moveFolderInSource(
  src: FolderSource,
  from: string,
  newDir: string,
): FolderSource | null {
  if (src.files === undefined) return null;
  if (newDir === from || newDir === '') return null;
  if (newDir.startsWith(`${from}/`)) return null; // into itself
  const prefix = `${from}/`;
  const moving = [...src.files.keys()].filter((p) => p.startsWith(prefix)).sort();
  if (moving.length === 0) return null;
  let next: FolderSource = src;
  for (const p of moving) {
    const stepped = renameFileInSource(next, p, `${newDir}${p.slice(from.length)}`);
    if (stepped === null) return null; // abort the whole move
    next = stepped;
  }
  return next;
}

// Pure single-file delete over a folder source: drop the file, mark it
// removed (Save deletes it from disk; undo restores it), and prune every
// manifest reference to it (geometry list, bound palette + its resolved
// record, external-anim clips). Returns null if the file is pinned (the
// anchor or primary geometry) or already gone. Extracted from
// handleDeleteFile so a folder delete can fold it over the subtree.
function deleteFileInSource(src: FolderSource, p: string): FolderSource | null {
  if (src.files === undefined) return null;
  if (src.manifestFile?.name === p) return null; // the anchor
  if (src.cvoxFile.name === p) return null; // primary geometry
  if (!src.files.has(p)) return null;
  const files = new Map(src.files);
  files.delete(p);
  const removedFiles = new Set(src.removedFiles ?? []);
  removedFiles.add(p);
  let next: FolderSource = { ...src, files, removedFiles };
  if (src.geometries?.has(p) === true) {
    const geometries = new Map(src.geometries);
    geometries.delete(p);
    next = { ...next, geometries };
  }
  if (src.externalAnims !== undefined) {
    let anims: Map<string, { path: string; anim: InlineAnimation }> | null =
      null;
    for (const [clip, rec] of src.externalAnims) {
      if (rec.path !== p) continue;
      if (anims === null) anims = new Map(src.externalAnims);
      anims.delete(clip);
    }
    if (anims !== null) {
      if (anims.size > 0) {
        next = { ...next, externalAnims: anims };
      } else {
        const { externalAnims: _drop, ...rest } = next;
        next = rest;
      }
    }
  }
  if (src.manifest !== undefined) {
    let m = src.manifest;
    let changed = false;
    if (
      m.geometry !== undefined &&
      m.geometry.some((g) => normalizePath(g) === p)
    ) {
      m = { ...m, geometry: m.geometry.filter((g) => normalizePath(g) !== p) };
      changed = true;
    }
    if (m.palette !== undefined && normalizePath(m.palette) === p) {
      // Deleting the bound palette drops the binding too — a dangling
      // reference would just be a guaranteed load error.
      const { palette: _dropped, ...rest } = m;
      m = rest;
      changed = true;
      const { externalPalette: _x, ...srcRest } = next;
      next = srcRest;
    }
    // Deleting an external animation file removes the clips that
    // referenced it and their resolved records, in this same step.
    if (m.animations !== undefined) {
      const rebuilt: NonNullable<Manifest['animations']> = {};
      let animChanged = false;
      for (const [aName, anim] of Object.entries(m.animations)) {
        if (typeof anim === 'string' && normalizePath(anim) === p) {
          animChanged = true;
          continue;
        }
        rebuilt[aName] = anim;
      }
      if (animChanged) {
        if (Object.keys(rebuilt).length > 0) {
          m = { ...m, animations: rebuilt };
        } else {
          const { animations: _drop, ...rest } = m;
          m = rest;
        }
        changed = true;
      }
    }
    if (changed) {
      const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
      next = {
        ...next,
        manifest: m,
        manifestFile: {
          ...baseFile,
          text: JSON.stringify(m, null, 2) + '\n',
        },
      };
    }
  }
  return next;
}

// A model-wide-unique part name (§5): `base` if free, else `base-2`, `-3`…
// (`-` is a legal identifier char, so the suffix keeps the name valid).
function uniquePartName(existing: ReadonlySet<string>, base: string): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
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
  const [viewMode, setViewMode] = useState<ViewMode>('cvox');
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
  // render time if the name no longer exists in cvox.parts so stale
  // selections after source edits don't leak through.
  const [selectedPartName, setSelectedPartName] = useState<string | null>(null);
  // In-progress "new part" draft: non-null while the tree shows the inline
  // name field (VS Code-style). `parent` is the part it will be nested under
  // (null = root). Cleared on confirm / cancel / load.
  const [creating, setCreating] = useState<{ parent: string | null } | null>(null);
  // Live parse error on the cvox source text. Non-null only while the
  // user's currently-typed text doesn't parse. Palette panel disables
  // itself in this state so its re-serialize doesn't clobber the
  // in-progress text.
  const [cvoxParseError, setCvoxParseError] = useState<string | null>(null);
  // Same role for the manifest source view. Independent timer and
  // error state, so a broken cvox doesn't block manifest editing
  // and vice versa.
  const [manifestParseError, setManifestParseError] = useState<string | null>(null);

  // Holds the timeout ID of the pending debounced reparse so we can
  // cancel it whenever new authoritative state arrives (further typing
  // resets the timer; structural edit pre-empts it entirely).
  const reparseCvoxTimer = useRef<number | null>(null);
  const reparseManifestTimer = useRef<number | null>(null);

  const cancelPendingCvoxReparse = useCallback(() => {
    if (reparseCvoxTimer.current !== null) {
      window.clearTimeout(reparseCvoxTimer.current);
      reparseCvoxTimer.current = null;
    }
  }, []);

  const cancelPendingManifestReparse = useCallback(() => {
    if (reparseManifestTimer.current !== null) {
      window.clearTimeout(reparseManifestTimer.current);
      reparseManifestTimer.current = null;
    }
  }, []);

  // Parse cvox text and land the outcome — error state plus (on success)
  // the AST amend. The single
  // implementation behind BOTH the debounced timer and the synchronous
  // flush below, so the two paths can't drift. Returns true when the
  // text parsed and the AST landed.
  const landCvoxReparse = useCallback((text: string): boolean => {
    const result = parseCvox(text);
    if (!result.ok) {
      setCvoxParseError(result.message);
      return false;
    }
    setCvoxParseError(null);
    dispatch({
      type: 'amend',
      apply: (current) => {
        if (current?.source === undefined) return current;
        return {
          ...current,
          source: { ...current.source, cvox: result.value },
        };
      },
    });
    return true;
  }, []);

  // Flush (not discard) a pending debounced cvox reparse: parse the
  // CURRENT text synchronously and land the amend / error now. Returns
  // false when the text doesn't parse — a structural edit must abort
  // rather than serialize from the stale AST, which would silently
  // overwrite what was just typed (audit A-6).
  const flushPendingCvoxReparse = useCallback((): boolean => {
    if (reparseCvoxTimer.current === null) return true;
    window.clearTimeout(reparseCvoxTimer.current);
    reparseCvoxTimer.current = null;
    const src = loadedRef.current?.source;
    if (src === undefined) return true;
    return landCvoxReparse(src.cvoxFile.text);
  }, [landCvoxReparse]);

  // Manifest counterpart of landCvoxReparse: parse + amend with a full
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
        if (current?.source?.kind !== 'folder') return current;
        const src = current.source;
        const refs = resolveProjectRefs(
          result.value,
          (p) => src.files?.get(p)?.text,
          { path: src.cvoxFile.name, cvox: src.cvox },
        );
        // Destructure away the maybe-now-absent keys (a successful
        // reparse also clears any stale load-time manifest error).
        const {
          manifestError: _err,
          externalPalette: _pal,
          externalAnims: _anims,
          projectErrors: _proj,
          ...rest
        } = src;
        // A changed geometry list can pull a different primary AST in.
        const primaryNext = refs.geometries.get(src.cvoxFile.name);
        return {
          ...current,
          source: {
            ...rest,
            manifest: result.value,
            geometries: refs.geometries,
            ...(primaryNext !== undefined && { cvox: primaryNext }),
            ...(refs.externalPalette !== undefined && {
              externalPalette: refs.externalPalette,
            }),
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
    if (src === undefined || src.kind !== 'folder') return true;
    const text = src.manifestFile?.text;
    if (text === undefined) return true;
    return landManifestReparse(text);
  }, [landManifestReparse]);

  const handleLoad = useCallback(
    (result: LoadResult) => {
      cancelPendingCvoxReparse();
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
      setCvoxParseError(null);
      setManifestParseError(null);
      setFramingKey((k) => k + 1);
      const hasManifest =
        result.source !== undefined &&
        result.source.kind === 'folder' &&
        result.source.manifest !== undefined;
      setViewMode(hasManifest ? 'rig' : 'cvox');
      setLayout((l) => openPanelById(l, 'preview'));
      // A load that carries problems (manifest that didn't parse, inline
      // comments that won't round-trip) foregrounds the Console so the
      // notice isn't silently hidden behind the Timeline tab.
      if (
        result.source !== undefined &&
        (result.source.droppedInlineComments > 0 ||
          (result.source.kind === 'folder' &&
            (result.source.manifestError !== undefined ||
              (result.source.projectErrors?.length ?? 0) > 0)))
      ) {
        setLayout((l) => openPanelById(l, 'console'));
      }
    },
    [cancelPendingCvoxReparse, cancelPendingManifestReparse],
  );

  const handleReset = useCallback(() => {
    cancelPendingCvoxReparse();
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
    setCvoxParseError(null);
    setManifestParseError(null);
    setViewMode('cvox');
  }, [cancelPendingCvoxReparse, cancelPendingManifestReparse]);

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

  // Cvox source-text edit (cvox tab textarea typing). Updates the text
  // immediately so every keystroke persists; schedules a debounced
  // reparse that updates the AST when it succeeds. The text remains
  // primary even while temporarily unparseable — Save / Export still
  // write what the user typed.
  const handleEditCvoxText = useCallback(
    (nextText: string) => {
      // Recorded with a per-file tag: a typing burst (keystrokes < 800ms
      // apart) is one undo entry whose pre-state is the text before the
      // burst started.
      dispatchEdit('text:cvox', (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        return {
          ...current,
          source: { ...src, cvoxFile: { ...src.cvoxFile, text: nextText } },
        };
      });
      cancelPendingCvoxReparse();
      reparseCvoxTimer.current = window.setTimeout(() => {
        reparseCvoxTimer.current = null;
        // The AST half of the already-recorded text edit — landCvoxReparse
        // amends, doesn't push (an entry whose undo changed only the
        // invisible AST would be a dead Ctrl+Z step).
        landCvoxReparse(nextText);
      }, REPARSE_DEBOUNCE_MS);
    },
    [dispatchEdit, cancelPendingCvoxReparse, landCvoxReparse],
  );

  // Per-file source editing for the dynamic file tabs (v0.7 packages).
  // Same shape as the cvox/manifest pipelines: record the text now
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
      if (path.endsWith('.cvox')) {
        const r = parseCvox(text);
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
              src.kind !== 'folder' ||
              src.geometries?.has(path) !== true
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
            if (src === undefined || src.kind !== 'folder') {
              return current;
            }
            let next = src;
            if (
              src.manifest?.palette !== undefined &&
              normalizePath(src.manifest.palette) === path
            ) {
              const pR = parsePaletteFile(json);
              if (pR.ok) next = { ...next, externalPalette: pR.value };
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
          src.kind !== 'folder' ||
          src.files === undefined
        ) {
          return current;
        }
        const prev = src.files.get(path);
        if (prev === undefined) return current;
        const files = new Map(src.files);
        files.set(path, { ...prev, text: nextText });
        return { ...current, source: { ...src, files } };
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
    if (src === undefined || src.kind !== 'folder') return true;
    let ok = true;
    for (const path of paths) {
      const text = src.files?.get(path)?.text;
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
    const cvoxOk = flushPendingCvoxReparse();
    const filesOk = flushPendingFileReparse();
    return cvoxOk && filesOk;
  }, [flushPendingCvoxReparse, flushPendingFileReparse]);

  const flushAllReparse = useCallback((): boolean => {
    const geomOk = flushGeometryReparse();
    const manifestOk = flushPendingManifestReparse();
    return geomOk && manifestOk;
  }, [flushGeometryReparse, flushPendingManifestReparse]);

  // ── Palette editing (Phase F). The panel edits the EFFECTIVE palette
  // (§6.10): a manifest binding routes writes to palette.json, else to
  // the primary file's inline declaration (via handleEditCvox). ──

  // Overwrite the bound external palette's colors (edit / add).
  const handleEditExternalPalette = useCallback(
    (next: Palette, tag?: string) => {
      dispatchEdit(tag ?? null, (current) => {
        const src = current?.source;
        if (src === undefined || src.kind !== 'folder') return current;
        if (src.manifest?.palette === undefined) return current;
        const path = normalizePath(src.manifest.palette);
        const files = src.files !== undefined ? new Map(src.files) : undefined;
        files?.set(path, {
          name: path,
          text:
            JSON.stringify({ colors: next.map(serializeColor) }, null, 2) +
            '\n',
        });
        return {
          ...current,
          source: {
            ...src,
            externalPalette: next,
            ...(files !== undefined && { files }),
          },
        };
      });
    },
    [dispatchEdit],
  );

  // Delete an (unused) color: every higher index shifts down, so the
  // voxels of every file resolving against this palette are remapped in
  // the same edit. Bound palette → all geometry files; inline → the
  // primary only (other files resolve against their own palettes).
  const handleDeletePaletteColor = useCallback(
    (index: number) => {
      if (!flushGeometryReparse()) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const bound =
          src.kind === 'folder' &&
          src.manifest?.palette !== undefined &&
          src.externalPalette !== undefined;
        const palette =
          bound && src.kind === 'folder'
            ? src.externalPalette!
            : src.cvox.palette;
        if (index < 0 || index >= palette.length) return current;
        const inScope = (cvox: Cvox): boolean =>
          bound || cvox === src.cvox;
        // Refuse while any in-scope voxel still uses the color.
        const scopeParts =
          bound ? mergeGeometries(src).parts : src.cvox.parts;
        for (const p of scopeParts) {
          for (const layer of p.voxels) {
            for (const row of layer) {
              if (row.includes(index)) return current;
            }
          }
        }
        const nextPalette = palette.filter((_, i) => i !== index);
        const shift = (cvox: Cvox): Cvox | null => {
          if (!inScope(cvox)) return null;
          let fileChanged = false;
          const parts: Part[] = cvox.parts.map((p) => {
            let partChanged = false;
            const voxels = p.voxels.map((layer) =>
              layer.map((row) =>
                row.map((idx) => {
                  if (idx !== AIR && idx > index) {
                    partChanged = true;
                    return idx - 1;
                  }
                  return idx;
                }),
              ),
            );
            if (!partChanged) return p;
            fileChanged = true;
            return { ...p, voxels };
          });
          const isPrimaryInlineHolder = !bound && cvox === src.cvox;
          if (!fileChanged && !isPrimaryInlineHolder) return null;
          return {
            ...cvox,
            parts: fileChanged ? parts : cvox.parts,
            ...(isPrimaryInlineHolder && { palette: nextPalette }),
          };
        };
        const nextSrc = mapGeometryFiles(src, (cvox) => shift(cvox));
        if (!bound || nextSrc.kind !== 'folder' || src.kind !== 'folder') {
          return { ...current, source: nextSrc };
        }
        const path = normalizePath(src.manifest!.palette!);
        const files =
          nextSrc.files !== undefined ? new Map(nextSrc.files) : undefined;
        files?.set(path, {
          name: path,
          text:
            JSON.stringify(
              { colors: nextPalette.map(serializeColor) },
              null,
              2,
            ) + '\n',
        });
        return {
          ...current,
          source: {
            ...nextSrc,
            externalPalette: nextPalette,
            ...(files !== undefined && { files }),
          },
        };
      });
    },
    [dispatchEdit, cancelPendingCvoxReparse],
  );

  // Re-point (or clear, path = null) the manifest's palette binding from
  // the panel's picker. Pure binding switch — no colors are copied
  // (Externalize / Inline do that). One undo.
  const handleChangePaletteBinding = useCallback(
    (path: string | null) => {
      if (!flushPendingManifestReparse()) return;
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.kind !== 'folder' ||
          src.manifest === undefined
        ) {
          return current;
        }
        const currentBinding =
          src.manifest.palette !== undefined
            ? normalizePath(src.manifest.palette)
            : undefined;
        const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
        if (path === null) {
          if (currentBinding === undefined) return current;
          const { palette: _dropped, ...restManifest } = src.manifest;
          const { externalPalette: _x, ...restSrc } = src;
          return {
            ...current,
            source: {
              ...restSrc,
              manifest: restManifest,
              manifestFile: {
                ...baseFile,
                text: JSON.stringify(restManifest, null, 2) + '\n',
              },
            },
          };
        }
        const norm = normalizePath(path);
        if (currentBinding === norm) return current;
        // Resolve the new binding now so the render/panel switch is
        // immediate; an unresolvable choice leaves externalPalette unset
        // (panel disables with a reason, Console explains on reload).
        let external: Palette | undefined;
        const text = src.files?.get(norm)?.text;
        if (text !== undefined) {
          try {
            const r = parsePaletteFile(JSON.parse(text));
            if (r.ok) external = r.value;
          } catch {
            // Falls through — binding set, resolution empty.
          }
        }
        const nextManifest: Manifest = { ...src.manifest, palette: norm };
        const { externalPalette: _x, ...restSrc } = src;
        return {
          ...current,
          source: {
            ...restSrc,
            manifest: nextManifest,
            manifestFile: {
              ...baseFile,
              text: JSON.stringify(nextManifest, null, 2) + '\n',
            },
            ...(external !== undefined && { externalPalette: external }),
          },
        };
      });
      setManifestParseError(null);
    },
    [dispatchEdit, cancelPendingManifestReparse],
  );

  // Move the primary's inline palette out to palette.json and bind it
  // (§6.10) — the inline declaration is dropped (the binding would
  // shadow it anyway, H03). One undo.
  const handleExternalizePalette = useCallback(() => {
    if (!flushAllReparse()) return;
    dispatchEdit(null, (current) => {
      const src = current?.source;
      if (
        src === undefined ||
        src.kind !== 'folder' ||
        src.manifest === undefined ||
        src.files === undefined ||
        src.manifest.palette !== undefined
      ) {
        return current;
      }
      const palette = src.cvox.palette;
      if (palette.length === 0) return current;
      let path = 'palette.json';
      let n = 2;
      while (src.files.has(path)) path = `palette-${n++}.json`;
      // Drop the inline declaration from the primary (empty = absent).
      const stripped = mapGeometryFiles(src, (cvox, p) =>
        p === src.cvoxFile.name ? { ...cvox, palette: [] } : null,
      );
      const files = new Map(stripped.files ?? src.files);
      files.set(path, {
        name: path,
        text:
          JSON.stringify({ colors: palette.map(serializeColor) }, null, 2) +
          '\n',
      });
      const nextManifest: Manifest = { ...src.manifest, palette: path };
      const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
      return {
        ...current,
        source: {
          ...stripped,
          files,
          externalPalette: palette,
          manifest: nextManifest,
          manifestFile: {
            ...baseFile,
            text: JSON.stringify(nextManifest, null, 2) + '\n',
          },
        },
      };
    });
    setManifestParseError(null);
  }, [dispatchEdit, cancelPendingCvoxReparse, cancelPendingManifestReparse]);

  // The reverse: copy the bound palette into the primary's inline
  // declaration and drop the binding. The palette.json file is kept
  // (it may be shared) — delete it from the Files tree if orphaned.
  const handleInlinePalette = useCallback(() => {
    if (!flushAllReparse()) return;
    dispatchEdit(null, (current) => {
      const src = current?.source;
      if (
        src === undefined ||
        src.kind !== 'folder' ||
        src.manifest?.palette === undefined ||
        src.externalPalette === undefined
      ) {
        return current;
      }
      const palette = src.externalPalette;
      const withInline = mapGeometryFiles(src, (cvox, p) =>
        p === src.cvoxFile.name ? { ...cvox, palette } : null,
      );
      const { palette: _dropped, ...restManifest } = src.manifest;
      const { externalPalette: _x, ...restSrc } = withInline;
      const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
      return {
        ...current,
        source: {
          ...restSrc,
          manifest: restManifest,
          manifestFile: {
            ...baseFile,
            text: JSON.stringify(restManifest, null, 2) + '\n',
          },
        },
      };
    });
    setManifestParseError(null);
  }, [dispatchEdit, cancelPendingCvoxReparse, cancelPendingManifestReparse]);

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
          src.kind !== 'folder' ||
          src.files === undefined
        ) {
          return current;
        }
        const norm = normalizePath(path);
        if (norm === '' || norm.startsWith('../')) return current;
        if (
          src.files.has(norm) ||
          src.cvoxFile.name === norm ||
          src.manifestFile?.name === norm
        ) {
          return current;
        }
        const isCvox = norm.toLowerCase().endsWith('.cvox');
        let text: string;
        let parsed: Cvox | null = null;
        if (isCvox) {
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
          text = serializeCvox(parsed);
        } else {
          text = norm.toLowerCase().endsWith('.json') ? '{}\n' : '';
        }
        const files = new Map(src.files);
        files.set(norm, { name: norm, text });
        const removedFiles = new Set(src.removedFiles ?? []);
        removedFiles.delete(norm); // re-creating a removed path revives it
        let next: typeof src = { ...src, files, removedFiles };
        if (isCvox && parsed !== null) {
          const geometries = new Map(
            src.geometries ?? [[src.cvoxFile.name, src.cvox]],
          );
          geometries.set(norm, parsed);
          next = { ...next, geometries };
          // Reference it from the manifest so it's part of the model
          // (unreferenced files are ignored + lint as W07).
          if (src.manifest !== undefined) {
            const geometry = manifestGeometry(src.manifest).map(normalizePath);
            if (!geometry.includes(norm)) geometry.push(norm);
            const nextManifest: Manifest = { ...src.manifest, geometry };
            const baseFile =
              src.manifestFile ?? { name: 'cuboidy.json', text: '' };
            next = {
              ...next,
              manifest: nextManifest,
              manifestFile: {
                ...baseFile,
                text: JSON.stringify(nextManifest, null, 2) + '\n',
              },
            };
          }
        }
        return { ...current, source: next };
      });
    },
    [dispatchEdit],
  );

  // Reference an existing-but-unreferenced .cvox from the manifest's
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
          src.kind !== 'folder' ||
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
          (p) => src.files?.get(p)?.text,
          { path: src.cvoxFile.name, cvox: src.cvox },
        );
        const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
        const {
          externalPalette: _pal,
          externalAnims: _anims,
          projectErrors: _proj,
          ...rest
        } = src;
        const primaryNext = refs.geometries.get(src.cvoxFile.name);
        return {
          ...current,
          source: {
            ...rest,
            manifest: nextManifest,
            manifestFile: {
              ...baseFile,
              text: JSON.stringify(nextManifest, null, 2) + '\n',
            },
            geometries: refs.geometries,
            ...(primaryNext !== undefined && { cvox: primaryNext }),
            ...(refs.externalPalette !== undefined && {
              externalPalette: refs.externalPalette,
            }),
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
          src.kind !== 'folder' ||
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
          src.kind !== 'folder' ||
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
          src.kind !== 'folder' ||
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
          src.kind !== 'folder' ||
          src.files === undefined
        ) {
          return current;
        }
        const targets = [...src.files.keys()]
          .filter((k) => k.startsWith(prefix))
          .sort();
        if (targets.length === 0) return current;
        let next: FolderSource = src;
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

  // Palette / future structural edit on the cvox AST. Re-serializes to
  // canonical text immediately and pre-empts any pending reparse (the
  // new text is by-construction parseable, so we know the error state
  // is cleared too).
  const handleEditCvox = useCallback(
    (nextCvox: Cvox, tag?: string) => {
      if (!flushGeometryReparse()) return;
      // Optional coalescing tag from the caller (the color picker fires
      // continuously while dragging inside the OS dialog).
      dispatchEdit(tag ?? null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        // Callers hand back a whole next AST for the PRIMARY file (the
        // palette panel and friends operate on it).
        const nextSrc = mapGeometryFiles(src, (_cvox, path) =>
          path === src.cvoxFile.name ? nextCvox : null,
        );
        return { ...current, source: nextSrc };
      });
    },
    [dispatchEdit, cancelPendingCvoxReparse],
  );

  // Rewrite ONE part's cvox geometry (pivot / sockets), routed to whichever
  // geometry file defines it — part names are unique model-wide (§5), so the
  // build runs on exactly one file. `build` returning the same part is a
  // no-op (mapGeometryFiles then returns the source unchanged, and the
  // history reducer drops the entry). Backs PartProperties' Geometry section.
  const mutateCvoxPart = useCallback(
    (tag: string | null, partName: string, build: (part: Part) => Part) => {
      if (!flushGeometryReparse()) return;
      dispatchEdit(tag, (current) => {
        const src = current?.source;
        if (src === undefined) return current;
        const nextSrc = mapGeometryFiles(src, (cvox) => {
          const i = cvox.parts.findIndex((p) => p.name === partName);
          if (i < 0) return null;
          const built = build(cvox.parts[i]!);
          if (built === cvox.parts[i]) return null;
          const parts = cvox.parts.slice();
          parts[i] = built;
          return { ...cvox, parts };
        });
        return nextSrc === src ? current : { ...current, source: nextSrc };
      });
    },
    [dispatchEdit, flushGeometryReparse],
  );

  // Adapter for PartProperties' Geometry section: (partName, build, tag?) —
  // the component supplies coalescing tags (e.g. a live pivot-axis drag) while
  // mutateCvoxPart takes the tag first.
  const handleEditPart = useCallback(
    (partName: string, build: (part: Part) => Part, tag?: string) => {
      mutateCvoxPart(tag ?? null, partName, build);
    },
    [mutateCvoxPart],
  );

  // Begin creating a part: open the inline draft row in the tree. The draft is
  // nested under the selected part when a manifest is loaded (so the new part
  // becomes its child); otherwise it goes to the root. Nothing is written until
  // the user confirms a name.
  const handleStartCreatePart = useCallback(() => {
    const src = loaded?.source;
    if (src === undefined) return;
    // Parenting writes the manifest, so it needs a clean manifest AST — with a
    // manifest syntax error, fall back to a root part (cvox-only, no clobber).
    const canParent =
      src.kind === 'folder' &&
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
        const file = m.files.get(sourceName) ?? src.cvoxFile.name;
        const newPart = make(source, newName);
        const nextSrc = mapGeometryFiles(src, (cvox, path) =>
          path === file ? { ...cvox, parts: [...cvox.parts, newPart] } : null,
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
      mutateCvoxPart(null, name, (p) => mirrorPart(p, axis, p.name));
    },
    [mutateCvoxPart],
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
          src.kind === 'folder' &&
          src.geometries?.has(file) === true
            ? file
            : src.cvoxFile.name;
        const targetCvox =
          src.kind === 'folder' && target !== src.cvoxFile.name
            ? (src.geometries?.get(target) ?? src.cvox)
            : src.cvox;
        const seed = targetCvox.palette.length > 0 ? 0 : AIR;
        const newPart: Part = {
          name,
          size: { w: 1, h: 1, d: 1 },
          pivot: { pos: { x: 0.5, y: 0, z: 0.5 } },
          sockets: [],
          voxels: [[[seed]]],
        };
        const nextSrc = mapGeometryFiles(src, (cvox, path) =>
          path === target
            ? { ...cvox, parts: [...cvox.parts, newPart] }
            : null,
        );
        if (parent !== null && src.kind === 'folder' && src.manifest !== undefined) {
          const parts: ManifestPart[] = [...src.manifest.parts, { name, parent }];
          const nextManifest: Manifest = { ...src.manifest, parts };
          const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
          return {
            ...current,
            source: {
              ...nextSrc,
              manifest: nextManifest,
              manifestFile: {
                ...baseFile,
                text: JSON.stringify(nextManifest, null, 2) + '\n',
              },
            },
          };
        }
        return { ...current, source: nextSrc };
      });
      setManifestParseError(null);
      setSelectedPartName(name);
      setCreating(null);
    },
    [dispatchEdit, cancelPendingCvoxReparse, cancelPendingManifestReparse],
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
          src.kind !== 'folder' ||
          src.geometries === undefined ||
          !src.geometries.has(targetPath)
        ) {
          return current;
        }
        const fromPath = mergeGeometries(src).files.get(name);
        if (fromPath === undefined || fromPath === targetPath) return current;
        const fromCvox =
          fromPath === src.cvoxFile.name
            ? src.cvox
            : src.geometries.get(fromPath);
        const toCvox =
          targetPath === src.cvoxFile.name
            ? src.cvox
            : src.geometries.get(targetPath);
        if (fromCvox === undefined || toCvox === undefined) return current;
        const part = fromCvox.parts.find((p) => p.name === name);
        if (part === undefined) return current;
        let moved = part;
        let toPalette = toCvox.palette;
        if (src.externalPalette === undefined) {
          const remapped = remapPartPalette(part, fromCvox.palette, toPalette);
          moved = remapped.part;
          toPalette = remapped.palette;
        }
        const nextSrc = mapGeometryFiles(src, (cvox, path) => {
          if (path === fromPath) {
            return { ...cvox, parts: cvox.parts.filter((p) => p.name !== name) };
          }
          if (path === targetPath) {
            return { ...cvox, palette: toPalette, parts: [...cvox.parts, moved] };
          }
          return null;
        });
        return { ...current, source: nextSrc };
      });
    },
    [dispatchEdit, cancelPendingCvoxReparse],
  );

  // Rename a part everywhere it's referenced, atomically (one dispatchEdit =
  // one undo). The name is a cross-file join key, so a piecemeal rename would
  // leave dangling references. Rewrites:
  //   cvox     — the part's `name`
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
        let nextSrc = mapGeometryFiles(src, (cvox) => {
          let changed = false;
          const parts: Part[] = cvox.parts.map((p) => {
            if (p.name !== oldName) return p;
            changed = true;
            return { ...p, name: newName };
          });
          return changed ? { ...cvox, parts } : null;
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
        if (src.kind === 'folder' && src.manifest !== undefined) {
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
          const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
          return {
            ...current,
            source: {
              ...nextSrc,
              manifest: nextManifest,
              manifestFile: {
                ...baseFile,
                text: JSON.stringify(nextManifest, null, 2) + '\n',
              },
            },
          };
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
    [dispatchEdit, cancelPendingCvoxReparse, cancelPendingManifestReparse],
  );

  // Delete a part, cleaning up its references atomically (one undo). Removes
  // the cvox part; in the manifest drops its entry, re-parents its children to
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
        let nextSrc = mapGeometryFiles(src, (cvox) =>
          cvox.parts.some((p) => p.name === name)
            ? { ...cvox, parts: cvox.parts.filter((p) => p.name !== name) }
            : null,
        );
        nextSrc = rewriteExternalAnims(nextSrc, (anim) => {
          if (!Object.hasOwn(anim.parts, name)) return null;
          const { [name]: _dropped, ...restTracks } = anim.parts;
          return { ...anim, parts: restTracks };
        });
        if (src.kind === 'folder' && src.manifest !== undefined) {
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
          const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
          return {
            ...current,
            source: {
              ...nextSrc,
              manifest: nextManifest,
              manifestFile: {
                ...baseFile,
                text: JSON.stringify(nextManifest, null, 2) + '\n',
              },
            },
          };
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
    [dispatchEdit, cancelPendingCvoxReparse, cancelPendingManifestReparse],
  );

  // Manifest source-text edit (manifest tab textarea typing). Same
  // shape as the cvox counterpart but uses JSON.parse + parseManifest.
  // Folder-only: cvox-only sources have no manifest file to edit.
  const handleEditManifestText = useCallback(
    (nextText: string) => {
      dispatchEdit('text:manifest', (current) => {
        if (current?.source?.kind !== 'folder') return current;
        const src = current.source;
        const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
        return {
          ...current,
          source: { ...src, manifestFile: { ...baseFile, text: nextText } },
        };
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
        if (current?.source?.kind !== 'folder') return current;
        const src = current.source;
        if (src.manifest === undefined) return current;
        const parts = src.manifest.parts.slice();
        const i = parts.findIndex((p) => p.name === partName);
        const base: ManifestPart = i >= 0 ? parts[i]! : { name: partName };
        const next = build(base);
        if (i >= 0) parts[i] = next;
        else parts.push(next);
        const nextManifest: Manifest = { ...src.manifest, parts };
        const nextText = JSON.stringify(nextManifest, null, 2) + '\n';
        const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
        return {
          ...current,
          source: {
            ...src,
            manifest: nextManifest,
            manifestFile: { ...baseFile, text: nextText },
          },
        };
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
        if (current?.source?.kind !== 'folder') return current;
        const src = current.source;
        if (src.manifest === undefined) return current;
        const nextManifest = build(src.manifest);
        if (nextManifest === src.manifest) return current;
        const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
        return {
          ...current,
          source: {
            ...src,
            manifest: nextManifest,
            manifestFile: {
              ...baseFile,
              text: JSON.stringify(nextManifest, null, 2) + '\n',
            },
          },
        };
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
        const nextSrc = mapGeometryFiles(src, (cvox) => {
          const i = cvox.parts.findIndex((p) => p.name === partName);
          if (i < 0) return null;
          const parts = cvox.parts.slice();
          parts[i] = {
            ...parts[i]!,
            pivot: {
              ...parts[i]!.pivot,
              pos: { x: pos[0], y: pos[1], z: pos[2] },
            },
          };
          return { ...cvox, parts };
        });
        if (nextSrc === src) return current;
        if (nextSrc.kind !== 'folder' || nextSrc.manifest === undefined) {
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
        const baseFile =
          nextSrc.manifestFile ?? { name: 'cuboidy.json', text: '' };
        return {
          ...current,
          source: {
            ...nextSrc,
            manifest: nextManifest,
            manifestFile: {
              ...baseFile,
              text: JSON.stringify(nextManifest, null, 2) + '\n',
            },
          },
        };
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
      mutateCvoxPart(null, partName, (p) => {
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
    [mutateCvoxPart],
  );

  // One completed voxel-tool stroke (design §2.6) — every painted /
  // erased / attached cell of the drag lands as ONE geometry edit =
  // one undo. Attach cells may lie outside the grid: the grid grows to
  // fit (§2.7), and negative-direction growth shifts voxels, pivot.pos
  // and every socket.pos together — the render is unchanged because
  // the −pivot draw offset cancels the shift exactly (no manifest
  // compensation needed). The cvox view, which draws raw coordinates,
  // re-origins once at commit.
  const handleStrokeVoxels = useCallback(
    (partName: string, edits: readonly VoxelEdit[]) => {
      if (edits.length === 0) return;
      const byKey = new Map(
        edits.map((e) => [`${e.x},${e.y},${e.z}`, e.value]),
      );
      mutateCvoxPart(null, partName, (p) => {
        const { w, h, d } = p.size;
        let minX = 0;
        let minY = 0;
        let minZ = 0;
        let maxX = w - 1;
        let maxY = h - 1;
        let maxZ = d - 1;
        for (const e of edits) {
          if (e.value === AIR) continue; // erases can't grow the grid
          if (e.x < minX) minX = e.x;
          if (e.y < minY) minY = e.y;
          if (e.z < minZ) minZ = e.z;
          if (e.x > maxX) maxX = e.x;
          if (e.y > maxY) maxY = e.y;
          if (e.z > maxZ) maxZ = e.z;
        }
        const sx = -minX;
        const sy = -minY;
        const sz = -minZ;
        const nw = maxX - minX + 1;
        const nh = maxY - minY + 1;
        const nd = maxZ - minZ + 1;
        if (sx === 0 && sy === 0 && sz === 0 && nw === w && nh === h && nd === d) {
          // In-place — no growth.
          let changed = false;
          const voxels = p.voxels.map((layer, y) =>
            layer.map((row, z) =>
              row.map((v, x) => {
                const nv = byKey.get(`${x},${y},${z}`);
                if (nv === undefined || nv === v) return v;
                changed = true;
                return nv;
              }),
            ),
          );
          return changed ? { ...p, voxels } : p;
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
    [mutateCvoxPart],
  );

  // Socket drag commits — part-local cvox edits through the shared
  // geometry mutation (one undo each).
  const handleGizmoMoveSocket = useCallback(
    (partName: string, socketName: string, pos: [number, number, number]) => {
      mutateCvoxPart(null, partName, (p) => ({
        ...p,
        sockets: p.sockets.map((s) =>
          s.name === socketName
            ? { ...s, pos: { x: pos[0], y: pos[1], z: pos[2] } }
            : s,
        ),
      }));
    },
    [mutateCvoxPart],
  );

  const handleGizmoRotateSocket = useCallback(
    (partName: string, socketName: string, rot: [number, number, number]) => {
      mutateCvoxPart(null, partName, (p) => ({
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
    [mutateCvoxPart],
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
      const manifest = synthesizeManifest(src.cvox, src.cvoxFile.name);
      const manifestText = JSON.stringify(manifest, null, 2) + '\n';
      const manifestFile = { name: 'cuboidy.json', text: manifestText };
      let next: LoadedSource;
      if (src.kind === 'cvox-only') {
        next = {
          kind: 'folder',
          folderName: manifest.name,
          synthetic: true,
          cvox: src.cvox,
          cvoxFile: src.cvoxFile,
          manifest,
          manifestFile,
          droppedInlineComments: src.droppedInlineComments,
        };
      } else {
        next = { ...src, synthetic: true, manifest, manifestFile };
        delete (next as { manifestError?: string }).manifestError;
      }
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
        if (current?.source?.kind !== 'folder') return current;
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
          const files =
            src.files !== undefined ? new Map(src.files) : undefined;
          files?.set(rec.path, {
            name: rec.path,
            text: JSON.stringify(built, null, 2) + '\n',
          });
          return {
            ...current,
            source: {
              ...src,
              externalAnims,
              ...(files !== undefined && { files }),
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
        const nextText = JSON.stringify(nextManifest, null, 2) + '\n';
        const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
        return {
          ...current,
          source: {
            ...src,
            manifest: nextManifest,
            manifestFile: { ...baseFile, text: nextText },
          },
        };
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
      if (current?.source?.kind !== 'folder') return current;
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
      const nextText = JSON.stringify(nextManifest, null, 2) + '\n';
      const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
      return {
        ...current,
        source: {
          ...src,
          manifest: nextManifest,
          manifestFile: { ...baseFile, text: nextText },
        },
      };
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
        if (current?.source?.kind !== 'folder') return current;
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
        const nextText = JSON.stringify(nextManifest, null, 2) + '\n';
        const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
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
          source: {
            ...src,
            manifest: nextManifest,
            manifestFile: { ...baseFile, text: nextText },
            ...(externalAnims !== undefined && { externalAnims }),
          },
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
        if (current?.source?.kind !== 'folder') return current;
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
        const nextText = JSON.stringify(nextManifest, null, 2) + '\n';
        const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
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
          source: {
            ...src,
            manifest: nextManifest,
            manifestFile: { ...baseFile, text: nextText },
            ...(externalAnims !== undefined && { externalAnims }),
          },
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
        if (current?.source?.kind !== 'folder') return current;
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
        files.set(path, {
          name: path,
          text: JSON.stringify(anim, null, 2) + '\n',
        });
        const externalAnims = new Map(src.externalAnims ?? []);
        externalAnims.set(name, { path, anim });
        const animations = { ...src.manifest.animations, [name]: path };
        const nextManifest: Manifest = { ...src.manifest, animations };
        const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
        return {
          ...current,
          source: {
            ...src,
            files,
            externalAnims,
            manifest: nextManifest,
            manifestFile: {
              ...baseFile,
              text: JSON.stringify(nextManifest, null, 2) + '\n',
            },
          },
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
        if (current?.source?.kind !== 'folder') return current;
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
        const baseFile = src.manifestFile ?? { name: 'cuboidy.json', text: '' };
        return {
          ...current,
          source: {
            ...src,
            externalAnims,
            manifest: nextManifest,
            manifestFile: {
              ...baseFile,
              text: JSON.stringify(nextManifest, null, 2) + '\n',
            },
          },
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
      setCvoxParseError(null);
      setManifestParseError(null);
      return;
    }
    const cvoxR = parseCvox(src.cvoxFile.text);
    setCvoxParseError(cvoxR.ok ? null : cvoxR.message);
    if (src.kind === 'folder' && src.manifestFile !== undefined) {
      let err: string | null = null;
      try {
        const r = parseManifest(JSON.parse(src.manifestFile.text));
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
    // .cvox parses, .json checks JSON well-formedness.
    setFileParseErrors(() => {
      const next = new Map<string, string>();
      if (src.kind !== 'folder' || src.files === undefined) return next;
      for (const [path, entry] of src.files) {
        if (path === src.cvoxFile.name) continue; // covered by cvoxParseError
        if (path === src.manifestFile?.name) continue;
        if (path.endsWith('.cvox')) {
          const r = parseCvox(entry.text);
          if (!r.ok) next.set(path, r.message);
        } else if (path.endsWith('.json')) {
          try {
            JSON.parse(entry.text);
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
    cancelPendingCvoxReparse();
    cancelPendingManifestReparse();
    cancelAllFileReparse();
    dispatch({ type: 'undo' });
    revalidateRestored(target);
  }, [
    history,
    cancelPendingCvoxReparse,
    cancelPendingManifestReparse,
    revalidateRestored,
  ]);

  const performRedo = useCallback(() => {
    if (history.future.length === 0) return;
    const target = history.future[0]!;
    cancelPendingCvoxReparse();
    cancelPendingManifestReparse();
    cancelAllFileReparse();
    dispatch({ type: 'redo' });
    revalidateRestored(target);
  }, [
    history,
    cancelPendingCvoxReparse,
    cancelPendingManifestReparse,
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
    source !== undefined && source.kind === 'folder' && source.manifest !== undefined;
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
        : 'cvox'
      : viewMode === 'rig' && !rigAvailable
        ? 'cvox'
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
      cvoxParseError !== null ||
      fileParseErrors.size > 0;
    if (effectiveViewMode === 'anim') {
      d.move = 'Rest editing lives in the Rig and Cvox views';
      d.rotate = 'Rest editing lives in the Rig and Cvox views';
      d.attach = 'Voxel editing lives in the Rig and Cvox views for now';
      d.erase = 'Voxel editing lives in the Rig and Cvox views for now';
      d.paint = 'Voxel editing lives in the Rig and Cvox views for now';
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
    cvoxParseError,
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
    if (source?.kind !== 'folder' || source.manifest === undefined) {
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
    if (source?.kind === 'folder' && source.manifest?.animations !== undefined) {
      for (const [name, anim] of Object.entries(source.manifest.animations)) {
        if (typeof anim === 'string') m.set(name, normalizePath(anim));
      }
    }
    return m;
  }, [source]);
  const modelCvox = useMemo((): Cvox | undefined => {
    if (source === undefined || merged === undefined) return undefined;
    return { palette: source.cvox.palette, parts: merged.parts };
  }, [source, merged]);
  const renderCvox = useMemo(() => {
    if (modelCvox === undefined) return undefined;
    if (source?.kind !== 'folder' || source.externalPalette === undefined) {
      return modelCvox;
    }
    return { ...modelCvox, palette: source.externalPalette };
  }, [modelCvox, source]);
  // Per-part render palettes (SPEC §6.10): with a binding, one palette
  // covers everything (renderCvox above); WITHOUT one, each part
  // resolves against its own defining file's inline palette — only
  // relevant for unbound multi-file models.
  const partPalettes = useMemo(() => {
    if (
      source?.kind !== 'folder' ||
      source.geometries === undefined ||
      source.geometries.size <= 1 ||
      source.externalPalette !== undefined
    ) {
      return undefined;
    }
    const m = new Map<string, Palette>();
    for (const [path, g] of source.geometries) {
      const cvox = path === source.cvoxFile.name ? source.cvox : g;
      for (const part of cvox.parts) {
        if (!m.has(part.name)) m.set(part.name, cvox.palette);
      }
    }
    return m;
  }, [source]);
  // What the Palette panel edits — the model's EFFECTIVE palette per the
  // §6.10 precedence: the bound external file (binding presence decides,
  // even while unresolved — the panel then disables with a reason), else
  // the primary's inline.
  const paletteTarget = useMemo(() => {
    if (source?.kind === 'folder' && source.manifest?.palette !== undefined) {
      return {
        kind: 'external' as const,
        path: normalizePath(source.manifest.palette),
      };
    }
    return source !== undefined
      ? { kind: 'inline' as const, file: source.cvoxFile.name }
      : undefined;
  }, [source]);
  // Binding picker choices: every package .json that parses as a palette
  // file, plus the current binding even when broken (the select shows
  // reality). Sorted for a stable menu.
  const paletteBindingChoices = useMemo(() => {
    if (source?.kind !== 'folder' || source.files === undefined) return [];
    const manifestName = source.manifestFile?.name ?? 'cuboidy.json';
    const out: string[] = [];
    for (const [path, entry] of source.files) {
      if (!path.toLowerCase().endsWith('.json') || path === manifestName) {
        continue;
      }
      try {
        if (parsePaletteFile(JSON.parse(entry.text)).ok) out.push(path);
      } catch {
        // Not JSON — not a palette candidate.
      }
    }
    const binding =
      source.manifest?.palette !== undefined
        ? normalizePath(source.manifest.palette)
        : undefined;
    if (binding !== undefined && !out.includes(binding)) out.push(binding);
    return out.sort();
  }, [source]);

  // Dock layout tree (resizable, rearrangeable). In-memory only — layout is
  // session-scoped by design (no persistence); "Reset layout" restores it.
  // Null = every panel closed (empty dock); App renders an add-panel state.
  const [layout, setLayout] = useState<LayoutNode | null>(initialLayout);

  // Display title for any panel. Static for tool panels; the source files take
  // their actual file name so the dock tab reads "voxels.cvox" / "cuboidy.json"
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
        case 'cvox':
          return source?.cvoxFile.name ?? 'voxels.cvox';
        case 'manifest':
          return (
            (source?.kind === 'folder' ? source.manifestFile?.name : undefined) ??
            'cuboidy.json'
          );
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
  // it was closed). The primary geometry maps to the classic cvox panel,
  // cuboidy.json to the manifest panel, anything else to a dynamic
  // per-file tab.
  const handleOpenPath = useCallback(
    (path: string) => {
      const src = loaded?.source;
      if (src === undefined) return;
      const id: LeafId =
        path === src.cvoxFile.name
          ? 'cvox'
          : src.kind === 'folder' && src.manifestFile?.name === path
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
    if (source.kind === 'folder') {
      for (const pe of source.projectErrors ?? []) m.set(pe.file, pe.message);
    }
    for (const [p, msg] of fileParseErrors) m.set(p, msg);
    const mErr =
      manifestParseError ??
      (source.kind === 'folder' ? source.manifestError : undefined);
    if (
      mErr !== undefined &&
      mErr !== null &&
      source.kind === 'folder' &&
      source.manifestFile !== undefined
    ) {
      m.set(source.manifestFile.name, mErr);
    }
    if (cvoxParseError !== null) m.set(source.cvoxFile.name, cvoxParseError);
    return m;
  }, [source, fileParseErrors, cvoxParseError, manifestParseError]);

  // Shared animation session (active clip, playback time, selected key). Owned
  // here so the Preview viewport and the Timeline panel are separate dock
  // panels reading the same state. The clock/Space follow the anim viewport;
  // the lane-editing keys follow the Timeline panel's visibility.
  const animSession = useAnimationSession({
    cvox: modelCvox,
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
  // (preview / cvox / manifest) were the in-center TabBar's tabs; they now
  // `fill` their leaf and manage their own scrolling (3D canvas, textareas).
  const getPanel = (id: LeafId): PanelContent | null => {
    if (source === undefined) return null;
    const manifest = source.kind === 'folder' ? source.manifest : undefined;
    const title = panelTitle(id);
    // Dynamic per-file editor tabs (v0.7): any package file the Files
    // tree opened that isn't the primary cvox / manifest pair.
    const fpath = filePanelPath(id);
    if (fpath !== null) {
      const entry =
        source.kind === 'folder' ? source.files?.get(fpath) : undefined;
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
            text={entry.text}
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
            : undefined) ?? (renderCvox ?? source.cvox).palette;
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
              source.kind === 'folder' &&
              animManifest !== undefined ? (
                <AnimationViewport
                  cvox={renderCvox ?? source.cvox}
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
                  cvox={renderCvox ?? source.cvox}
                  manifest={source.kind === 'folder' ? source.manifest : undefined}
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
      case 'cvox':
        return {
          title,
          fill: true,
          body: (
            <SourceEditor
              text={source.cvoxFile.text}
              {...(cvoxParseError !== null && { parseError: cvoxParseError })}
              onChange={handleEditCvoxText}
            />
          ),
        };
      case 'manifest':
        return {
          title,
          fill: true,
          body:
            source.kind === 'folder' && source.manifestFile !== undefined ? (
              <SourceEditor
                text={source.manifestFile.text}
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
        const modelParts = merged?.parts ?? source.cvox.parts;
        const visibleCount = modelParts.length - hiddenParts.size;
        const existingNames = new Set(modelParts.map((p) => p.name));
        let n = 1;
        while (existingNames.has(`part${n}`)) n += 1;
        const createSuggested = `part${n}`;
        // Multi-cvox: the create draft offers a target-file picker.
        // Insertion order of `geometries` is geometry-list order, so the
        // first entry is the primary (the single-file default).
        const geometryPaths =
          source.kind === 'folder' && (source.geometries?.size ?? 0) > 1
            ? [...(source.geometries?.keys() ?? [])]
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
                    cvoxParseError !== null || fileParseErrors.size > 0
                  }
                  title={
                    cvoxParseError !== null || fileParseErrors.size > 0
                      ? 'Fix cvox syntax errors to add parts'
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
                    source.kind === 'folder' &&
                    (source.geometries?.size ?? 0) > 1
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
                    cvoxParseError === null &&
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
        // Multi-cvox: the inspector shows a defining-file field whose
        // change moves the part. Same source as the parts panel picker.
        const movePaths =
          source.kind === 'folder' && (source.geometries?.size ?? 0) > 1
            ? [...(source.geometries?.keys() ?? [])]
            : undefined;
        return {
          title: 'Properties',
          body:
            effectiveSelectedPart !== null ? (
              <PartProperties
                selectedPart={effectiveSelectedPart}
                cvox={modelCvox ?? source.cvox}
                manifest={manifest}
                manifestEditsDisabled={manifestParseError !== null}
                renameDisabled={
                  cvoxParseError !== null ||
                  fileParseErrors.size > 0 ||
                  (manifest !== undefined && manifestParseError !== null)
                }
                geometryFiles={movePaths}
                partFile={partFiles?.get(effectiveSelectedPart)}
                moveDisabled={
                  cvoxParseError !== null || fileParseErrors.size > 0
                }
                cvoxEditsDisabled={
                  cvoxParseError !== null || fileParseErrors.size > 0
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
        const target =
          paletteTarget ?? ({ kind: 'inline', file: source.cvoxFile.name } as const);
        const external = target.kind === 'external';
        // A binding that didn't resolve (missing / invalid file) shows an
        // empty palette + a disabled reason rather than silently falling
        // back to inline (which the binding shadows anyway).
        const unresolved =
          external &&
          (source.kind !== 'folder' || source.externalPalette === undefined);
        const effective = external
          ? source.kind === 'folder'
            ? (source.externalPalette ?? [])
            : []
          : source.cvox.palette;
        const bindable =
          source.kind === 'folder' &&
          source.manifest !== undefined &&
          source.files !== undefined;
        return {
          title: 'Palette',
          body: (
            <PalettePanel
              palette={effective}
              // Usage spans the files resolving against this palette:
              // bound → the whole model; inline → the primary file.
              parts={
                external ? (merged?.parts ?? source.cvox.parts) : source.cvox.parts
              }
              target={target}
              disabled={
                external
                  ? manifestParseError !== null || unresolved
                  : cvoxParseError !== null
              }
              disabledReason={
                external
                  ? unresolved
                    ? `The bound palette (${target.path}) is missing or invalid — fix the file or pick another binding above.`
                    : 'Manifest source has syntax errors — fix to enable palette editing.'
                  : undefined
              }
              onChange={(next, tag) =>
                external
                  ? handleEditExternalPalette(next, tag)
                  : handleEditCvox({ ...source.cvox, palette: next }, tag)
              }
              onDeleteColor={handleDeletePaletteColor}
              onExternalize={
                !external &&
                bindable &&
                source.cvox.palette.length > 0
                  ? handleExternalizePalette
                  : undefined
              }
              onInline={
                external && !unresolved ? handleInlinePalette : undefined
              }
              bindingChoices={bindable ? paletteBindingChoices : undefined}
              onChangeBinding={bindable ? handleChangePaletteBinding : undefined}
              bindingDisabled={manifestParseError !== null}
            />
          ),
        };
      }
      case 'console': {
        // Derived, not stored: the model's current problems. Live parse
        // errors mirror the in-editor banners; the dropped-comments notice
        // is load-time only (it can't change until the next load).
        const entries: ConsoleEntry[] = [];
        if (cvoxParseError !== null) {
          entries.push({
            severity: 'error',
            source: source.cvoxFile.name,
            message: (
              <>
                <strong>Syntax error:</strong> {cvoxParseError}
              </>
            ),
          });
        }
        const manifestErr =
          manifestParseError ??
          (source.kind === 'folder' ? source.manifestError : undefined) ??
          null;
        if (manifestErr !== null) {
          entries.push({
            severity: 'error',
            source:
              (source.kind === 'folder' ? source.manifestFile?.name : undefined) ??
              'cuboidy.json',
            message: (
              <>
                <strong>Syntax error:</strong> {manifestErr}
              </>
            ),
          });
        }
        if (source.kind === 'folder' && source.projectErrors !== undefined) {
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
                <strong>Syntax error:</strong> {msg}
              </>
            ),
          });
        }
        if (source.droppedInlineComments > 0) {
          entries.push({
            severity: 'warning',
            source: source.cvoxFile.name,
            message: (
              <>
                <strong>
                  {source.droppedInlineComments} inline comment(s) will not be
                  preserved.
                </strong>{' '}
                Only file-header comments (consecutive <code>//</code> lines
                before the first declaration) round-trip through the editor.
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
                {source.kind === 'folder' && <SaveButton source={source} />}
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
          <strong>Syntax error:</strong> {loaded.error}
        </div>
      )}
    </aside>
  );
}
