interface Props {
  // Seconds into the clip, already wrapped for a looping one.
  time: number;
  duration: number;
  loop: boolean;
  onSeek: (time: number) => void;
}

// Scrubbing one clip.
//
// Not the editor's Timeline: that is a keyframe EDITOR, with a lane per
// attribute and markers you drag. A scene does not author clips — it
// plays them — so what is wanted here is the position in one, and adding
// lanes would offer an edit this app cannot make.
export function SeekBar({ time, duration, loop, onSeek }: Props) {
  const at = duration <= 0 ? 0 : clampToClip(time, duration, loop);
  return (
    <div className="seek">
      <input
        type="range"
        className="seek-range"
        min={0}
        max={duration}
        step={Math.max(duration / 600, 0.001)}
        value={at}
        aria-label="Seek"
        onChange={(e) => onSeek(Number(e.target.value))}
      />
      <span className="seek-time">
        {at.toFixed(2)} / {duration.toFixed(2)}s
      </span>
    </div>
  );
}

// SPEC §6.7: a looping clip wraps, a non-looping one holds its last
// frame. The bar shows where the model actually is, so it uses the same
// rule the sampler does rather than running off the end.
export function clampToClip(time: number, duration: number, loop: boolean): number {
  if (duration <= 0) return 0;
  if (!loop) return Math.min(Math.max(time, 0), duration);
  const wrapped = time % duration;
  return wrapped < 0 ? wrapped + duration : wrapped;
}
