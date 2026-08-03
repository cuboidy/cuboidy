import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clampRetime, clampToClip, formatTimeKey, isInlineAnimation, nearestExistingKey, restValue, sampleAnimation, type AttrValue, type Geometry, type InlineAnimation, type KeyAttr, type Keyframe, type Manifest, type Pose } from '@cuboidy/core';

import { SNAP_STEP } from './timeline-snap.js';
import type { SelectedKey } from '@cuboidy/ui';

// The animation editing "session": the shared playback + selection state that
// drives BOTH the Preview viewport (poses the rig at `time`) and the Timeline
// panel (playhead + lane editing). It used to live privately inside
// AnimationView; lifting it into a hook that App owns lets the two surfaces be
// separate dock panels reading the same state.
// A copied keyframe: the sparse entry snapshot plus where it came from (for
// the paste button's tooltip). Entries are immutable transforms, so holding
// the reference is a true snapshot — later edits can't mutate it.
export interface KeyClipboard {
  kf: Keyframe;
  part: string;
  timeKey: string;
}

// The clipboard's attribute order, for choosing which lane to select after a
// paste when the current selection's attribute wasn't part of the copy.
const CLIP_ATTRS: readonly KeyAttr[] = ['rot', 'pos', 'scale', 'visible'];

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
  effectiveSelectedKey: SelectedKey | null;
  overrunCount: number;
  partNames: string[];
  // Keyframe clipboard (Ctrl+C / Ctrl+V and the inspector buttons).
  keyClipboard: KeyClipboard | null;
  // Commands.
  setSelectedClip: (name: string) => void;
  setPlaying: (next: boolean | ((p: boolean) => boolean)) => void;
  setSelectedKey: (k: SelectedKey | null) => void;
  scrub: (t: number) => void;
  selectKey: (k: SelectedKey) => void;
  addKey: (part: string, attr: KeyAttr) => void;
  moveKey: (part: string, attr: KeyAttr, fromTimeKey: string, toTime: number) => void;
  retimeKey: (part: string, attr: KeyAttr, fromTimeKey: string, toTime: number) => void;
  clearPart: (part: string) => void;
  // Copy the selected key's whole time-key entry (all attributes + ease).
  copySelectedKey: () => void;
  // Merge the clipboard into the selected key's PART at the playhead time.
  pasteAtPlayhead: () => void;
}

interface Params {
  geometry: Geometry | undefined;
  manifest: Manifest | undefined;
  // The preview is showing the anim viewport. Gates the rAF clock and the
  // Space play/pause key (the transport lives in that viewport).
  clockEnabled: boolean;
  // The Timeline panel is visible. Gates the lane-editing keys (Delete /
  // arrows) so they only fire when the timeline (and its selection) is on
  // screen.
  editKeysEnabled: boolean;
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
  onPasteAnimKeyframe: (
    animName: string,
    part: string,
    time: number,
    kf: Keyframe,
  ) => void;
}

export function useAnimationSession({
  geometry,
  manifest,
  clockEnabled,
  editKeysEnabled,
  onAddAnimKey,
  onDeleteAnimKey,
  onMoveAnimKey,
  onClearPartTrack,
  onPasteAnimKeyframe,
}: Params): AnimationSession {
  // Memoized because the `?? {}` default is a fresh object each render —
  // as a raw dependency it would make every memo below it recompute.
  const animations = useMemo(() => manifest?.animations ?? {}, [manifest]);
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
  const loop = inline?.loop ?? true;

  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
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

  // rAF clock: advance `time`. A looping clip wraps at duration; a
  // non-looping one clamps there (SPEC §6.7 — values hold at the end).
  // Paused when `playing` is false, while scrubbing/editing, or when the
  // anim viewport is off screen (`clockEnabled` is false).
  useEffect(() => {
    if (!playing || duration <= 0 || !clockEnabled) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (ts: number) => {
      if (last !== null) {
        const dt = (ts - last) / 1000;
        setTime((prev) => clampToClip(prev + dt, duration, loop));
      }
      last = ts;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, clockEnabled, loop]);

  // A non-looping clip stops the transport when the playhead reaches the
  // end — previously the clock wrapped unconditionally, which made
  // `loop: false` clips visually indistinguishable from looping ones
  // (the core sampler's §6.7 clamp never saw a time past duration).
  useEffect(() => {
    if (!loop && playing && duration > 0 && time >= duration) {
      setPlaying(false);
    }
  }, [loop, playing, duration, time]);

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
  const playingRef = useRef(playing);
  timeRef.current = time;
  posesRef.current = poses;
  inlineRef.current = inline;
  activeNameRef.current = activeName;
  playingRef.current = playing;

  const partNames = useMemo(
    () => (geometry ? geometry.parts.map((p) => p.name) : []),
    [geometry],
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

  // Play/pause with §6.7-aware resume: pressing play on a FINISHED
  // non-loop clip restarts it from 0 — the playhead holds at duration,
  // so a bare "play" would stop again on the very next frame. Reads the
  // latest values through refs, so the callback stays identity-stable
  // (it feeds the Space shortcut's keydown effect).
  const requestPlaying = useCallback(
    (next: boolean | ((p: boolean) => boolean)) => {
      const prev = playingRef.current;
      const value = typeof next === 'function' ? next(prev) : next;
      const anim = inlineRef.current;
      if (
        value &&
        !prev &&
        anim !== undefined &&
        !anim.loop &&
        anim.duration > 0 &&
        timeRef.current >= anim.duration
      ) {
        setTime(0);
      }
      setPlaying(value);
    },
    [],
  );

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

  // Retime via the inspector's numeric time field, through core's
  // clampRetime — the same neighbor/duration rule the marker drag
  // applies, so the two surfaces cannot disagree about whether a move
  // is legal.
  const retimeKey = useCallback(
    (part: string, attr: KeyAttr, fromTimeKey: string, toTime: number) => {
      const clamped = clampRetime(
        inlineRef.current?.parts[part],
        attr,
        fromTimeKey,
        toTime,
        inlineRef.current?.duration ?? 0,
      );
      if (clamped === null) return;
      moveKey(part, attr, fromTimeKey, clamped);
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

  // Keyframe clipboard. State (not just a ref) so the inspector's Paste
  // button enables the moment something is copied; the ref mirror feeds the
  // keyboard handler without re-installing it.
  const [keyClipboard, setKeyClipboard] = useState<KeyClipboard | null>(null);
  const keyClipboardRef = useRef(keyClipboard);
  keyClipboardRef.current = keyClipboard;

  // Copy the selected key's whole time-key entry — every attribute present
  // at that time plus its explicit ease, i.e. exactly what serializes.
  const copySelectedKey = useCallback(() => {
    const sel = selectedKeyRef.current;
    if (sel === null) return;
    const entry = inlineRef.current?.parts[sel.part]?.[sel.timeKey];
    if (entry === undefined) return;
    setKeyClipboard({ kf: entry, part: sel.part, timeKey: sel.timeKey });
  }, []);

  // Paste = field-wise merge at the playhead on the SELECTED key's part (the
  // selection is the paste target: copy from one part, select a key on
  // another, paste → cross-part transplant). Selects the pasted key like
  // addKey — preferring the currently selected attribute when it was copied.
  const pasteAtPlayhead = useCallback(() => {
    const clip = keyClipboardRef.current;
    const sel = selectedKeyRef.current;
    if (clip === null || sel === null) return;
    const t = timeRef.current;
    onPasteAnimKeyframe(activeNameRef.current, sel.part, t, clip.kf);
    const track = inlineRef.current?.parts[sel.part] ?? {};
    const timeKey = nearestExistingKey(track, t) ?? formatTimeKey(t);
    const attr =
      sel.attr in clip.kf ? sel.attr : CLIP_ATTRS.find((a) => a in clip.kf);
    if (attr !== undefined) setSelectedKey({ part: sel.part, attr, timeKey });
    setPlaying(false);
  }, [onPasteAnimKeyframe]);

  // Timeline keyboard shortcuts:
  //   Space             play / pause      (while the anim viewport is shown)
  //   Delete/Backspace  remove the selected key   (while the timeline is shown)
  //   ← / →             nudge the selected key one snap step (Alt = fine 1e-3)
  //   Ctrl/Cmd+C / +V   copy the selected keyframe / paste it at the playhead
  // Guarded for IME and text fields (before the modifier branch, so native
  // copy/paste in inputs is never hijacked); other Ctrl/Meta combos are left
  // alone (global undo/redo, browser). Space is skipped when a button is
  // focused so it doesn't double-fire.
  useEffect(() => {
    if (!clockEnabled && !editKeysEnabled) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing || e.keyCode === 229) return;
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(
          'textarea, input, select, [contenteditable=""], [contenteditable="true"]',
        ) !== null
      ) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (!e.altKey && !e.shiftKey && editKeysEnabled) {
          if (e.key === 'c' && selectedKeyRef.current !== null) {
            e.preventDefault();
            copySelectedKey();
            return;
          }
          if (
            e.key === 'v' &&
            selectedKeyRef.current !== null &&
            keyClipboardRef.current !== null
          ) {
            e.preventDefault();
            pasteAtPlayhead();
            return;
          }
        }
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        if (target instanceof Element && target.closest('button') !== null) return;
        if (!clockEnabled || !hasTimeline) return;
        e.preventDefault();
        requestPlaying((p) => !p);
        return;
      }

      // Key delete / nudge act on the selected marker — only while the timeline
      // is on screen (a selection can linger in state, but with no visible
      // marker acting on it would be surprising).
      if (!editKeysEnabled) return;
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
  }, [
    clockEnabled,
    editKeysEnabled,
    hasTimeline,
    onDeleteAnimKey,
    retimeKey,
    copySelectedKey,
    pasteAtPlayhead,
    requestPlaying,
  ]);

  return {
    activeName,
    inlineNames,
    inline,
    duration,
    hasTimeline,
    playing,
    time,
    poses,
    effectiveSelectedKey,
    overrunCount,
    partNames,
    keyClipboard,
    setSelectedClip: setSelected,
    setPlaying: requestPlaying,
    setSelectedKey,
    scrub,
    selectKey,
    addKey,
    moveKey,
    retimeKey,
    clearPart,
    copySelectedKey,
    pasteAtPlayhead,
  };
}
