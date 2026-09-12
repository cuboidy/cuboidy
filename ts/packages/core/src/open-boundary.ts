import type { Part, Vec3Tuple } from './geometry/types.js';
import type { Manifest } from './manifest.js';
import { localPointToWorld, type WorldTransform } from './rig-transform.js';

// SPEC §6.14 open boundaries: the planes of a package's (or a part's) bounds
// that another package is expected to sit against, so the faces lying ON them
// are seam faces and are not baked.
//
// WHY A PLANE AND NOT A LIST OF FACES. Naming individual faces would bind the
// declaration to the shape: every edit that adds, removes or moves a voxel on
// that side invalidates the list, silently. A plane is a statement about the
// package's OUTSIDE, and it survives reshaping — whatever ends up lying on
// `z = max` is the seam, however many rectangles that turns out to be.
//
// The test is exact, with no epsilon, and that is the second decision worth
// stating: a face is dropped only when all four of its corners have the
// declared axis coordinate EXACTLY equal to the plane, in package space. An
// epsilon would quietly eat interior faces that happen to sit a hair off the
// boundary, and a disappearance nobody can explain is worse than a face drawn
// where nothing can see it. Exactness is affordable because the extreme is
// computed by `boundsOf` from the very same `localPointToWorld` a face corner
// goes through: on an unrotated part the two expressions are the same
// arithmetic on the same operands, so they agree bit for bit. A part whose
// rest rotation does not carry its lattice onto the plane produces corners
// that miss it by an ulp and keeps its faces — which is the honest answer,
// since such a face is not coplanar with the seam in the first place.

export const BOUNDARY_FACES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;

export type BoundaryFace = (typeof BOUNDARY_FACES)[number];

// One resolved plane: which axis it is perpendicular to, which way the faces
// it drops point, and where it sits in package coordinates. `face` is the
// declaration it came from, kept so a diagnostic can name what the author
// wrote rather than an axis index.
export interface OpenPlane {
  face: BoundaryFace;
  axis: 0 | 1 | 2;
  positive: boolean;
  at: number;
}

// A part at rest: its shape, where the rig puts it, and its total §6.2 × §6.5
// scale. The three arguments `localPointToWorld` needs, kept together because
// every function here takes all three.
export interface RestPlacement {
  part: Part;
  transform: WorldTransform;
  scale?: Vec3Tuple | undefined;
}

export function boundaryAxis(face: BoundaryFace): 0 | 1 | 2 {
  const c = face.charCodeAt(1);
  return c === 120 /* x */ ? 0 : c === 121 /* y */ ? 1 : 2;
}

export function boundaryIsPositive(face: BoundaryFace): boolean {
  return face.charCodeAt(0) === 43 /* + */;
}

function pivotOf(part: Part): Vec3Tuple {
  return [part.pivot.pos.x, part.pivot.pos.y, part.pivot.pos.z];
}

// The package-space box of a set of parts at rest, over the eight corners of
// each part's declared size.
//
// Deliberately NOT `partsWorldBounds`: this one goes through
// `localPointToWorld`, which is the function a face corner is placed by, so
// the extreme it reports and the coordinate a face on it computes are the same
// expression rather than two expressions that ought to agree. That identity is
// the whole reason the plane test can be exact.
export function boundsOf(placements: Iterable<RestPlacement>): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { part, transform, scale } of placements) {
    const piv = pivotOf(part);
    for (const cx of [0, part.size.w]) {
      for (const cy of [0, part.size.h]) {
        for (const cz of [0, part.size.d]) {
          const w = localPointToWorld([cx, cy, cz], piv, scale, transform);
          for (let i = 0; i < 3; i++) {
            if (w[i]! < min[i]!) min[i] = w[i]!;
            if (w[i]! > max[i]!) max[i] = w[i]!;
          }
        }
      }
    }
  }
  return { min, max };
}

function planesFrom(
  faces: readonly BoundaryFace[],
  bounds: { min: readonly number[]; max: readonly number[] },
): OpenPlane[] {
  const out: OpenPlane[] = [];
  for (const face of faces) {
    const axis = boundaryAxis(face);
    const positive = boundaryIsPositive(face);
    out.push({ face, axis, positive, at: (positive ? bounds.max : bounds.min)[axis]! });
  }
  return out;
}

// Which planes apply to which part, in package coordinates, at rest.
//
// A manifest-level declaration is a plane of the WHOLE package's bounds and
// therefore applies to every part — an interior part simply has no face on it.
// A part-level declaration is a plane of that part's own bounds and applies to
// that part alone. `placements` is keyed by the rig's name for each part, the
// same key `computeRestWorldTransforms` returns; a part the map does not hold
// (unresolved shape) takes part in neither the bounds nor the result.
export function openPlanesFor(
  manifest: Manifest,
  placements: ReadonlyMap<string, RestPlacement>,
): Map<string, OpenPlane[]> {
  const out = new Map<string, OpenPlane[]>();
  const shared =
    manifest.openBoundaries === undefined
      ? []
      : planesFrom(manifest.openBoundaries, boundsOf(placements.values()));

  for (const mp of manifest.parts) {
    const placement = placements.get(mp.name);
    if (placement === undefined) continue;
    const own =
      mp.openBoundaries === undefined
        ? []
        : planesFrom(mp.openBoundaries, boundsOf([placement]));
    if (shared.length === 0 && own.length === 0) continue;
    out.set(mp.name, [...shared, ...own]);
  }
  return out;
}

// Does this face lie on an open plane? `corners` and `normal` are in PACKAGE
// space.
//
// Two conditions, both exact. The normal must point OUT through the plane —
// only the outward face of a seam is the one a neighbour package covers; a
// face pointing back into the package at the same coordinate is the inside of
// a hollow and nothing else draws it. And all four corners must have the
// plane's coordinate, which is coplanarity and parallelism in one test.
export function faceOnOpenPlane(
  planes: readonly OpenPlane[],
  corners: readonly Vec3Tuple[],
  normal: Vec3Tuple,
): boolean {
  for (const plane of planes) {
    const n = normal[plane.axis]!;
    if (plane.positive ? !(n > 0) : !(n < 0)) continue;
    let on = true;
    for (const corner of corners) {
      if (corner[plane.axis] !== plane.at) {
        on = false;
        break;
      }
    }
    if (on) return true;
  }
  return false;
}
