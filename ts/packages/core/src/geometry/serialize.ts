import { serializePaletteEntry } from './palette.js';
import { charToIndex, indexToChar } from './voxel-row.js';
import type { Geometry, Part, Pivot, Regions, Size, Socket, Vec3 } from './types.js';
import type { GeometryDoc } from './schema.js';

// SPEC §7: canonical emission of a geometry file. Two layers, because callers
// want different things — `toGeometryDoc` for a value to validate or transform,
// `serializeGeometry` for the bytes to write.
//
// Omission rules mirror the previous text writer exactly, so the two forms
// carry identical information: no `palette` when the file declares none, no
// `pivot` when it is the §7.7 default, no `sockets` when there are none, no
// `rot` when absent, no `regions` when the part has none.

export const SPEC_VERSION = '0.11';

export function toGeometryDoc(geometry: Geometry): GeometryDoc {
  const doc: GeometryDoc = { version: SPEC_VERSION, parts: geometry.parts.map(toPart) };
  // §7.4: a file that pointed at a palette file keeps pointing at it. This
  // branch must come FIRST — `palette` is populated once the project layer
  // resolves the reference, and emitting those colors inline would silently
  // detach the file from the palette it shares with its siblings.
  if (geometry.paletteRef !== undefined) {
    doc.palette = geometry.paletteRef;
  } else if (geometry.palette.length > 0) {
    doc.palette = geometry.palette.map(serializePaletteEntry);
  }
  // An empty palette with no reference means the file declared none (§7.4);
  // absence must round-trip.
  return doc;
}

// SPEC §6.13: a part's shape as the manifest writes it INLINE — the §7.5
// object with `name` dropped, since the enclosing manifest part carries it.
// The same converter a geometry file's part goes through, so a part means
// the same bytes wherever it is written and moving one between the two is
// lossless.
export function toInlineGeometry(
  part: Part,
): Omit<GeometryDoc['parts'][number], 'name'> {
  const { name: _drop, ...rest } = toPart(part);
  return rest;
}

function toPart(part: Part): GeometryDoc['parts'][number] {
  const out: GeometryDoc['parts'][number] = {
    name: part.name,
    size: [part.size.w, part.size.h, part.size.d],
    // [Y][Z] — one string per Z row, X along the string. Same positional
    // indexing as the text format's voxels block.
    voxels: part.voxels.map((layer) => layer.map(rowToText)),
  };
  if (!isDefaultPivot(part.pivot, part.size)) {
    out.pivot = { pos: vec3(part.pivot.pos) };
    if (part.pivot.rot) out.pivot.rot = vec3(part.pivot.rot);
  }
  if (part.sockets.length > 0) {
    out.sockets = part.sockets.map(toSocket);
  }
  if (part.regions !== undefined) out.regions = canonicalRegions(part.regions);
  return out;
}

// SPEC §7.13: a grid's keys in the order of the §7.4 alphabet (0-9, a-z, A-Z,
// `$`, `%`), whatever order they were read in. Not the order written: a
// JavaScript object puts a key that spells an integer ahead of every other,
// so "the order written" is not something this reader can give back, and
// two writers that disagree about it would each rewrite the other's files.
function canonicalRegions(regions: Regions): NonNullable<GeometryDoc['parts'][number]['regions']> {
  if (typeof regions === 'string') return regions;
  const keys: Record<string, string> = {};
  for (const key of Object.keys(regions.keys).sort(byAlphabet)) {
    keys[key] = regions.keys[key]!;
  }
  return { keys, cells: regions.cells.map((layer) => [...layer]) };
}

function byAlphabet(a: string, b: string): number {
  return (charToIndex(a) ?? 0) - (charToIndex(b) ?? 0);
}

function toSocket(s: Socket): NonNullable<GeometryDoc['parts'][number]['sockets']>[number] {
  const out = { name: s.name, pos: vec3(s.pos) } as NonNullable<
    GeometryDoc['parts'][number]['sockets']
  >[number];
  if (s.rot) out.rot = vec3(s.rot);
  return out;
}

// SPEC §7.7: bottom-center of the bounding box with no rotation is the default
// and is omitted by the writer, so an absent pivot round-trips.
function isDefaultPivot(pivot: Pivot, size: Size): boolean {
  if (pivot.rot !== undefined) return false;
  return (
    pivot.pos.x === size.w / 2 && pivot.pos.y === 0 && pivot.pos.z === size.d / 2
  );
}

function vec3(v: Vec3): [number, number, number] {
  return [v.x, v.y, v.z];
}

function rowToText(cells: readonly number[]): string {
  let s = '';
  for (const idx of cells) s += indexToChar(idx);
  return s;
}

// ----- text form --------------------------------------------------------

// `JSON.stringify(doc, null, 2)` explodes every array vertically: `size`
// becomes five lines and each voxel row sits alone inside a nested bracket
// pair. Nobody hand-writes JSON that way and nobody wants to read a diff of it.
// This emitter keeps coordinate triples inline and puts one Y-layer per line,
// mirroring how the text format grouped layers — the grid stays scannable.
export function serializeGeometry(geometry: Geometry): string {
  return formatGeometryDoc(toGeometryDoc(geometry));
}

export function formatGeometryDoc(doc: GeometryDoc): string {
  const out: string[] = ['{'];
  out.push(`  "version": ${JSON.stringify(doc.version ?? SPEC_VERSION)},`);
  if (doc.palette !== undefined) {
    const value =
      typeof doc.palette === 'string'
        ? JSON.stringify(doc.palette)
        : `[${doc.palette.map((c) => JSON.stringify(c)).join(', ')}]`;
    out.push(`  "palette": ${value},`);
  }
  out.push('  "parts": [');
  doc.parts.forEach((part, i) => {
    out.push(...formatPart(part, i === doc.parts.length - 1));
  });
  out.push('  ]');
  out.push('}');
  return out.join('\n') + '\n';
}

function formatPart(part: GeometryDoc['parts'][number], last: boolean): string[] {
  const out: string[] = ['    {'];
  out.push(`      "name": ${JSON.stringify(part.name)},`);
  out.push(`      "size": ${inline(part.size)},`);
  if (part.pivot) {
    const fields = [`"pos": ${inline(part.pivot.pos)}`];
    if (part.pivot.rot) fields.push(`"rot": ${inline(part.pivot.rot)}`);
    out.push(`      "pivot": { ${fields.join(', ')} },`);
  }
  if (part.sockets && part.sockets.length > 0) {
    out.push('      "sockets": [');
    part.sockets.forEach((s, i) => {
      const fields = [`"name": ${JSON.stringify(s.name)}`, `"pos": ${inline(s.pos)}`];
      if (s.rot) fields.push(`"rot": ${inline(s.rot)}`);
      out.push(`        { ${fields.join(', ')} }${i === part.sockets!.length - 1 ? '' : ','}`);
    });
    out.push('      ],');
  }
  out.push('      "voxels": [');
  part.voxels.forEach((layer, i) => {
    out.push(`        ${inline(layer)}${i === part.voxels.length - 1 ? '' : ','}`);
  });
  if (part.regions === undefined) {
    out.push('      ]');
  } else {
    out.push('      ],');
    out.push(...formatRegions(part.regions));
  }
  out.push(last ? '    }' : '    },');
  return out;
}

// SPEC §7.13: after `voxels`, whose shape a grid repeats, laid out the same
// way — one Y-layer per line — so the two read against each other.
function formatRegions(regions: NonNullable<GeometryDoc['parts'][number]['regions']>): string[] {
  if (typeof regions === 'string') return [`      "regions": ${JSON.stringify(regions)}`];
  const keys = Object.keys(regions.keys)
    .sort(byAlphabet)
    .map((key) => `${JSON.stringify(key)}: ${JSON.stringify(regions.keys[key])}`);
  const out = ['      "regions": {', `        "keys": { ${keys.join(', ')} },`, '        "cells": ['];
  regions.cells.forEach((layer, i) => {
    out.push(`          ${inline(layer)}${i === regions.cells.length - 1 ? '' : ','}`);
  });
  out.push('        ]');
  out.push('      }');
  return out;
}

function inline(arr: readonly (number | string)[]): string {
  return `[${arr.map((v) => JSON.stringify(v)).join(', ')}]`;
}
