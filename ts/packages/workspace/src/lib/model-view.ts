import type { Geometry } from '@cuboidy/core';
import type { LibraryModel } from './library.js';

// A resolved model as the geometry-shaped view @cuboidy/three takes.
// `palette` is only the fallback — per-part colors come from a
// partPalettes map, since a part's colors are its own (§7.4 / §6.13).
export function viewGeometry(model: LibraryModel): Geometry | null {
  const parts = [...model.parts.values()];
  if (parts.length === 0) return null;
  return {
    palette: parts[0]?.palette ?? [],
    parts: parts.map((r) => r.part),
  };
}
