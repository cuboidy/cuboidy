import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import {
  formatTimeKey,
  isInlineAnimation,
  nearestExistingKey,
  restValue,
  sampleAnimation,
  type AttrValue,
  type Cvox,
  type KeyAttr,
  type Manifest,
  type Pose,
} from '@cuboidy/core';
import {
  buildRigTree,
  computeSceneCenter,
  computeSceneSpan,
} from '../lib/rig.js';
import type { SelectedKey } from '../lib/types.js';
import { KeyInspector } from './KeyInspector.js';
import { NumberInput } from './NumberInput.js';
import { RiggedParts } from './RiggedParts.js';
import { Timeline } from './Timeline.js';

interface Props {
  cvox: Cvox;
  manifest: Manifest;
  hiddenParts: ReadonlySet<string>;
  // Disabled while the manifest source tab has parse errors — a structural
  // edit here would re-serialize from a stale AST.
  manifestEditsDisabled: boolean;
  onSetAnimField: (
    animName: string,
    part: string,
    timeKey: string,
    attr: KeyAttr,
    value: AttrValue,
  ) => void;
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
  onSetClipDuration: (animName: string, duration: number) => void;
  onSetClipLoop: (animName: string, loop: boolean) => void;
  onCreateClip: () => void;
}

// Animation playback + keyframe editor. Play/pause + scrub drive a shared
// `time`; Edit mode reveals a per-attribute timeline (one row per part, lanes
// for rot/pos/scale/visible) and an inspector for the selected key. Editing a
// value flows back to the manifest and the 3D updates live (poses re-sample
// from the edited animation). The rest-pose camera framing holds steady.
export function AnimationView({
  cvox,
  manifest,
  hiddenParts,
  manifestEditsDisabled,
  onSetAnimField,
  onAddAnimKey,
  onDeleteAnimKey,
  onSetClipDuration,
  onSetClipLoop,
  onCreateClip,
}: Props) {
  const animations = manifest.animations ?? {};
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
  // `playing` is false or while scrubbing/editing.
  useEffect(() => {
    if (!playing || duration <= 0) return;
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
  }, [playing, duration]);

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

  const partNames = useMemo(() => cvox.parts.map((p) => p.name), [cvox]);

  const roots = useMemo(() => buildRigTree(cvox, manifest), [cvox, manifest]);
  const center = useMemo<[number, number, number]>(
    () => computeSceneCenter(cvox, manifest, 'rig'),
    [cvox, manifest],
  );
  const radius = useMemo(() => {
    const span = computeSceneSpan(cvox, manifest, 'rig');
    return Math.max(span.w, span.h, span.d) * 1.8;
  }, [cvox, manifest]);
  const gridSize = useMemo(() => {
    const raw = Math.max(
      20,
      Math.ceil(Math.max(...cvox.parts.map((p) => Math.max(p.size.w, p.size.d)))) +
        4,
    );
    return raw + (raw % 2);
  }, [cvox]);

  // Scrubbing / selecting pauses playback. onAddKey is stable (reads refs) so
  // the memoized timeline isn't re-created each frame.
  const handleScrub = useCallback((t: number) => {
    setPlaying(false);
    setTime(t);
  }, []);

  const handleSelectKey = useCallback((k: SelectedKey) => {
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

  const handleAddKey = useCallback(
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

  // Prune a stale selection (the key may have been deleted/edited away or the
  // clip swapped). Done at render so the inspector never sees a dangling key.
  const effectiveSelectedKey = useMemo<SelectedKey | null>(() => {
    if (selectedKey === null || inline === undefined) return null;
    const kf = inline.parts[selectedKey.part]?.[selectedKey.timeKey];
    if (kf === undefined || !(selectedKey.attr in kf)) return null;
    return selectedKey;
  }, [selectedKey, inline]);

  if (inline === undefined) {
    return (
      <div className="anim-view">
        <div className="anim-empty">
          <p>This model has no animations yet.</p>
          <button
            type="button"
            className="anim-create"
            disabled={manifestEditsDisabled}
            onClick={onCreateClip}
          >
            + Create animation
          </button>
        </div>
      </div>
    );
  }

  const selectedKeyframe =
    effectiveSelectedKey !== null
      ? inline.parts[effectiveSelectedKey.part]?.[effectiveSelectedKey.timeKey]
      : undefined;

  return (
    <div className="anim-view">
      <div className="anim-canvas">
        <Canvas camera={{ position: [radius, radius, radius], fov: 50 }} shadows={false}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[10, 20, 10]} intensity={1.0} />
          <gridHelper
            args={[gridSize, gridSize]}
            position={[gridSize / 2, 0, gridSize / 2]}
          />
          <RiggedParts
            roots={roots}
            palette={cvox.palette}
            poses={poses}
            hiddenParts={hiddenParts}
          />
          <OrbitControls target={center} makeDefault />
        </Canvas>
      </div>

      {editMode && (
        <div className="anim-edit">
          <div className="anim-edit-toolbar">
            <label className="anim-edit-field">
              <span>duration</span>
              <NumberInput
                value={duration}
                disabled={manifestEditsDisabled}
                onChange={(n) => onSetClipDuration(activeName, n)}
              />
            </label>
            <label className="anim-edit-loop">
              <input
                type="checkbox"
                checked={inline.loop}
                disabled={manifestEditsDisabled}
                onChange={(e) => onSetClipLoop(activeName, e.target.checked)}
              />
              <span>loop</span>
            </label>
            <button
              type="button"
              className="anim-create-inline"
              disabled={manifestEditsDisabled}
              onClick={onCreateClip}
            >
              + New clip
            </button>
          </div>
          <div className="anim-edit-main">
            <Timeline
              partNames={partNames}
              inline={inline}
              time={time}
              selectedKey={effectiveSelectedKey}
              disabled={manifestEditsDisabled}
              onScrub={handleScrub}
              onSelectKey={handleSelectKey}
              onAddKey={handleAddKey}
            />
            {effectiveSelectedKey !== null && selectedKeyframe !== undefined && (
              <KeyInspector
                selectedKey={effectiveSelectedKey}
                keyframe={selectedKeyframe}
                disabled={manifestEditsDisabled}
                onSetField={(value) =>
                  onSetAnimField(
                    activeName,
                    effectiveSelectedKey.part,
                    effectiveSelectedKey.timeKey,
                    effectiveSelectedKey.attr,
                    value,
                  )
                }
                onDelete={() => {
                  onDeleteAnimKey(
                    activeName,
                    effectiveSelectedKey.part,
                    effectiveSelectedKey.timeKey,
                    effectiveSelectedKey.attr,
                  );
                  setSelectedKey(null);
                }}
              />
            )}
          </div>
        </div>
      )}

      <div className="anim-controls">
        <button
          type="button"
          className="anim-play"
          aria-label={playing ? 'Pause' : 'Play'}
          disabled={!hasTimeline}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          className="anim-scrub"
          min={0}
          max={hasTimeline ? duration : 1}
          step={hasTimeline ? Math.max(duration / 200, 0.001) : 0.001}
          value={hasTimeline ? Math.min(time, duration) : 0}
          disabled={!hasTimeline}
          aria-label="Scrub timeline"
          onChange={(e) => {
            setPlaying(false);
            setTime(Number(e.target.value));
          }}
        />
        <span className="anim-time">
          {(hasTimeline ? time : 0).toFixed(2)} / {duration.toFixed(2)}s
        </span>
        {inlineNames.length > 1 ? (
          <select
            className="anim-select"
            value={activeName}
            aria-label="Animation"
            onChange={(e) => setSelected(e.target.value)}
          >
            {inlineNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <span className="anim-name">{activeName}</span>
        )}
        <button
          type="button"
          className={`anim-edit-toggle${editMode ? ' active' : ''}`}
          aria-pressed={editMode}
          onClick={() => setEditMode((v) => !v)}
        >
          Edit
        </button>
      </div>
    </div>
  );
}
