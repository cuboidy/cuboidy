import { Pause, Play, Square } from 'lucide-react';
import type { PlacedInstance } from '../lib/scene.js';
import { SeekBar } from './SeekBar.js';

interface Props {
  placed: PlacedInstance | null;
  // The shared scene clock's position, and where it is being read from
  // for THIS instance (its own frozen point when paused).
  sceneTime: number;
  // Rig view is on, so nothing here will be visible in the 3D pane. Said
  // rather than hidden: the controls still work, and silently doing
  // nothing is the worse of the two.
  atRest: boolean;
  onSet: (
    id: string,
    anim: { clip: string; playing: boolean; at?: number } | null,
  ) => void;
  onSeek: (time: number) => void;
}

// Playback for the SELECTED instance.
//
// Per instance, not per model: two copies of one model in a scene are two
// actors, and making them share a clip would be a limitation nothing in
// the format asks for. SPEC §6.11 allows one clip at a time per model,
// which is why choosing a clip replaces rather than layers.
//
// Anything attached to a playing instance follows it — the socket frame is
// sampled from the host's pose, so a sword in a swinging hand swings.
export function AnimationPanel({
  placed,
  sceneTime,
  atRest,
  onSet,
  onSeek,
}: Props) {
  if (placed === null) return <p className="empty">No instance selected.</p>;
  const { instance, model } = placed;
  const clips = [...model.animations.keys()];

  if (clips.length === 0) {
    return (
      <p className="empty">
        {model.dir} defines no animations.
      </p>
    );
  }

  const current = instance.anim;
  const playing = current?.playing === true;
  const clip = current === undefined ? undefined : model.animations.get(current.clip);
  // Where this instance actually is: the shared clock while playing, its
  // own frozen point while paused.
  const at = playing ? sceneTime : (current?.at ?? 0);

  return (
    <div className="attach-props">
      {atRest && (
        <p className="notice">
          Rig view is showing the scene at rest. Switch to Anim view to watch
          this play.
        </p>
      )}
      <label className="field">
        <span className="field-label">clip</span>
        <select
          value={current?.clip ?? ''}
          onChange={(e) => {
            const clip = e.target.value;
            // Choosing a clip starts it: picking one and then having to
            // press play is a step with no decision in it.
            onSet(instance.id, clip === '' ? null : { clip, playing: true });
          }}
        >
          <option value="">— none (rest pose) —</option>
          {clips.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      {current !== undefined && (
        <div className="anim-controls">
          <button
            type="button"
            className="btn btn-sm"
            title={playing ? 'Pause' : 'Play'}
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => {
              if (playing) {
                // Freeze where it is, so it stays there while other
                // actors keep moving on the shared clock.
                onSet(instance.id, { ...current, playing: false, at });
              } else {
                // Resume from where it was frozen.
                onSeek(at);
                onSet(instance.id, { ...current, playing: true });
              }
            }}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            title="Stop and return to the rest pose"
            aria-label="Stop"
            onClick={() => onSet(instance.id, null)}
          >
            <Square size={12} />
            Stop
          </button>
        </div>
      )}

      {clip !== undefined && (
        <SeekBar
          time={at}
          duration={clip.duration}
          loop={clip.loop}
          onSeek={(t) => {
            // Playing: move the shared clock, so everything stays in
            // step. Paused: move this instance's own frozen point.
            if (playing) onSeek(t);
            else if (current !== undefined) {
              onSet(instance.id, { ...current, at: t });
            }
          }}
        />
      )}
    </div>
  );
}
