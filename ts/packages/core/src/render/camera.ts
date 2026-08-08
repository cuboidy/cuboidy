import { cross, dot, normalize, sub, type Vec3 } from './vec.js';

// Orthographic cameras for cuboidy-snap. Angles are named, declarative
// (azimuth + elevation in degrees) so the CLI and tests can refer to
// them by id, and the projection geometry is centralized here.
//
// Coordinate convention follows SPEC §4 and cuboidy-view: +X right,
// +Y up, −Z forward (the model faces −Z). Azimuth rotates the camera
// about +Y; az=0 places the camera on the −Z side (looking at the
// model's face), az=90 on the +X side (the model's right). Elevation
// lifts the camera above the horizon.
//
//   camDir = direction from the model toward the camera
//          = (sin az · cos el,  sin el,  −cos az · cos el)
//
// Orthographic projection drops the component along the view axis and
// keeps the two screen axes (right, up). Depth is the view-axis
// component (smaller = nearer the camera) for the z-buffer.

export interface Angle {
  readonly id: string;
  readonly label: string; // baked into the render (uppercase ASCII)
  readonly az: number; // azimuth degrees
  readonly el: number; // elevation degrees
}

// The seven-view "standard set": four three-quarter corners from above
// (silhouette + depth) plus front / right-side / top orthographic
// (proportion + alignment). Order is the contact-sheet reading order.
export const STANDARD_IDS = [
  'fr-up',
  'fl-up',
  'br-up',
  'bl-up',
  'front',
  'side',
  'top',
] as const;

export const CARDINAL_IDS = ['front', 'back', 'side', 'left', 'top', 'bottom'] as const;
export const CORNER_IDS = ['fr-up', 'fl-up', 'br-up', 'bl-up'] as const;
// The same four corners from BELOW. Worth having as a named group: every
// preset used to look down or dead level, and `bottom` looks straight up,
// where a vertical plane is edge-on and contributes nothing. So a whole
// class of artifact — anything you only see when a line of sight crosses a
// near-vertical surface from underneath — could not appear in ANY snapshot.
// A translucency bug lived in exactly that blind spot: plainly visible when
// the editor was orbited below the model, invisible in every rendered
// angle, which read as the editor and the CLI disagreeing.
export const UNDER_IDS = ['fr-dn', 'fl-dn', 'br-dn', 'bl-dn'] as const;

const EL = 30; // three-quarter elevation

export const ANGLES: Readonly<Record<string, Angle>> = {
  front: { id: 'front', label: 'FRONT', az: 0, el: 0 },
  back: { id: 'back', label: 'BACK', az: 180, el: 0 },
  side: { id: 'side', label: 'SIDE-R', az: 90, el: 0 },
  left: { id: 'left', label: 'SIDE-L', az: 270, el: 0 },
  top: { id: 'top', label: 'TOP', az: 0, el: 90 },
  bottom: { id: 'bottom', label: 'BOTTOM', az: 0, el: -90 },
  'fr-up': { id: 'fr-up', label: 'FR-UP', az: 45, el: EL },
  'fl-up': { id: 'fl-up', label: 'FL-UP', az: 315, el: EL },
  'br-up': { id: 'br-up', label: 'BR-UP', az: 135, el: EL },
  'bl-up': { id: 'bl-up', label: 'BL-UP', az: 225, el: EL },
  'fr-dn': { id: 'fr-dn', label: 'FR-DN', az: 45, el: -EL },
  'fl-dn': { id: 'fl-dn', label: 'FL-DN', az: 315, el: -EL },
  'br-dn': { id: 'br-dn', label: 'BR-DN', az: 135, el: -EL },
  'bl-dn': { id: 'bl-dn', label: 'BL-DN', az: 225, el: -EL },
};

// An arbitrary view, spelled `az<deg>el<deg>` (e.g. `az20el-15`). The named
// presets are for comparable contact sheets; this is for aiming at
// something specific, which a fixed list cannot do however long it gets.
const CUSTOM_RE = /^az(-?\d+(?:\.\d+)?)el(-?\d+(?:\.\d+)?)$/i;

function parseCustomAngle(spec: string): Angle | null {
  const m = CUSTOM_RE.exec(spec);
  if (m === null) return null;
  const az = Number(m[1]);
  const el = Number(m[2]);
  // Elevation past the poles is the same view as its mirror with a flipped
  // azimuth, so reject it rather than silently render something else.
  if (!Number.isFinite(az) || !Number.isFinite(el)) return null;
  if (el < -90 || el > 90) return null;
  // Renders already get "AZ<az> EL<el>" stamped on them, so a label
  // repeating the numbers would read "AZ20EL-25 AZ20 EL-25".
  return { id: `az${az}el${el}`, label: 'CUSTOM', az, el };
}

const WORLD_UP: Vec3 = [0, 1, 0];

export interface Projected {
  sx: number; // screen right, world units
  sy: number; // screen up, world units
  depth: number; // view-axis, smaller = nearer
}

export interface Projector {
  readonly right: Vec3;
  readonly up: Vec3;
  readonly viewDir: Vec3; // points from camera into the scene
  // Project a world point relative to `center` into screen/world units.
  project(p: Vec3): Projected;
}

export function cameraDir(angle: Angle): Vec3 {
  const az = (angle.az * Math.PI) / 180;
  const el = (angle.el * Math.PI) / 180;
  return [
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el),
  ];
}

export function makeProjector(angle: Angle, center: Vec3): Projector {
  const camDir = cameraDir(angle);
  const viewDir: Vec3 = [-camDir[0], -camDir[1], -camDir[2]];

  let right: Vec3;
  let up: Vec3;
  if (Math.abs(dot(viewDir, WORLD_UP)) > 0.999) {
    // Looking straight down (top) or up (bottom): world up is parallel
    // to the view axis, so pick the screen-up explicitly. Match
    // cuboidy-view — top puts the model's front (−Z) at image top,
    // bottom puts the model's back (+Z) at image top.
    right = [1, 0, 0];
    up = camDir[1] > 0 ? [0, 0, -1] : [0, 0, 1];
  } else {
    right = normalize(cross(WORLD_UP, viewDir));
    up = normalize(cross(viewDir, right));
  }

  return {
    right,
    up,
    viewDir,
    project(p: Vec3): Projected {
      const rel = sub(p, center);
      return {
        sx: dot(rel, right),
        sy: dot(rel, up),
        depth: dot(rel, viewDir),
      };
    },
  };
}

// Resolve a comma-separated list of ids, group keywords, and `az<d>el<d>`
// custom views into angles. Returns an error string for anything
// unrecognised so the CLI can report usage.
export function resolveAngles(spec: string): Angle[] | { error: string } {
  const groups: Record<string, readonly string[]> = {
    standard: STANDARD_IDS,
    cardinal: CARDINAL_IDS,
    corners: CORNER_IDS,
    unders: UNDER_IDS,
    all: Object.keys(ANGLES),
  };
  const picked: Angle[] = [];
  for (const raw of spec.split(',')) {
    const t = raw.trim();
    if (t === '') continue;
    const group = groups[t];
    if (group) {
      for (const id of group) picked.push(ANGLES[id]!);
      continue;
    }
    const named = ANGLES[t];
    if (named) {
      picked.push(named);
      continue;
    }
    const custom = parseCustomAngle(t);
    if (custom !== null) {
      picked.push(custom);
      continue;
    }
    return {
      error:
        `unknown angle "${t}" (choices: ${Object.keys(ANGLES).join(', ')}; ` +
        `groups: ${Object.keys(groups).join(', ')}; ` +
        `or a custom view like az45el-30, elevation −90..90)`,
    };
  }
  if (picked.length === 0) return { error: 'no angles selected' };
  // De-duplicate while preserving first-seen order.
  const seen = new Set<string>();
  const out: Angle[] = [];
  for (const angle of picked) {
    if (seen.has(angle.id)) continue;
    seen.add(angle.id);
    out.push(angle);
  }
  return out;
}
