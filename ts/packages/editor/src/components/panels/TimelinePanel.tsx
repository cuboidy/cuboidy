import { isIdentifier, type Manifest } from '@cuboidy/core';
import { Plus } from 'lucide-react';
import type { AnimationSession } from '../../lib/useAnimationSession.js';
import { NumberInput } from '@cuboidy/ui';
import { TextInput } from '../ui/TextInput.js';
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
  onExternalizeClip: (name: string) => void;
  onInlineClip: (name: string) => void;
}

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
  onExternalizeClip,
  onInlineClip,
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

  if (inline === undefined) {
    return (
      <div className="timeline-panel timeline-empty">
        {hasManifest ? (
          <>
            <p>This model has no animations yet.</p>
            <button
              type="button"
              className="btn btn-create"
              disabled={manifestEditsDisabled}
              onClick={onCreateClip}
            >
              <Plus size={13} />
              Create animation
            </button>
          </>
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
          {clipRefs.has(activeName) && (
            <span
              className="anim-clip-storage"
              title={`Stored in ${clipRefs.get(activeName)} (SPEC §6.3 external animation)`}
            >
              {clipRefs.get(activeName)}
            </span>
          )}
          <button
            type="button"
            className="btn btn-sm"
            disabled={manifestEditsDisabled}
            title={
              clipRefs.has(activeName)
                ? 'Copy this clip back into cuboidy.json (the file is kept)'
                : `Move this clip out to anims/${activeName}.json (shareable across models)`
            }
            onClick={() =>
              clipRefs.has(activeName)
                ? onInlineClip(activeName)
                : onExternalizeClip(activeName)
            }
          >
            {clipRefs.has(activeName) ? 'Inline' : 'Externalize'}
          </button>
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
