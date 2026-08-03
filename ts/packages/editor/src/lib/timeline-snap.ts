// The keyframe-drag snap grids. In lib rather than in the Timeline
// component because the animation session's arrow-key nudge uses the
// same steps — a lib module importing a constant out of a component was
// the package's one backwards edge.

// Coarse snap grid for dragging keyframes — markers land on 0.05s steps
// so a drag reads as deliberate "clicks" instead of free-floating.
// Holding Alt bypasses to the fine 1e-3 grid (formatTimeKey's storage
// resolution).
export const SNAP_STEP = 0.05;

// Snap to the canonical 1e-3 storage grid.
export const snapMs = (t: number): number => Math.round(t * 1000) / 1000;

export const snapTo = (t: number, step: number): number =>
  Math.round(t / step) * step;
