import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatTimeKey,
  isInlineAnimation,
  nearestExistingKey,
  restValue,
  sampleAnimation,
  type AttrValue,
  type Cvox,
  type InlineAnimation,
  type KeyAttr,
  type Manifest,
  type Pose,
} from '@cuboidy/core';
import type { SelectedKey } from './types.js';
import { SNAP_STEP } from '../components/Timeline.js';

// The animation editing "session": the shared playback + selection state that
// drives BOTH the Preview viewport (poses the rig at `time`) and the Timeline
// panel (playhead + lane editing). It used to live privately inside
// AnimationView; lifting it into a hook that App owns lets the two surfaces be
// separate dock panels reading the same state (panel-system design §4).
export interface AnimationSession {
  // Active inline clip.
  activeName: string;
  inlineNames: string[];
  inline: InlineAnimation | undefined;
  duration: number;
  hasTimeline: boolean;
  // Playback.
  playing: boolean;
  time: number;
  poses: Map<string, Pose> | null;
  // Editing.
  editMode: boolean;
  effectiveSelectedKey: SelectedKey | null;
  overrunCount: number;
  partNames: string[];
  // Commands.
  setSelectedClip: (name: string) => void;
  setPlaying: (next: boolean | ((p: boolean) => boolean)) => void;
  setEditMode: (next: boolean | ((b: boolean) => boolean)) => void;
  setSelectedKey: (k: SelectedKey | null) => void;
  scrub: (t: number) => void;
  selectKey: (k: SelectedKey) => void;
  addKey: (part: string, attr: KeyAttr) => void;
  moveKey: (part: string, attr: KeyAttr, fromTimeKey: string, toTime: number) => void;
  retimeKey: (part: string, attr: KeyAttr, fromTimeKey: string, toTime: number) => void;
  clearPart: (part: string) => void;
}

interface Params {
  cvox: Cvox | undefined;
  manifest: Manifest | undefined;
  // The anim viewport is actually on screen. Gates the rAF clock and the
  // timeline keyboard shortcuts so a backgrounded session doesn't tick or
  // steal keys (matches the old "AnimationView is mounted" condition).
  enabled: boolean;
  onAddAnimKey: (
    animName: string,
    part: string,
    time: number,
    attr: KeyAttr,
    value: AttrValue,
  ) => void;
  onDeleteAnimKey: (
    animName: string,
    part: string,
    timeKey: string,
    attr: KeyAttr,
  ) => void;
  onMoveAnimKey: (
    animName: string,
    part: string,
    fromTimeKey: string,
    toTime: number,
    attr: KeyAttr,
  ) => void;
  onClearPartTrack: (animName: string, part: string) => void;
}

export function useAnimationSession({
  cvox,
  manifest,
  enabled,
  onAddAnimKey,
  onDeleteAnimKey,
  onMoveAnimKey,
  onClearPartTrack,
}: Params): AnimationSession {
  const animations = manifest?.animations ?? {};
  const inlineNames = useMemo(
    () =>
      Object.keys(animations).filter((n) => {
        const a = animations[n];
        return a !== undefined && isInlineAnimation(a);
      }),
    [animations],
  );

  const [selected, setSelected] = useState<string>(inlineNames[0] ?? '');
  const activeName = inlineNames.includes(selected)
    ? selected
    : (inlineNames[0] ?? '');

  const active = animations[activeName];
  const inline =
    active !== undefined && isInlineAnimation(active) ? active : undefined;
  const duration = inline?.duration ?? 0;
  const hasTimeline = duration > 0;

  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [selectedKey, setSelectedKey] = useState<SelectedKey | null>(null);

  // Restart and drop any key selection whenever the active clip changes.
  useEffect(() => {
    setTime(0);
    setSelectedKey(null);
  }, [activeName]);

  // Re-sync the clip selection if the available clips changed under it.
  useEffect(() => {
    if (!inlineNames.includes(selected)) setSelected(inlineNames[0] ?? '');
  }, [inlineNames, selected]);

  // rAF clock: advance `time`, wrapping at duration (auto-loop). Paused when
  // `playing` is false, while scrubbing/editing, or when the viewport is off
  // screen (`enabled` is false).
  useEffect(() => {
    if (!playing || duration <= 0 || !enabled) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (ts: number) => {
      if (last !== null) {
        const dt = (ts - last) / 1000;
        setTime((prev) => {
          const next = prev + dt;
          return next - Math.floor(next / duration) * duration;
        });
      }
      last = ts;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, enabled]);

  const poses = useMemo<Map<string, Pose> | null>(
    () => (inline ? sampleAnimation(inline, time) : null),
    [inline, time],
  );

  // Latest-value refs so the stable add-key callback can read the current
  // playhead / pose / clip without re-binding every frame (which would defeat
  // the timeline's memoization during playback).
  const timeRef = useRef(time);
  const posesRef = useRef(poses);
  const inlineRef = useRef(inline);
  const activeNameRef = useRef(activeName);
  timeRef.current = time;
  posesRef.current = poses;
  inlineRef.current = inline;
  activeNameRef.current = activeName;

  const partNames = useMemo(
    () => (cvox ? cvox.parts.map((p) => p.name) : []),
    [cvox],
  );

  // SPEC §6.6 lint: count whole time-key entries beyond the clip duration
  // (left behind when the user shortened it). Same predicate as
  // trimTrackKeys, so the Trim action provably zeroes this. Depends only on
  // the clip data — never recomputed by playback frames.
  const overrunCount = useMemo(() => {
    if (inline === undefined) return 0;
    let n = 0;
    for (const track of Object.values(inline.parts)) {
      for (const k of Object.keys(track)) {
        if (Number(k) > inline.duration) n += 1;
      }
    }
    return n;
  }, [inline]);

  // Scrubbing / selecting pauses playback. addKey is stable (reads refs) so
  // the memoized timeline isn't re-created each frame.
  const scrub = useCallback((t: number) => {
    setPlaying(false);
    setTime(t);
  }, []);

  const selectKey = useCallback((k: SelectedKey) => {
    setPlaying(false);
    setSelectedKey(k);
    // Snap the playhead to the key so the 3D shows that key's pose (WYSIWYG),
    // clamped to the clip range so an out-of-range key (e.g. one left behind
    // after duration was shortened) can't push the internal time past
    // duration. Such keys stay selectable on purpose, so they can be fixed
    // or deleted.
    const t = Number(k.timeKey);
    const dur = inlineRef.current?.duration ?? 0;
    if (Number.isFinite(t)) setTime(dur > 0 ? Math.max(0, Math.min(t, dur)) : 0);
  }, []);

  const addKey = useCallback(
    (part: string, attr: KeyAttr) => {
      const t = timeRef.current;
      const pose = posesRef.current?.get(part);
      const value: AttrValue =
        attr === 'visible'
          ? (pose?.visible ?? true)
          : (pose?.[attr] ?? restValue(attr));
      const animName = activeNameRef.current;
      onAddAnimKey(animName, part, t, attr, value);
      // Resolve the resulting time-key (same logic the mutation uses) and
      // select the new marker.
      const track = inlineRef.current?.parts[part] ?? {};
      const timeKey = nearestExistingKey(track, t) ?? formatTimeKey(t);
      setSelectedKey({ part, attr, timeKey });
      setPlaying(false);
    },
    [onAddAnimKey],
  );

  // Commit a marker drag (retiming). Resolves the resulting time-key
  // optimistically — same pattern as addKey — so the moved key stays
  // selected, and parks the playhead at the new time.
  const moveKey = useCallback(
    (part: string, attr: KeyAttr, fromTimeKey: string, toTime: number) => {
      onMoveAnimKey(activeNameRef.current, part, fromTimeKey, toTime, attr);
      const track = inlineRef.current?.parts[part] ?? {};
      const timeKey = nearestExistingKey(track, toTime) ?? formatTimeKey(toTime);
      setSelectedKey({ part, attr, timeKey });
      const dur = inlineRef.current?.duration ?? 0;
      setTime(dur > 0 ? Math.max(0, Math.min(toTime, dur)) : 0);
      setPlaying(false);
    },
    [onMoveAnimKey],
  );

  // Retime via the inspector's numeric time field. Applies the same rules
  // as a marker drag: snap to the 1e-3 grid, stay one grid step clear of
  // same-attribute neighbors (no silent merge/crossing), clamp to the clip
  // range — then delegates to moveKey.
  const retimeKey = useCallback(
    (part: string, attr: KeyAttr, fromTimeKey: string, toTime: number) => {
      const track = inlineRef.current?.parts[part];
      const dur = inlineRef.current?.duration ?? 0;
      if (track === undefined || dur <= 0) return;
      const fromT = Number(fromTimeKey);
      const times = Object.keys(track)
        .filter((k) => attr in track[k]!)
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      const i = times.indexOf(fromT);
      const prev = i > 0 ? times[i - 1]! : null;
      const next = i >= 0 && i < times.length - 1 ? times[i + 1]! : null;
      const durGrid = Math.floor(dur * 1000) / 1000;
      const min = prev !== null ? Math.round((prev + 0.001) * 1000) / 1000 : 0;
      const max = Math.min(
        next !== null ? Math.round((next - 0.001) * 1000) / 1000 : durGrid,
        durGrid,
      );
      if (min > max) return;
      const snapped = Math.round(toTime * 1000) / 1000;
      moveKey(part, attr, fromTimeKey, Math.min(Math.max(snapped, min), max));
    },
    [moveKey],
  );

  // Clear a part's whole track in the active clip (timeline part-header ×).
  // Stable via the ref pattern so TimelineLanes' memo survives clip switches.
  const clearPart = useCallback(
    (part: string) => onClearPartTrack(activeNameRef.current, part),
    [onClearPartTrack],
  );

  // Prune a stale selection (the key may have been deleted/edited away or the
  // clip swapped). Done at render so the inspector never sees a dangling key.
  const effectiveSelectedKey = useMemo<SelectedKey | null>(() => {
    if (selectedKey === null || inline === undefined) return null;
    const kf = inline.parts[selectedKey.part]?.[selectedKey.timeKey];
    if (kf === undefined || !(selectedKey.attr in kf)) return null;
    return selectedKey;
  }, [selectedKey, inline]);

  // Mirror the pruned selection into a ref so the keyboard handler reads the
  // live value without re-installing the listener on every selection change.
  const selectedKeyRef = useRef(effectiveSelectedKey);
  selectedKeyRef.current = effectiveSelectedKey;

  // Timeline keyboard shortcuts (active while the anim viewport is shown):
  //   Space             play / pause
  //   Delete/Backspace  remove the selected key
  //   ← / →             nudge the selected key one snap step (Alt = fine 1e-3)
  // Guarded for IME and text fields; Ctrl/Meta combos are left alone. Space is
  // skipped when a button is focused so it doesn't double-fire.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.ctrlKey || e.metaKey) return;
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(
          'textarea, input, select, [contenteditable=""], [contenteditable="true"]',
        ) !== null
      ) {
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        if (target instanceof Element && target.closest('button') !== null) return;
        if (!hasTimeline) return;
        e.preventDefault();
        setPlaying((p) => !p);
        return;
      }

      // Key delete / nudge act on the selected marker — edit mode only (a
      // selection can linger in state after leaving edit mode, but there's no
      // marker on screen, so acting on it would be invisible/surprising).
      if (!editMode) return;
      const sel = selectedKeyRef.current;
      if (sel === null) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDeleteAnimKey(activeNameRef.current, sel.part, sel.timeKey, sel.attr);
        setSelectedKey(null);
        setPlaying(false);
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (sel.timeKey === formatTimeKey(0)) return; // start key is locked
        const fromT = Number(sel.timeKey);
        if (!Number.isFinite(fromT)) return;
        e.preventDefault();
        const step = e.altKey ? 0.001 : SNAP_STEP;
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        retimeKey(sel.part, sel.attr, sel.timeKey, fromT + dir * step);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, editMode, hasTimeline, onDeleteAnimKey, retimeKey]);

  return {
    activeName,
    inlineNames,
    inline,
    duration,
    hasTimeline,
    playing,
    time,
    poses,
    editMode,
    effectiveSelectedKey,
    overrunCount,
    partNames,
    setSelectedClip: setSelected,
    setPlaying,
    setEditMode,
    setSelectedKey,
    scrub,
    selectKey,
    addKey,
    moveKey,
    retimeKey,
    clearPart,
  };
}
