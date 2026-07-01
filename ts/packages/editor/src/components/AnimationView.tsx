import { useMemo } from 'react';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import {
  isIdentifier,
  type AttrValue,
  type Cvox,
  type KeyAttr,
  type Manifest,
} from '@cuboidy/core';
import {
  buildRigTree,
  computeSceneCenter,
  computeSceneSpan,
} from '../lib/rig.js';
import type { AnimationSession } from '../lib/useAnimationSession.js';
import { KeyInspector } from './KeyInspector.js';
import { NumberInput } from './NumberInput.js';
import { RiggedParts } from './RiggedParts.js';
import { TextInput } from './TextInput.js';
import { Timeline } from './Timeline.js';

interface Props {
  cvox: Cvox;
  manifest: Manifest;
  hiddenParts: ReadonlySet<string>;
  // The shared playback + selection state, owned by App so this viewport and
  // the timeline read the same session (see useAnimationSession).
  session: AnimationSession;
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
  onDeleteAnimKey: (
    animName: string,
    part: string,
    timeKey: string,
    attr: KeyAttr,
  ) => void;
  onTrimClip: (animName: string) => void;
  onSetClipDuration: (animName: string, duration: number) => void;
  onSetClipLoop: (animName: string, loop: boolean) => void;
  onCreateClip: () => void;
  onRenameClip: (oldName: string, newName: string) => void;
  onDeleteClip: (name: string) => void;
}

// Animation playback + keyframe editor. Play/pause + scrub drive the session's
// shared `time`; Edit mode reveals a per-attribute timeline (one row per part,
// lanes for rot/pos/scale/visible) and an inspector for the selected key.
// Editing a value flows back to the manifest and the 3D updates live (poses
// re-sample from the edited animation). The rest-pose camera framing holds
// steady. The playback/selection state lives in `session` (App-owned) so the
// timeline can become its own dock panel.
export function AnimationView({
  cvox,
  manifest,
  hiddenParts,
  session,
  manifestEditsDisabled,
  onSetAnimField,
  onDeleteAnimKey,
  onTrimClip,
  onSetClipDuration,
  onSetClipLoop,
  onCreateClip,
  onRenameClip,
  onDeleteClip,
}: Props) {
  const animations = manifest.animations ?? {};
  const {
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
    setSelectedClip,
    setPlaying,
    setEditMode,
    setSelectedKey,
    scrub,
    selectKey,
    addKey,
    moveKey,
    retimeKey,
    clearPart,
  } = session;

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
          {manifestEditsDisabled && (
            <p className="property-group-note anim-edit-note">
              Manifest source has syntax errors — fix to enable animation editing.
            </p>
          )}
          <div className="anim-edit-toolbar">
            <label className="anim-edit-field">
              <span>name</span>
              <TextInput
                value={activeName}
                disabled={manifestEditsDisabled}
                ariaLabel="Clip name"
                validate={(s) => isIdentifier(s) && !Object.hasOwn(animations, s)}
                onCommit={(next) => {
                  onRenameClip(activeName, next);
                  // Optimistic: keep the renamed clip selected (the re-sync
                  // effect would otherwise fall back to the first clip).
                  setSelectedClip(next);
                }}
              />
            </label>
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
            {overrunCount > 0 && (
              <span
                className="anim-lint-badge"
                role="status"
                title={`SPEC §6.6: maximum time key must be ≤ duration (${duration}s)`}
              >
                {overrunCount} key{overrunCount > 1 ? 's' : ''} beyond duration
                <button
                  type="button"
                  className="anim-lint-trim"
                  disabled={manifestEditsDisabled}
                  onClick={() => onTrimClip(activeName)}
                >
                  Trim
                </button>
              </span>
            )}
            {/* Collection-level actions (switch / create) live in the bottom
                bar next to the clip selector — this toolbar is scoped to
                editing the CURRENT clip, so only per-clip operations here. */}
            <button
              type="button"
              className="anim-delete-clip"
              disabled={manifestEditsDisabled}
              title="Delete this clip (undo restores it)"
              onClick={() => onDeleteClip(activeName)}
            >
              Delete clip
            </button>
          </div>
          <div className="anim-edit-main">
            <Timeline
              partNames={partNames}
              inline={inline}
              clipName={activeName}
              time={time}
              selectedKey={effectiveSelectedKey}
              disabled={manifestEditsDisabled}
              onScrub={scrub}
              onSelectKey={selectKey}
              onAddKey={addKey}
              onMoveKey={moveKey}
              onClearPart={clearPart}
            />
            {effectiveSelectedKey !== null && selectedKeyframe !== undefined && (
              <KeyInspector
                selectedKey={effectiveSelectedKey}
                keyframe={selectedKeyframe}
                disabled={manifestEditsDisabled}
                onSetTime={(t) =>
                  retimeKey(
                    effectiveSelectedKey.part,
                    effectiveSelectedKey.attr,
                    effectiveSelectedKey.timeKey,
                    t,
                  )
                }
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
          onChange={(e) => scrub(Number(e.target.value))}
        />
        <span className="anim-time">
          {(hasTimeline ? time : 0).toFixed(2)} / {duration.toFixed(2)}s
        </span>
        {inlineNames.length > 1 ? (
          <select
            className="anim-select"
            value={activeName}
            aria-label="Animation"
            onChange={(e) => setSelectedClip(e.target.value)}
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
        {editMode && (
          /* Collection-level: creating a clip sits beside the clip
             selector, not inside the per-clip edit toolbar. Edit-gated
             like the rest of the editing UI. */
          <button
            type="button"
            className="anim-create-inline"
            disabled={manifestEditsDisabled}
            onClick={onCreateClip}
          >
            + New clip
          </button>
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
