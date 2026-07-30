import {
  formatGeometryDoc,
  serializeGeometry,
  SPEC_VERSION,
} from '../../src/geometry/serialize.js';
import { parseCvox } from '../../src/cvox/parse.js';
import type { GeometryDoc } from '../../src/geometry/schema.js';

// Builds a geometry file for tests that write a package to disk and hand it to
// a loader. Authoring the document directly — rather than a text literal a
// parser has to interpret — keeps these fixtures independent of any one
// container, and readable: `size` and the voxel rows sit where you expect.
//
//   geo([{ name: 'p', size: [1, 1, 1], voxels: [['0']] }], ['#FF0000'])

export interface PartSpec {
  name: string;
  size: [number, number, number];
  voxels: string[][];
  pivot?: [number, number, number];
  pivotRot?: [number, number, number];
  sockets?: Array<{ name: string; pos: [number, number, number]; rot?: [number, number, number] }>;
}

export function geo(parts: PartSpec[], palette?: string[]): string {
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

// MIGRATION BRIDGE — remove in phase 4 with the rest of the text parser.
//
// The loader/CLI tests build packages on disk from ~46 geometry fixtures that
// were authored in the retired text syntax, where a whole part fits on one
// line. Rewriting them all as documents is mechanical but large, and doing it
// while the JSON path is still unproven would mix two kinds of risk in one
// commit. So they keep their source form and are written out as JSON.
//
// This is the one place still calling parseCvox from a non-cvox test. When
// phase 4 deletes the parser, convert those call sites to `geo()` — the
// fixtures they produce are already the JSON the loader reads, so the change
// is source-only and the assertions do not move.
export function geoFromText(cvoxText: string): string {
  const parsed = parseCvox(cvoxText);
  if (!parsed.ok) {
    throw new Error(`fixture is not valid geometry: ${parsed.message}`);
  }
  return serializeGeometry(parsed.value);
}
