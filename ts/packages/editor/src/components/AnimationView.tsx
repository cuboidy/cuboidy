import { useEffect, useMemo, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import {
  isInlineAnimation,
  sampleAnimation,
  type Cvox,
  type Manifest,
  type Pose,
} from '@cuboidy/core';
import {
  buildRigTree,
  computeSceneCenter,
  computeSceneSpan,
} from '../lib/rig.js';
import { RiggedParts } from './RiggedParts.js';

interface Props {
  cvox: Cvox;
  manifest: Manifest;
  hiddenParts: ReadonlySet<string>;
}

// View-only animation playback (memory: "playback preview only" phase — no
// loop / speed controls; those belong to the eventual keyframe editor).
// Surfaces play/pause + a scrub bar; loops automatically. When the model
// defines several animations, a selector picks the active one.
//
// The 3D rest pose framing (camera target / radius) is computed once from the
// manifest positions so the camera holds steady while parts move.
export function AnimationView({ cvox, manifest, hiddenParts }: Props) {
  const animations = manifest.animations ?? {};
  // Only inline animations are previewable today; string refs (external
  // anims/*.json, SPEC §8) are carried in the manifest but not yet loaded.
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
  // A degenerate clip (duration ≤ 0 — a hand-edited/invalid manifest) has no
  // timeline to scrub or play; the model just holds its t=0 pose.
  const hasTimeline = duration > 0;

  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);

  // Restart from the head whenever the active clip changes.
  useEffect(() => {
    setTime(0);
  }, [activeName]);

  // Re-sync the selection if the available clips changed under it (e.g. the
  // user edited the manifest source and removed the selected animation), so
  // `selected` never drifts out of the valid set.
  useEffect(() => {
    if (!inlineNames.includes(selected)) setSelected(inlineNames[0] ?? '');
  }, [inlineNames, selected]);

  // rAF clock: advance `time`, wrapping at duration (auto-loop). Paused when
  // `playing` is false or while the user scrubs.
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

  if (inline === undefined) {
    return (
      <div className="anim-view">
        <div className="anim-empty">
          This model has no inline animation to preview.
        </div>
      </div>
    );
  }

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
      </div>
    </div>
  );
}
