import { Pause, Play } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

interface Props {
  playing: boolean;
  // Seconds. `duration` of 0 (or `disabled`) parks the scrubber.
  time: number;
  duration: number;
  // Nothing to play. The controls stay visible and inert with the reason
  // in their tooltip, the same convention the viewport toolbars use.
  disabled?: string | undefined;
  onToggle: () => void;
  onScrub: (time: number) => void;
  // What each app puts to the right of the time: a clip picker, a New
  // clip button. The transport itself has no opinion about clips.
  children?: ReactNode;
}

// The playback strip under a 3D view: play/pause, a scrubber, the time.
//
// Under the canvas rather than floating over it — the editor's animation
// viewport has worn it there since it was built, and a transport is not a
// tool overlay: it is a permanent fixture of a view that can move.
//
// Shared because the scrubber alone is sixty lines of stylesheet with
// four vendor-prefixed pseudo-elements, and a second copy of that is a
// second copy to keep matching.
export function Transport({
  playing,
  time,
  duration,
  disabled,
  onToggle,
  onScrub,
  children,
}: Props) {
  const live = disabled === undefined && duration > 0;
  const at = live ? Math.min(time, duration) : 0;
  return (
    <div className="transport" role="group" aria-label="Playback">
      <button
        type="button"
        className="transport-play icon-btn"
        aria-label={playing ? 'Pause' : 'Play'}
        title={disabled ?? (playing ? 'Pause' : 'Play')}
        disabled={!live}
        onClick={onToggle}
      >
        {playing ? (
          <Pause size={15} fill="currentColor" strokeWidth={0} />
        ) : (
          <Play size={15} fill="currentColor" strokeWidth={0} />
        )}
      </button>
      <input
        type="range"
        className="transport-scrub"
        min={0}
        max={live ? duration : 1}
        step={live ? Math.max(duration / 200, 0.001) : 0.001}
        value={at}
        // The played portion is filled from this, so the track shows
        // progress without a second element behind it.
        style={
          {
            '--fill': `${live ? (at / duration) * 100 : 0}%`,
          } as CSSProperties
        }
        disabled={!live}
        aria-label="Scrub timeline"
        onChange={(e) => onScrub(Number(e.target.value))}
      />
      <span className="transport-time">
        {at.toFixed(2)} / {(live ? duration : 0).toFixed(2)}s
      </span>
      {children}
    </div>
  );
}
