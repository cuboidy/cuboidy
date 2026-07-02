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
  addAttrAtTime,
  deleteAttrAtKey,
  isIdentifier,
  manifestGeometry,
  moveAttrKey,
  parseCvox,
  parseManifest,
  parsePaletteFile,
  serializeCvox,
  setAttrAtKey,
  trimTrackKeys,
  type AttrValue,
  type Cvox,
  type InlineAnimation,
  type KeyAttr,
  type Manifest,
  type ManifestPart,
  type Part,
} from '@cuboidy/core';
import { AnimationViewport } from './components/AnimationViewport.js';
import { ConsolePanel, type ConsoleEntry } from './components/ConsolePanel.js';
import { Dock, type PanelContent } from './components/Dock.js';
import { ExportMenu } from './components/ExportMenu.js';
import { FileDropZone } from './components/FileDropZone.js';
import { FileTree } from './components/FileTree.js';
import { PalettePanel } from './components/PalettePanel.js';
import { PartProperties } from './components/PartProperties.js';
import { PartTree } from './components/PartTree.js';
import { SaveButton } from './components/SaveButton.js';
import { SourceEditor } from './components/SourceEditor.js';
import { TimelinePanel } from './components/TimelinePanel.js';
import { ViewModeToggle } from './components/ViewModeToggle.js';
import { VoxelScene } from './components/VoxelScene.js';
import { historyReducer, makeHistory } from './lib/history.js';
import { normalizePath } from './lib/load-model.js';
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
  LoadResult,
  LoadedSource,
  ViewMode,
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
  const dispatchEdit = useCallback(
    (tag: string | null, apply: (c: LoadResult | null) => LoadResult | null) => {
      dispatch({ type: 'edit', tag, at: Date.now(), apply });
    },
    [],
  );
  const [hiddenParts, setHiddenParts] = useState<ReadonlySet<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('cvox');
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
        const result = parseCvox(nextText);
        if (result.ok) {
          setCvoxParseError(null);
          // The AST half of the already-recorded text edit — amend, don't
          // push (an entry whose undo changed only the invisible AST would
          // be a dead Ctrl+Z step).
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
        } else {
          setCvoxParseError(result.message);
        }
      }, REPARSE_DEBOUNCE_MS);
    },
    [dispatchEdit, cancelPendingCvoxReparse],
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
          if (path.endsWith('.cvox')) {
            const r = parseCvox(nextText);
            if (!r.ok) {
              setFileParseError(path, r.message);
              return;
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
          } else if (path.endsWith('.json')) {
            let json: unknown;
            try {
              json = JSON.parse(nextText);
            } catch (e) {
              setFileParseError(path, `JSON parse: ${(e as Error).message}`);
              return;
            }
            setFileParseError(path, null);
            // If this file is the manifest-bound palette, re-derive it.
            // A schema-invalid edit keeps the last good palette (a reload
            // surfaces it as a project error).
            dispatch({
              type: 'amend',
              apply: (current) => {
                const src = current?.source;
                if (
                  src === undefined ||
                  src.kind !== 'folder' ||
                  src.manifest?.palette === undefined ||
                  normalizePath(src.manifest.palette) !== path
                ) {
                  return current;
                }
                const pR = parsePaletteFile(json);
                if (!pR.ok) return current;
                return {
                  ...current,
                  source: { ...src, externalPalette: pR.value },
                };
              },
            });
          } else {
            setFileParseError(path, null);
          }
        }, REPARSE_DEBOUNCE_MS),
      );
    },
    [dispatchEdit, setFileParseError],
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

  const handleRenameFile = useCallback(
    (oldPath: string, newPath: string) => {
      const from = normalizePath(oldPath);
      const to = normalizePath(newPath);
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.kind !== 'folder' ||
          src.files === undefined
        ) {
          return current;
        }
        if (from === to || to === '' || to.startsWith('../')) return current;
        if (src.manifestFile?.name === from) return current; // the anchor
        if (src.files.has(to) || src.manifestFile?.name === to) return current;
        const entry = src.files.get(from);
        if (entry === undefined) return current;
        const isPrimary = src.cvoxFile.name === from;
        const inGeometry = src.geometries?.has(from) === true;
        // Geometry renames must be recorded in the manifest — without
        // one the loader can't find the file next time. And a reference
        // keeps its §8 extension.
        if (isPrimary || inGeometry) {
          if (src.manifest === undefined) return current;
          if (!to.toLowerCase().endsWith('.cvox')) return current;
        }
        const isBoundPalette =
          src.manifest?.palette !== undefined &&
          normalizePath(src.manifest.palette) === from;
        if (isBoundPalette && !to.toLowerCase().endsWith('.json')) {
          return current;
        }

        const files = new Map(src.files);
        files.delete(from);
        files.set(to, { name: to, text: entry.text });
        const removedFiles = new Set(src.removedFiles ?? []);
        removedFiles.add(from);
        removedFiles.delete(to);
        let next: typeof src = { ...src, files, removedFiles };

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
            const baseFile =
              src.manifestFile ?? { name: 'cuboidy.json', text: '' };
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
        return { ...current, source: next };
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
    [dispatchEdit],
  );

  const handleDeleteFile = useCallback(
    (path: string) => {
      const p = normalizePath(path);
      dispatchEdit(null, (current) => {
        const src = current?.source;
        if (
          src === undefined ||
          src.kind !== 'folder' ||
          src.files === undefined
        ) {
          return current;
        }
        if (src.manifestFile?.name === p) return current; // the anchor
        if (src.cvoxFile.name === p) return current; // primary geometry
        if (!src.files.has(p)) return current;
        const files = new Map(src.files);
        files.delete(p);
        const removedFiles = new Set(src.removedFiles ?? []);
        removedFiles.add(p);
        let next: typeof src = { ...src, files, removedFiles };
        if (src.geometries?.has(p) === true) {
          const geometries = new Map(src.geometries);
          geometries.delete(p);
          next = { ...next, geometries };
        }
        if (src.manifest !== undefined) {
          let m = src.manifest;
          let changed = false;
          if (
            m.geometry !== undefined &&
            m.geometry.some((g) => normalizePath(g) === p)
          ) {
            m = {
              ...m,
              geometry: m.geometry.filter((g) => normalizePath(g) !== p),
            };
            changed = true;
          }
          if (m.palette !== undefined && normalizePath(m.palette) === p) {
            // Deleting the bound palette drops the binding too — a
            // dangling reference would just be a guaranteed load error.
            const { palette: _dropped, ...rest } = m;
            m = rest;
            changed = true;
            const { externalPalette: _x, ...srcRest } = next;
            next = srcRest;
          }
          if (changed) {
            const baseFile =
              src.manifestFile ?? { name: 'cuboidy.json', text: '' };
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
        return { ...current, source: next };
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

  // Palette / future structural edit on the cvox AST. Re-serializes to
  // canonical text immediately and pre-empts any pending reparse (the
  // new text is by-construction parseable, so we know the error state
  // is cleared too).
  const handleEditCvox = useCallback(
    (nextCvox: Cvox, tag?: string) => {
      cancelPendingCvoxReparse();
      setCvoxParseError(null);
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

  // Confirm the draft: append a 1×1×1 solid block (palette index 0, or AIR if
  // the palette is empty) named `name`, and — when a `parent` is given — add a
  // manifest entry parenting it there. Both files change in ONE dispatchEdit,
  // so it's a single atomic undo step. Re-guards uniqueness (the UI validates,
  // but a race could sneak a dup in). Then selects the new part.
  const handleConfirmCreatePart = useCallback(
    (name: string, parent: string | null) => {
      cancelPendingCvoxReparse();
      cancelPendingManifestReparse();
      setCvoxParseError(null);
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        // Uniqueness is model-wide (§5): guard against a name defined in
        // ANY geometry file. New parts are created in the primary file.
        if (mergeGeometries(src).parts.some((p) => p.name === name)) {
          return current;
        }
        const seed = src.cvox.palette.length > 0 ? 0 : AIR;
        const newPart: Part = {
          name,
          size: { w: 1, h: 1, d: 1 },
          pivot: { pos: { x: 0.5, y: 0, z: 0.5 } },
          sockets: [],
          voxels: [[[seed]]],
        };
        const nextSrc = mapGeometryFiles(src, (cvox, path) =>
          path === src.cvoxFile.name
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

  // Rename a part everywhere it's referenced, atomically (one dispatchEdit =
  // one undo). The name is a cross-file join key, so a piecemeal rename would
  // leave dangling references. Rewrites:
  //   cvox     — the part's `name`, and any part cloning/mirroring it (from.part)
  //   manifest — the entry `name`, any `parent` pointing at it, and every inline
  //              animation track keyed by the old name (re-keyed, order kept)
  // External string-ref animation files live outside the manifest and can't be
  // rewritten here — a part they reference by name would break (known limit).
  const handleRenamePart = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName || !isIdentifier(newName)) return;
      cancelPendingCvoxReparse();
      cancelPendingManifestReparse();
      setCvoxParseError(null);
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        // Existence / collision checks are model-wide (§5) — the part and
        // its reuse references may live in different geometry files.
        const allParts = mergeGeometries(src).parts;
        if (!allParts.some((p) => p.name === oldName)) return current;
        if (allParts.some((p) => p.name === newName)) return current;
        const nextSrc = mapGeometryFiles(src, (cvox) => {
          let changed = false;
          const parts: Part[] = cvox.parts.map((p) => {
            let np: Part = p;
            if (np.name === oldName) {
              np = { ...np, name: newName };
              changed = true;
            }
            if (np.from !== undefined && np.from.part === oldName) {
              np = { ...np, from: { ...np.from, part: newName } };
              changed = true;
            }
            return np;
          });
          return changed ? { ...cvox, parts } : null;
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
  // tracks. BLOCKS (no-op) if another part clones/mirrors it — the UI disables
  // the action in that case, so this guard is just defensive. No confirmation:
  // undo is the safety net (same as clip delete).
  const handleDeletePart = useCallback(
    (name: string) => {
      cancelPendingCvoxReparse();
      cancelPendingManifestReparse();
      setCvoxParseError(null);
      dispatchEdit(null, (current) => {
        if (current?.source === undefined) return current;
        const src = current.source;
        // Model-wide checks (§5): the part and any clone/mirror of it may
        // live in different geometry files.
        const allParts = mergeGeometries(src).parts;
        if (!allParts.some((p) => p.name === name)) return current;
        // A clone/mirror of this part would dangle — refuse.
        if (allParts.some((p) => p.name !== name && p.from?.part === name)) {
          return current;
        }
        const nextSrc = mapGeometryFiles(src, (cvox) =>
          cvox.parts.some((p) => p.name === name)
            ? { ...cvox, parts: cvox.parts.filter((p) => p.name !== name) }
            : null,
        );
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
        let json: unknown;
        try {
          json = JSON.parse(nextText);
        } catch (e) {
          setManifestParseError(`JSON parse: ${(e as Error).message}`);
          return;
        }
        const result = parseManifest(json);
        if (result.ok) {
          setManifestParseError(null);
          dispatch({
            type: 'amend',
            apply: (current) => {
              if (current?.source?.kind !== 'folder') return current;
              const nextSource = {
                ...current.source,
                manifest: result.value,
              };
              // A successful reparse clears any stale load-time manifest
              // error, so the file tree's error state tracks the live text.
              delete (nextSource as { manifestError?: string }).manifestError;
              return { ...current, source: nextSource };
            },
          });
        } else {
          setManifestParseError(result.message);
        }
      }, REPARSE_DEBOUNCE_MS);
    },
    [dispatchEdit, cancelPendingManifestReparse],
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
      cancelPendingManifestReparse();
      setManifestParseError(null);
    },
    [dispatchEdit, cancelPendingManifestReparse],
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

  const handleCreateManifest = useCallback(() => {
    cancelPendingManifestReparse();
    setManifestParseError(null);
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
  }, [dispatchEdit, cancelPendingManifestReparse]);

  // ─── Animation (keyframe editor) edits ──────────────────────────────
  //
  // The `animations` analog of mutateManifestPart: immutably updates one
  // inline animation, keeps the serialized manifest text in sync, and clears
  // stale parse-error state. No-ops on a string-ref animation (external file,
  // not editable in-app yet) or when no manifest is loaded.
  const mutateManifestAnimation = useCallback(
    (
      tag: string | null,
      animName: string,
      build: (anim: InlineAnimation) => InlineAnimation,
    ) => {
      dispatchEdit(tag, (current) => {
        if (current?.source?.kind !== 'folder') return current;
        const src = current.source;
        if (src.manifest === undefined) return current;
        const prev = src.manifest.animations?.[animName];
        if (prev === undefined || typeof prev === 'string') return current;
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
      cancelPendingManifestReparse();
      setManifestParseError(null);
    },
    [dispatchEdit, cancelPendingManifestReparse],
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
    cancelPendingManifestReparse();
    setManifestParseError(null);
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
  }, [dispatchEdit, cancelPendingManifestReparse]);

  // Rename a clip, preserving its position in the animations map (rebuild
  // entries in insertion order, swapping the key) so the JSON diff is one
  // line. Collision checks use Object.hasOwn — `animations['constructor']`
  // would be truthy via the prototype chain — and run against ALL keys
  // (string-ref animations included).
  const handleRenameClip = useCallback(
    (oldName: string, newName: string) => {
      if (oldName === newName || !isIdentifier(newName)) return;
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
        return {
          ...current,
          source: {
            ...src,
            manifest: nextManifest,
            manifestFile: { ...baseFile, text: nextText },
          },
        };
      });
      cancelPendingManifestReparse();
      setManifestParseError(null);
    },
    [dispatchEdit, cancelPendingManifestReparse],
  );

  // Delete a clip. No confirmation — undo is the safety net. Deleting the
  // last clip drops the `animations` property entirely (SPEC: absent → no
  // animations; cleaner authored JSON).
  const handleDeleteClip = useCallback(
    (name: string) => {
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
        return {
          ...current,
          source: {
            ...src,
            manifest: nextManifest,
            manifestFile: { ...baseFile, text: nextText },
          },
        };
      });
      cancelPendingManifestReparse();
      setManifestParseError(null);
    },
    [dispatchEdit, cancelPendingManifestReparse],
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
  }, []);

  // React flushes discrete events synchronously, so consecutive Ctrl+Z
  // presses each see fresh history state through this closure.
  const performUndo = useCallback(() => {
    if (history.past.length === 0) return;
    const target = history.past[history.past.length - 1]!;
    cancelPendingCvoxReparse();
    cancelPendingManifestReparse();
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

  const animManifest = source?.kind === 'folder' ? source.manifest : undefined;
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
        case 'parts':
          return 'Parts';
        case 'properties':
          return 'Properties';
        case 'palette':
          return 'Palette';
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
  // Which package files are currently visible (their panel is the active
  // tab of its leaf) — the Files tree highlights accordingly.
  const visiblePaths = useMemo(() => {
    const s = new Set<string>();
    if (layout === null || source === undefined) return s;
    if (isPanelVisible(layout, 'cvox')) s.add(source.cvoxFile.name);
    if (
      source.kind === 'folder' &&
      source.manifestFile !== undefined &&
      isPanelVisible(layout, 'manifest')
    ) {
      s.add(source.manifestFile.name);
    }
    if (source.kind === 'folder' && source.files !== undefined) {
      for (const path of source.files.keys()) {
        if (isPanelVisible(layout, filePanel(path))) s.add(path);
      }
    }
    return s;
  }, [layout, source]);
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
      case 'preview':
        return {
          title,
          fill: true,
          body: (
            <>
              {/* Panel-local toolbar: the view-mode switch belongs to the
                  Preview panel, so it floats over the 3D's top-right rather
                  than the global header (panel-system design A2). */}
              <div className="view-mode-overlay">
                <ViewModeToggle
                  mode={effectiveViewMode}
                  rigAvailable={rigAvailable}
                  animAvailable={animAvailable}
                  onChange={handleViewModeChange}
                />
              </div>
              {effectiveViewMode === 'anim' &&
              source.kind === 'folder' &&
              source.manifest !== undefined ? (
                <AnimationViewport
                  cvox={renderCvox ?? source.cvox}
                  manifest={source.manifest}
                  hiddenParts={hiddenParts}
                  session={animSession}
                  manifestEditsDisabled={manifestParseError !== null}
                  onCreateClip={handleCreateAnimationClip}
                />
              ) : (
                <VoxelScene
                  cvox={renderCvox ?? source.cvox}
                  manifest={source.kind === 'folder' ? source.manifest : undefined}
                  viewMode={effectiveViewMode}
                  hiddenParts={hiddenParts}
                />
              )}
            </>
          ),
        };
      case 'timeline':
        return {
          title,
          fill: true,
          body: (
            <TimelinePanel
              session={animSession}
              manifest={manifest}
              hasManifest={manifest !== undefined}
              manifestEditsDisabled={manifestParseError !== null}
              onSetAnimField={handleSetAnimField}
              onDeleteAnimKey={handleDeleteAnimKey}
              onTrimClip={handleTrimClip}
              onSetClipDuration={handleSetClipDuration}
              onSetClipLoop={handleSetClipLoop}
              onCreateClip={handleCreateAnimationClip}
              onRenameClip={handleRenameClip}
              onDeleteClip={handleDeleteClip}
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
                  + Create manifest
                </button>
              </div>
            ),
        };
      case 'files':
        return {
          title,
          body: (
            <FileTree
              source={source}
              activePaths={visiblePaths}
              fileErrors={treeFileErrors}
              onOpenPath={handleOpenPath}
              onCreateManifest={handleCreateManifest}
              onCreateFile={handleCreateFile}
              onRenameFile={handleRenameFile}
              onDeleteFile={handleDeleteFile}
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
        return {
          title: 'Parts',
          body: (
            <>
              <div className="parts-toolbar">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={cvoxParseError !== null}
                  title={
                    cvoxParseError !== null
                      ? 'Fix cvox syntax errors to add parts'
                      : 'New part (child of the selected part)'
                  }
                  onClick={handleStartCreatePart}
                >
                  + New part
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleShowAll}
                  disabled={hiddenParts.size === 0}
                >
                  Show all
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleHideAll}
                  disabled={visibleCount === 0}
                >
                  Hide all
                </button>
              </div>
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
                onConfirmCreate={(name) =>
                  handleConfirmCreatePart(name, creating?.parent ?? null)
                }
                onCancelCreate={handleCancelCreatePart}
                onRenamePart={handleRenamePart}
              />
            </>
          ),
        };
      }
      case 'properties':
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
                onChangeParent={handleChangePartParent}
                onChangePosition={handleChangePartPosition}
                onRenamePart={handleRenamePart}
                onDeletePart={handleDeletePart}
                onCreateManifest={handleCreateManifest}
              />
            ) : (
              <p className="panel-empty">
                Select a part to edit its properties.
              </p>
            ),
        };
      case 'palette':
        return {
          title: 'Palette',
          body: (
            <PalettePanel
              cvox={source.cvox}
              disabled={cvoxParseError !== null}
              onChange={handleEditCvox}
            />
          ),
        };
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
        <h1>Cuboidy Editor</h1>
        <div className="header-right">
          {source !== undefined && (
            <>
              <button
                type="button"
                className="btn"
                disabled={history.past.length === 0}
                title="Undo (Ctrl+Z)"
                onClick={performUndo}
              >
                Undo
              </button>
              <button
                type="button"
                className="btn"
                disabled={history.future.length === 0}
                title="Redo (Ctrl+Shift+Z)"
                onClick={performRedo}
              >
                Redo
              </button>
            </>
          )}
          {source?.kind === 'folder' && <SaveButton source={source} />}
          {source !== undefined && <ExportMenu source={source} />}
          {source !== undefined && (
            <button
              type="button"
              className="btn"
              title="Reset the panel layout to the default"
              onClick={handleResetLayout}
            >
              Reset layout
            </button>
          )}
          {loaded !== null && (
            <button type="button" className="btn" onClick={handleReset}>
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
                  + {p.title}
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
