import { Pause, Play, Square } from 'lucide-react';
import type { PlacedInstance } from '../lib/scene.js';

interface Props {
  placed: PlacedInstance | null;
  onSet: (id: string, anim: { clip: string; playing: boolean } | null) => void;
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
export function AnimationPanel({ placed, onSet }: Props) {
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

  return (
    <div className="attach-props">
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
            onClick={() => onSet(instance.id, { ...current, playing: !playing })}
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
    </div>
  );
}
