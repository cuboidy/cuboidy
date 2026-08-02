import { QUAT_IDENTITY, quatRotateVec3, worldTransformsFor } from '@cuboidy/core';
import type { LibraryModel } from './library.js';

export interface Box {
  center: [number, number, number];
  size: [number, number, number];
}

// The rest bounding box of a whole model, in its OWN space.
//
// @cuboidy/ui's computeSceneSpan would nearly do, but it always unions in
// the unit cube at the origin — a camera-framing habit that keeps the view
// anchored near the grid. As a selection outline that shows: a model built
// away from its origin gets a box stretched back to meet it, which reads
// as the box being wrong rather than as a framing convention.
//
// REST, not posed. A selection frame that breathed with the animation
// would be movement that means nothing.
export function modelBounds(model: LibraryModel): Box | null {
  const parts = [...model.parts.values()];
  if (parts.length === 0) return null;
  const transforms = worldTransformsFor(model.manifest, model.parts);

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const [name, resolved] of model.parts) {
    const part = resolved.part;
    const wt = transforms.get(name) ?? { pos: [0, 0, 0], quat: QUAT_IDENTITY };
    const piv = part.pivot.pos;
    // A part's world transform places its PIVOT at wt.pos, so the eight
    // corners of the local box go through (corner − pivot) rotated.
    for (const cx of [0, part.size.w]) {
      for (const cy of [0, part.size.h]) {
        for (const cz of [0, part.size.d]) {
          const r = quatRotateVec3(wt.quat, [
            cx - piv.x,
            cy - piv.y,
            cz - piv.z,
          ]);
          for (let i = 0; i < 3; i++) {
            const w = wt.pos[i]! + r[i]!;
            if (w < min[i]!) min[i] = w;
            if (w > max[i]!) max[i] = w;
          }
        }
      }
    }
  }
  if (!isFinite(min[0])) return null;
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    // A zero-thickness box draws as nothing; a flat model still deserves
    // an outline.
    size: [
      Math.max(max[0] - min[0], 0.05),
      Math.max(max[1] - min[1], 0.05),
      Math.max(max[2] - min[2], 0.05),
    ],
  };
}
