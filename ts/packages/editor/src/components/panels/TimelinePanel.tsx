import { isIdentifier, type Manifest } from '@cuboidy/core';
import type { AnimationSession } from '../../lib/useAnimationSession.js';
import { NoAnimationsYet } from '../ui/NoAnimationsYet.js';
import { NumberInput } from '@cuboidy/ui';
import { TextInput } from '@cuboidy/ui';
import { Timeline } from './Timeline.js';

interface Props {
  session: AnimationSession;
  // The manifest, for the clip-rename collision check (all animation names).
  manifest: Manifest | undefined;
  // A rig manifest is loaded, so a first clip can be created here.
  hasManifest: boolean;
  manifestEditsDisabled: boolean;
  onTrimClip: (animName: string) => void;
  onSetClipDuration: (animName: string, duration: number) => void;
  onSetClipLoop: (animName: string, loop: boolean) => void;
  onCreateClip: () => void;
  onRenameClip: (oldName: string, newName: string) => void;
  onDeleteClip: (name: string) => void;
  // Clip name → external file path (§6.3 string refs). Absent from the
  // map = stored inline in the manifest.
  clipRefs: ReadonlyMap<string, string>;
  // Animation files present in the package, by content — the storage
  // select's middle options.
  clipFiles: readonly string[];
  onExternalizeClip: (name: string) => void;
  onInlineClip: (name: string) => void;
  onUseClipFile: (name: string, path: string) => void;
}

// Storage-select sentinels, prefixed with a character §8 forbids in a
// reference path so they cannot collide with a real one.
const INLINE_VALUE = ' inline';
const NEW_FILE_VALUE = ' new';

// The keyframe editor as its own dock panel: the per-clip toolbar (name /
// duration / loop / trim / delete) over the per-attribute lane timeline.
// Reads the shared session; its lanes are always interactive (there is no
// separate "edit mode" — opening this panel is the edit surface). Shows an
// empty state when there is no inline clip. The selected key's detail lives
// in the separate Key Inspector panel (M4).
export function TimelinePanel({
  session,
  manifest,
  hasManifest,
  manifestEditsDisabled,
  onTrimClip,
  onSetClipDuration,
  onSetClipLoop,
  onCreateClip,
  onRenameClip,
  onDeleteClip,
  clipRefs,
  clipFiles,
  onExternalizeClip,
  onInlineClip,
  onUseClipFile,
}: Props) {
  const {
    activeName,
    inline,
    duration,
    time,
    effectiveSelectedKey,
    overrunCount,
    partNames,
    setSelectedClip,
    scrub,
    selectKey,
    addKey,
    moveKey,
    clearPart,
  } = session;
  const animations = manifest?.animations ?? {};
  // The file this clip reads from, or undefined when it is written
  // inline in cuboidy.json.
  const storedIn = clipRefs.get(activeName);

  if (inline === undefined) {
    return (
      <div className="timeline-panel timeline-empty">
        {hasManifest ? (
          <NoAnimationsYet
            disabled={manifestEditsDisabled}
            onCreateClip={onCreateClip}
          />
        ) : (
          <p>Rig this model (create a manifest) to add animations.</p>
        )}
      </div>
    );
  }

  return (
    <div className="timeline-panel">
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
              // Optimistic: keep the renamed clip selected (the re-sync effect
              // would otherwise fall back to the first clip).
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
              className="btn btn-warning btn-sm"
              disabled={manifestEditsDisabled}
              onClick={() => onTrimClip(activeName)}
            >
              Trim
            </button>
          </span>
        )}
        <div className="anim-toolbar-right">
          {/* Where this clip's keyframes live (§6.3). One control showing
              the current answer, not a toggle plus a separate picker:
              inline in the manifest, a clip file already in the package,
              or a new one written from what is here. */}
          <label className="anim-clip-storage">
            <span>stored in</span>
            <select
              className="anim-select"
              value={clipRefs.get(activeName) ?? INLINE_VALUE}
              disabled={manifestEditsDisabled}
              aria-label={`Where clip ${activeName} is stored`}
              title={
                storedIn === undefined
                  ? `${activeName} is written inline in cuboidy.json. Pick a file to share it across models.`
                  : `${activeName} reads from ${storedIn} — editing keyframes writes that file`
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === (clipRefs.get(activeName) ?? INLINE_VALUE)) return;
                if (v === INLINE_VALUE) onInlineClip(activeName);
                else if (v === NEW_FILE_VALUE) onExternalizeClip(activeName);
                else onUseClipFile(activeName, v);
              }}
            >
              <option value={INLINE_VALUE}>cuboidy.json (inline)</option>
              {clipFiles.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              {/* A reference to a file the package does not hold: keep it
                  selectable so the control states the truth instead of
                  snapping to another entry. */}
              {storedIn !== undefined && !clipFiles.includes(storedIn) && (
                <option value={storedIn}>{storedIn} (missing)</option>
              )}
              {storedIn === undefined && (
                <option value={NEW_FILE_VALUE}>New clip file…</option>
              )}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={manifestEditsDisabled}
            title="Delete this clip (undo restores it)"
            onClick={() => onDeleteClip(activeName)}
          >
            Delete clip
          </button>
        </div>
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
      </div>
    </div>
  );
}
