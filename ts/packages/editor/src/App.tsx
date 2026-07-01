import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  addAttrAtTime,
  deleteAttrAtKey,
  isIdentifier,
  moveAttrKey,
  parseCvox,
  parseManifest,
  serializeCvox,
  setAttrAtKey,
  trimTrackKeys,
  type AttrValue,
  type Cvox,
  type InlineAnimation,
  type KeyAttr,
  type Manifest,
  type ManifestPart,
} from '@cuboidy/core';
import { AnimationViewport } from './components/AnimationViewport.js';
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
import {
  addPanelAt,
  closePanelAt,
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
import type { LoadResult, LoadedSource, ViewMode } from './lib/types.js';

// Debounce window for live re-parse of the cvox source view. Long
// enough that mid-keystroke typing doesn't constantly fire (and
// flicker palette/3D between transient invalid states); short enough
// that a deliberate pause feels live.
const REPARSE_DEBOUNCE_MS = 300;

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
      dispatch({ type: 'replace', next: result });
      setHiddenParts(new Set());
      setSelectedPartName(null);
      setCvoxParseError(null);
      setManifestParseError(null);
      const hasManifest =
        result.source !== undefined &&
        result.source.kind === 'folder' &&
        result.source.manifest !== undefined;
      setViewMode(hasManifest ? 'rig' : 'cvox');
      setLayout((l) => openPanelById(l, 'preview'));
    },
    [cancelPendingCvoxReparse, cancelPendingManifestReparse],
  );

  const handleReset = useCallback(() => {
    cancelPendingCvoxReparse();
    cancelPendingManifestReparse();
    dispatch({ type: 'replace', next: null });
    setHiddenParts(new Set());
    setSelectedPartName(null);
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
      setHiddenParts(new Set(loaded.source.cvox.parts.map((p) => p.name)));
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
        const nextText = serializeCvox(nextCvox);
        return {
          ...current,
          source: {
            ...src,
            cvox: nextCvox,
            cvoxFile: { ...src.cvoxFile, text: nextText },
          },
        };
      });
    },
    [dispatchEdit, cancelPendingCvoxReparse],
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

  // Prune a selection that points at a part the cvox no longer
  // contains (e.g., user edited the source view to remove it). Done
  // at render time rather than via effect so downstream components
  // never see the dangling name even for one frame.
  const effectiveSelectedPart = useMemo(() => {
    if (selectedPartName === null || source === undefined) return null;
    return source.cvox.parts.some((p) => p.name === selectedPartName)
      ? selectedPartName
      : null;
  }, [selectedPartName, source]);

  const animManifest = source?.kind === 'folder' ? source.manifest : undefined;

  // Dock layout tree (resizable, rearrangeable). In-memory only — layout is
  // session-scoped by design (no persistence); "Reset layout" restores it.
  // Null = every panel closed (empty dock); App renders an add-panel state.
  const [layout, setLayout] = useState<LayoutNode | null>(initialLayout);

  // Display title for any panel. Static for tool panels; the source files take
  // their actual file name so the dock tab reads "voxels.cvox" / "cuboidy.json"
  // (matching the file tree). Used for both tab labels and the + menu.
  const panelTitle = useCallback(
    (id: LeafId): string => {
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
        case 'cvox':
          return source?.cvoxFile.name ?? 'voxels.cvox';
        case 'manifest':
          return (
            (source?.kind === 'folder' ? source.manifestFile?.name : undefined) ??
            'cuboidy.json'
          );
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
  // Click a file in the tree → bring its source panel forward (re-opening it
  // if it was closed).
  const handleOpenFile = useCallback((file: 'cvox' | 'manifest') => {
    setLayout((l) => openPanelById(l, file));
  }, []);
  // Which source files are currently visible (active tab of their leaf) — the
  // file tree highlights accordingly. Once panelized, cvox and manifest can be
  // docked apart and shown at once, so this is a set.
  const visibleSourceFiles = useMemo(() => {
    const s = new Set<'cvox' | 'manifest'>();
    if (layout !== null && isPanelVisible(layout, 'cvox')) s.add('cvox');
    if (layout !== null && isPanelVisible(layout, 'manifest')) s.add('manifest');
    return s;
  }, [layout]);

  // Shared animation session (active clip, playback time, selected key). Owned
  // here so the Preview viewport and the Timeline panel are separate dock
  // panels reading the same state. The clock/Space follow the anim viewport;
  // the lane-editing keys follow the Timeline panel's visibility.
  const animSession = useAnimationSession({
    cvox: source?.cvox,
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
                  cvox={source.cvox}
                  manifest={source.manifest}
                  hiddenParts={hiddenParts}
                  session={animSession}
                  manifestEditsDisabled={manifestParseError !== null}
                  onCreateClip={handleCreateAnimationClip}
                />
              ) : (
                <VoxelScene
                  cvox={source.cvox}
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
                  className="create-manifest"
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
              activeFiles={visibleSourceFiles}
              cvoxError={cvoxParseError ?? undefined}
              manifestError={
                manifestParseError ??
                (source.kind === 'folder' ? source.manifestError : undefined)
              }
              onOpenFile={handleOpenFile}
              onCreateManifest={handleCreateManifest}
            />
          ),
        };
      case 'parts': {
        const visibleCount = source.cvox.parts.length - hiddenParts.size;
        return {
          title: 'Parts',
          body: (
            <>
              <div className="sidebar-actions">
                <button
                  type="button"
                  onClick={handleShowAll}
                  disabled={hiddenParts.size === 0}
                >
                  Show all
                </button>
                <button
                  type="button"
                  onClick={handleHideAll}
                  disabled={visibleCount === 0}
                >
                  Hide all
                </button>
              </div>
              <PartTree
                parts={source.cvox.parts}
                manifest={manifest}
                hiddenParts={hiddenParts}
                selectedPart={effectiveSelectedPart}
                dndEnabled={manifest !== undefined}
                onToggleVisibility={handleToggle}
                onSelectPart={setSelectedPartName}
                onChangeParent={handleChangePartParent}
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
                cvox={source.cvox}
                manifest={manifest}
                manifestEditsDisabled={manifestParseError !== null}
                onChangeParent={handleChangePartParent}
                onChangePosition={handleChangePartPosition}
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
    }
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
                className="history-btn"
                disabled={history.past.length === 0}
                title="Undo (Ctrl+Z)"
                onClick={performUndo}
              >
                Undo
              </button>
              <button
                type="button"
                className="history-btn"
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
              className="history-btn"
              title="Reset the panel layout to the default"
              onClick={handleResetLayout}
            >
              Reset layout
            </button>
          )}
          {loaded !== null && (
            <button type="button" className="reset" onClick={handleReset}>
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
                  className="dock-empty-add"
                  onClick={() => handleReopenPanel(p.id)}
                >
                  + {p.title}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="history-btn"
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
      {loaded !== null && <Notices loaded={loaded} />}
    </div>
  );
}

function Notices({ loaded }: { loaded: LoadResult }) {
  return (
    <aside className="notices">
      {loaded.error !== undefined && (
        <div className="notice error">
          <strong>Syntax error:</strong> {loaded.error}
        </div>
      )}
      {loaded.source?.kind === 'folder' &&
        loaded.source.manifestError !== undefined && (
          <div className="notice error">
            <strong>
              Manifest syntax error ({loaded.source.manifestFile?.name}):
            </strong>{' '}
            {loaded.source.manifestError}
          </div>
        )}
      {loaded.source !== undefined && loaded.source.droppedInlineComments > 0 && (
        <div className="notice warning">
          <strong>
            {loaded.source.droppedInlineComments} inline comment(s) will not be preserved.
          </strong>{' '}
          Only file-header comments (consecutive <code>//</code> lines before
          the first declaration) round-trip through the editor.
        </div>
      )}
    </aside>
  );
}
