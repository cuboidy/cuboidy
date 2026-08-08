import type {
  PaletteEntry,
  Palette,
  Part,
  Pivot,
  Size,
  Socket,
  Vec3,
} from './types.js';

// Pure part-geometry transforms: mirror, duplicate and cross-file palette
// remap. These produce CONCRETE parts (no `from` reference) — the building
// blocks the `cuboidy-part` CLI and the editor use to author symmetric /
// copied geometry as plain voxel data, rather than the declarative
// clone/mirror grammar.

export type Axis = 'x' | 'y' | 'z';

// Reflect a position (continuous, range [0, dim]) across the axis midplane:
// the chosen-axis component becomes dim - value; the others are unchanged.
function mirrorPos(v: Vec3, size: Size, axis: Axis): Vec3 {
  return {
    x: axis === 'x' ? size.w - v.x : v.x,
    y: axis === 'y' ? size.h - v.y : v.y,
    z: axis === 'z' ? size.d - v.z : v.z,
  };
}

// Reflect an Euler rotation: a mirror flips handedness, so the two angle
// components NOT around the mirror axis are negated (the around-axis one is
// kept). Matches the standard rig-mirror convention (e.g. Blender X-mirror).
function mirrorRot(rot: Vec3, axis: Axis): Vec3 {
  return {
    x: axis === 'x' ? rot.x : -rot.x,
    y: axis === 'y' ? rot.y : -rot.y,
    z: axis === 'z' ? rot.z : -rot.z,
  };
}

function mirrorPivot(p: Pivot, size: Size, axis: Axis): Pivot {
  const pos = mirrorPos(p.pos, size, axis);
  return p.rot !== undefined ? { pos, rot: mirrorRot(p.rot, axis) } : { pos };
}

function mirrorSocket(s: Socket, size: Size, axis: Axis): Socket {
  const pos = mirrorPos(s.pos, size, axis);
  return s.rot !== undefined
    ? { name: s.name, pos, rot: mirrorRot(s.rot, axis) }
    : { name: s.name, pos };
}

// Reflect the voxel grid (indexed voxels[y][z][x]) across the chosen axis.
function mirrorVoxels(
  voxels: Part['voxels'],
  size: Size,
  axis: Axis,
): number[][][] {
  const out: number[][][] = [];
  for (let y = 0; y < size.h; y++) {
    const sy = axis === 'y' ? size.h - 1 - y : y;
    const layer: number[][] = [];
    for (let z = 0; z < size.d; z++) {
      const sz = axis === 'z' ? size.d - 1 - z : z;
      const srcRow = voxels[sy]![sz]!;
      const row: number[] = [];
      for (let x = 0; x < size.w; x++) {
        const sx = axis === 'x' ? size.w - 1 - x : x;
        row.push(srcRow[sx]!);
      }
      layer.push(row);
    }
    out.push(layer);
  }
  return out;
}

// The geometry half of a mirror (size / pivot / sockets / voxels), reflected
// across `axis`. Shared by `mirrorPart` (concrete result) and the reuse
// resolver's mirror branch (which re-attaches a `from`).
export function mirrorGeometry(
  part: Part,
  axis: Axis,
): Pick<Part, 'size' | 'pivot' | 'sockets' | 'voxels'> {
  return {
    size: part.size,
    pivot: mirrorPivot(part.pivot, part.size, axis),
    sockets: part.sockets.map((s) => mirrorSocket(s, part.size, axis)),
    voxels: mirrorVoxels(part.voxels, part.size, axis),
  };
}

// Concrete mirror: a fresh, self-contained part (no `from`) that is `part`
// reflected across `axis`, renamed `name`.
export function mirrorPart(part: Part, axis: Axis, name: string): Part {
  return { name, ...mirrorGeometry(part, axis) };
}

// Concrete duplicate: `part`'s geometry verbatim under a new name (no
// `from`). Voxel/pivot/socket data is treated as immutable, so the copy
// shares those references — callers never mutate them in place.
export function duplicatePart(part: Part, name: string): Part {
  return {
    name,
    size: part.size,
    pivot: part.pivot,
    sockets: part.sockets,
    voxels: part.voxels,
  };
}

// Entries share a slot only when they agree on everything a slot carries,
// material included. The same rgb polished and unpolished are two entries —
// merging them would repaint one of the parts on the way in.
function sameEntry(a: PaletteEntry, b: PaletteEntry): boolean {
  return (
    a.color.r === b.color.r &&
    a.color.g === b.color.g &&
    a.color.b === b.color.b &&
    a.color.a === b.color.a &&
    a.material.metallic === b.material.metallic &&
    a.material.roughness === b.material.roughness &&
    a.material.emissive === b.material.emissive
  );
}

// Re-express a part's voxel indices from the `from` palette into the `to`
// palette, appending entries `to` lacks (matched on rgba AND material). Used when
// a part is copied into a file whose inline palette differs, so the moved
// voxels keep their colors (§6.10). AIR and out-of-range indices pass
// through unchanged. Returns the (possibly extended) target palette and the
// remapped part — or the inputs untouched when no remap is needed.
export function remapPartPalette(
  part: Part,
  from: Palette,
  to: Palette,
): { part: Part; palette: Palette } {
  const palette = [...to];
  const map = new Map<number, number>();
  for (const layer of part.voxels) {
    for (const row of layer) {
      for (const v of row) {
        if (v < 0 || v >= from.length || map.has(v)) continue;
        const c = from[v]!;
        let j = palette.findIndex((t) => sameEntry(t, c));
        if (j === -1) {
          j = palette.length;
          palette.push(c);
        }
        map.set(v, j);
      }
    }
  }
  const identity = [...map].every(([a, b]) => a === b);
  if (identity && palette.length === to.length) return { part, palette: to };
  const voxels = part.voxels.map((layer) =>
    layer.map((row) => row.map((v) => map.get(v) ?? v)),
  );
  return { part: { ...part, voxels }, palette };
}
