import { clampToClip } from '@cuboidy/core';
import { Transport } from '@cuboidy/ui';
import type { PlacedInstance } from '../lib/scene-resolve.js';
import type { SceneViewMode } from '../lib/view.js';

// The strip under the canvas, where the editor's has always been. A
// transport is not a tool overlay — it is a fixture of a view that can
// move. What it acts on: the selected instance's clip, if it has one.
// The clip list comes from its model, so an instance of a model with no
// animations gets an inert strip with the reason on it.
export function SceneTransport({
  selectedPlaced,
  viewMode,
  sceneTime,
  onSeek,
  onSetAnim,
}: {
  selectedPlaced: PlacedInstance | null;
  viewMode: SceneViewMode;
  sceneTime: number;
  onSeek: (time: number) => void;
  onSetAnim: (
    id: string,
    anim: { clip: string; playing: boolean; at?: number } | null,
  ) => void;
}) {
  const clips =
    selectedPlaced === null ? [] : [...selectedPlaced.model.animations.keys()];
  const anim = selectedPlaced?.instance.anim;
  const clip =
    anim === undefined
      ? undefined
      : selectedPlaced?.model.animations.get(anim.clip);
  const clipPlaying = anim?.playing === true;
  // Where this instance actually is: the shared clock while playing, its
  // own frozen point while paused.
  // Wrapped into the clip: the shared clock is monotonic, so a looping
  // clip would otherwise peg the scrubber at the end while the model
  // carried on going round.
  const raw = clipPlaying ? sceneTime : (anim?.at ?? 0);
  const at =
    clip === undefined ? 0 : clampToClip(raw, clip.duration, clip.loop);
  // Cause before consequence. Rig view is checked LAST because the view
  // itself falls back to rig when nothing in the scene can animate —
  // leading with it would answer "why can I not play this sword?" with
  // "because you are in rig view", which is the same fact wearing a hat.
  const transportDisabled =
    selectedPlaced === null
      ? 'Select an instance to play its animation'
      : clips.length === 0
        ? `${selectedPlaced.model.dir} defines no animations`
        : clip === undefined
          ? 'Choose a clip'
          : viewMode === 'rig'
            ? 'Rig view is showing the scene at rest'
            : undefined;

  return (
    <Transport
      playing={clipPlaying}
      time={at}
      duration={clip?.duration ?? 0}
      {...(transportDisabled !== undefined && { disabled: transportDisabled })}
      onToggle={() => {
        if (selectedPlaced === null || anim === undefined) return;
        if (clipPlaying) {
          // Freeze where it is, so it stays there while other actors keep
          // moving on the shared clock.
          onSetAnim(selectedPlaced.instance.id, {
            ...anim,
            playing: false,
            at,
          });
        } else {
          onSeek(at);
          onSetAnim(selectedPlaced.instance.id, { ...anim, playing: true });
        }
      }}
      onScrub={(t) => {
        if (selectedPlaced === null || anim === undefined) return;
        // Playing: move the shared clock, so everything stays in step.
        // Paused: move this instance's own frozen point.
        if (clipPlaying) onSeek(t);
        else onSetAnim(selectedPlaced.instance.id, { ...anim, at: t });
      }}
    >
      <select
        className="anim-select"
        aria-label="Clip"
        value={anim?.clip ?? ''}
        disabled={selectedPlaced === null || clips.length === 0}
        onChange={(e) => {
          if (selectedPlaced === null) return;
          const next = e.target.value;
          // Choosing a clip starts it: picking one and then having to
          // press play is a step with no decision in it.
          onSetAnim(
            selectedPlaced.instance.id,
            next === '' ? null : { clip: next, playing: true },
          );
        }}
      >
        {/* An instance may play NOTHING — a static prop in a scene — which
            the editor has no equivalent of: its picker chooses among the
            clips a model has, and one of them is always active. Called
            "none" rather than "rest pose" because Rig view already owns
            that phrase for the whole scene, and two controls meaning
            almost the same thing should not share a word. */}
        <option value="">— none —</option>
        {clips.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </Transport>
  );
}
