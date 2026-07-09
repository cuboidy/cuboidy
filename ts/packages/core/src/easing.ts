// SPEC §6.7: named easing presets for keyframe interpolation.
//
// An easing is a pure function u → u' remapping normalized segment progress
// (0 at the segment's start keyframe, 1 at the next keyframe) before linear
// interpolation. The presets follow the standard easings.net formulas.
// `back` / `elastic` / `bounce` intentionally leave [0,1] (overshoot); the
// lerp simply extrapolates, which is meaningful for rot/pos/scale.
// `step` reproduces §6.7 step interpolation for continuous attributes: the
// outgoing keyframe's value holds across the open interval and the next
// keyframe's value lands exactly at its time.
//
// Dependency-free on purpose (no zod): animation.ts derives its schema enum
// from EASING_NAMES, keeping this module trivially testable pure math.

export const EASING_NAMES = [
  'linear',
  'step',
  'in-sine',
  'out-sine',
  'in-out-sine',
  'in-quad',
  'out-quad',
  'in-out-quad',
  'in-cubic',
  'out-cubic',
  'in-out-cubic',
  'in-back',
  'out-back',
  'in-out-back',
  'in-elastic',
  'out-elastic',
  'in-out-elastic',
  'in-bounce',
  'out-bounce',
  'in-out-bounce',
] as const;

export type EasingName = (typeof EASING_NAMES)[number];

// SPEC §6.5: the default easing (also the first-keyframe carryover seed).
export const DEFAULT_EASING: EasingName = 'linear';

// easings.net constants.
const C1 = 1.70158; // back overshoot amount
const C2 = C1 * 1.525; // back in-out overshoot
const C3 = C1 + 1;
const C4 = (2 * Math.PI) / 3; // elastic period
const C5 = (2 * Math.PI) / 4.5; // elastic in-out period

function outBounce(u: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (u < 1 / d1) return n1 * u * u;
  if (u < 2 / d1) return n1 * (u -= 1.5 / d1) * u + 0.75;
  if (u < 2.5 / d1) return n1 * (u -= 2.25 / d1) * u + 0.9375;
  return n1 * (u -= 2.625 / d1) * u + 0.984375;
}

const EASING_FN: Record<EasingName, (u: number) => number> = {
  linear: (u) => u,
  step: (u) => (u < 1 ? 0 : 1),

  'in-sine': (u) => 1 - Math.cos((u * Math.PI) / 2),
  'out-sine': (u) => Math.sin((u * Math.PI) / 2),
  'in-out-sine': (u) => -(Math.cos(Math.PI * u) - 1) / 2,

  'in-quad': (u) => u * u,
  'out-quad': (u) => 1 - (1 - u) * (1 - u),
  'in-out-quad': (u) =>
    u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2,

  'in-cubic': (u) => u * u * u,
  'out-cubic': (u) => 1 - Math.pow(1 - u, 3),
  'in-out-cubic': (u) =>
    u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2,

  'in-back': (u) => C3 * u * u * u - C1 * u * u,
  'out-back': (u) => 1 + C3 * Math.pow(u - 1, 3) + C1 * Math.pow(u - 1, 2),
  'in-out-back': (u) =>
    u < 0.5
      ? (Math.pow(2 * u, 2) * ((C2 + 1) * 2 * u - C2)) / 2
      : (Math.pow(2 * u - 2, 2) * ((C2 + 1) * (u * 2 - 2) + C2) + 2) / 2,

  'in-elastic': (u) =>
    u === 0
      ? 0
      : u === 1
        ? 1
        : -Math.pow(2, 10 * u - 10) * Math.sin((u * 10 - 10.75) * C4),
  'out-elastic': (u) =>
    u === 0
      ? 0
      : u === 1
        ? 1
        : Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * C4) + 1,
  'in-out-elastic': (u) =>
    u === 0
      ? 0
      : u === 1
        ? 1
        : u < 0.5
          ? -(Math.pow(2, 20 * u - 10) * Math.sin((20 * u - 11.125) * C5)) / 2
          : (Math.pow(2, -20 * u + 10) * Math.sin((20 * u - 11.125) * C5)) / 2 +
            1,

  'in-bounce': (u) => 1 - outBounce(1 - u),
  'out-bounce': outBounce,
  'in-out-bounce': (u) =>
    u < 0.5 ? (1 - outBounce(1 - 2 * u)) / 2 : (1 + outBounce(2 * u - 1)) / 2,
};

// Remap normalized segment progress `u` through the named preset. Every
// preset maps 0 → 0 and 1 → 1 (endpoints are exact so keyed values are
// always hit exactly at their keyframes).
export function applyEasing(name: EasingName, u: number): number {
  return EASING_FN[name](u);
}
