import {
  formatGeometryDoc,
  SPEC_VERSION,
} from '../../src/geometry/serialize.js';
import type { GeometryDoc } from '../../src/geometry/schema.js';

// Builds a geometry file for tests that write a package to disk and hand it to
// a loader. Authoring the document directly — rather than a text literal a
// parser has to interpret — keeps these fixtures independent of any one
// container, and readable: `size` and the voxel rows sit where you expect.
//
//   geo([{ name: 'p', size: [1, 1, 1], voxels: [['0']] }], ['#FF0000'])
//
// `palette` takes either form §7.4 allows: an array of colors, or a §8
// reference path to a shared palette file.

export interface PartSpec {
  name: string;
  size: [number, number, number];
  voxels: string[][];
  pivot?: [number, number, number];
  pivotRot?: [number, number, number];
  sockets?: Array<{ name: string; pos: [number, number, number]; rot?: [number, number, number] }>;
}

export function geo(parts: PartSpec[], palette?: string[] | string): string {
  const doc: GeometryDoc = {
    version: SPEC_VERSION,
    parts: parts.map((p) => {
      const out: GeometryDoc['parts'][number] = {
        name: p.name,
        size: p.size,
        voxels: p.voxels,
      };
      if (p.pivot) {
        out.pivot = { pos: p.pivot };
        if (p.pivotRot) out.pivot.rot = p.pivotRot;
      }
      if (p.sockets) out.sockets = p.sockets;
      return out;
    }),
  };
  if (palette) doc.palette = palette;
  return formatGeometryDoc(doc);
}

// The single-voxel part these tests reach for constantly.
export function oneVoxel(name: string, color: string): string {
  return geo([{ name, size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] }], [color]);
}
