import { refitRegions, type Part, type Vec3 } from '@cuboidy/core';

// SPEC §7.13 for every edit that rewrites a part's voxel grid: `next` is the
// part after the edit and `prev` the part before it, and what comes back is
// `next` with `prev`'s regions refitted to its voxels — each mark moved with
// its cell by `shift` (how far the old grid's cells moved in the new one), a
// new cell in no region, the mark of a cell now air dropped. A region name
// stays as it is, and a part with no regions gets none.
//
// The editor has no tool that paints regions; this is what keeps a grid it
// was handed in step with the shape it edits, so that saving writes a grid
// the reader accepts. A grid left at its old size is `wrong-arity`, and the
// stroke tool refits a part's grid to its solid cells after every stroke.
export function withRegions(prev: Part, next: Part, shift?: Vec3): Part {
  const regions = refitRegions(prev.regions, next.voxels, shift);
  const { regions: _drop, ...rest } = next;
  return regions === undefined ? rest : { ...rest, regions };
}
