import { BufferAttribute, BufferGeometry } from 'three';

// Shared drawing primitives for the overlay gizmos. srgbToLinear alone
// had four copies across the two apps, and the gizmo palette three —
// one place, so "socket" and "selection" look the same in the editor
// and the workspace.

// three.js interprets vertex-color attributes as linear, but the palette
// and the hand-written axis colors are sRGB (SPEC §10) — vertex colors
// bypass three's color management, so convert like material.color={hex}
// would have.
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function srgbToLinearArray(srgb: ArrayLike<number>): Float32Array {
  const out = new Float32Array(srgb.length);
  for (let i = 0; i < srgb.length; i++) out[i] = srgbToLinear(srgb[i]!);
  return out;
}

// The shared gizmo palette. The frame is --accent (the selection color);
// an ACTIVE socket goes white, resting ones stay amber; the marker white
// is the pivot / model-origin dot.
export const GIZMO_FRAME_COLOR = 0x8338ec; // --accent
export const GIZMO_MARKER_COLOR = 0xf5f3ff;
export const GIZMO_SOCKET_COLOR = 0xffb703;
export const GIZMO_SOCKET_ACTIVE_COLOR = 0xffffff;

// Axis-cross vertex colors, pre-linearized (see srgbToLinear above).
export const AXIS_COLORS = [
  [0.898, 0.282, 0.302], // x — red   (#e5484d)
  [0.275, 0.655, 0.345], // y — green (#46a758)
  [0.243, 0.388, 0.867], // z — blue  (#3e63dd)
].map((rgb) => rgb.map(srgbToLinear));

// XYZ axis cross of length `len`, per-axis vertex colors. The caller
// owns disposal (wrap in a useMemo + dispose effect).
export function axisCross(len: number): BufferGeometry {
  const positions = new Float32Array([
    0, 0, 0, len, 0, 0,
    0, 0, 0, 0, len, 0,
    0, 0, 0, 0, 0, len,
  ]);
  const colors = new Float32Array(18);
  for (let axis = 0; axis < 3; axis++) {
    colors.set(AXIS_COLORS[axis]!, axis * 6);
    colors.set(AXIS_COLORS[axis]!, axis * 6 + 3);
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  return geom;
}

// Overlays never take raycasts: a Line's raycast threshold is a whole
// world unit and would swallow clicks aimed at whatever sits behind it.
export const noRaycast = (): null => null;
