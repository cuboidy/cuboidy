// SPEC §6.7: a looping clip wraps, a non-looping one holds its last
// frame.
//
// The scene's clock is monotonic — one clock for every actor, so it
// cannot wrap at any one clip's duration. Whatever displays a position in
// a clip therefore applies the rule itself, or the scrubber pegs at the
// end while the model carries on looping.
//
// (The editor does not need this: its clock belongs to one clip and wraps
// itself, which is why the shared Transport takes a time already inside
// the clip rather than a `loop` flag of its own.)
export function clampToClip(
  time: number,
  duration: number,
  loop: boolean,
): number {
  if (duration <= 0) return 0;
  if (!loop) return Math.min(Math.max(time, 0), duration);
  const wrapped = time % duration;
  return wrapped < 0 ? wrapped + duration : wrapped;
}
