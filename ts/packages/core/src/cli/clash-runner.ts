import { loadAndAssemble, type Assembly } from './assemble.js';
import { buildMesh } from '../mesh.js';
import {
  composeScale,
  computeRestWorldTransforms,
  localPointToWorld,
  pivotRotsOf,
  quatRotateVec3,
} from '../rig-transform.js';
import type { Vec3Tuple } from '../geometry/types.js';

// cuboidy-clash: two surfaces in the same place, facing the same way, in
// different colours. The renderer has no way to choose between them, so it
// picks per pixel — a dithered cross-hatch in a software rasterizer, a flicker
// that follows the camera in anything with a depth buffer.
//
// Nothing else in the toolchain sees this. Lint is structural and per-file and
// never assembles; a snap draws the fault without naming it; and `--mesh-faces`
// prints every face but prints them AFTER the per-part summary lines, in one
// undifferentiated block, so an external script can find a clash and still not
// say which two parts made it. That last part is why this lives in the library:
// the mesh is built per part here, so both sides can be named.
//
// Not a lint rule for the same reason. `authoring.md` tells authors to overlap
// joints by one or two cells, which is correct and is what creates the
// opportunity; a clash is a property of the assembled model, not of a file.

/** One side of a clash: whose surface it is, and where on that part. */
export interface ClashSide {
  /** Manifest part name. */
  part: string;
  /** The part-local voxel that owns the face — the cell you go and edit. */
  cell: readonly [number, number, number];
  /** Which face of that voxel, in the part's own frame: `+X`, `-Y`, … */
  face: string;
  /** `#RRGGBB` as the palette resolved it. */
  rgb: string;
}

export interface Clash {
  /** Centre-to-centre separation, in voxels. Zero is exact coincidence. */
  distance: number;
  a: ClashSide;
  b: ClashSide;
  /** Where the pair sits in the assembled model. */
  world: readonly [number, number, number];
}

export interface ClashOptions {
  /**
   * Report a pair whose face centres are within this many voxels. Coincident
   * surfaces on the integer lattice land at exactly 0; a part carrying a rest
   * ROTATION lands near but not on its neighbour, which is why a distance and
   * not an equality test. Measured across a sixteen-model cast, an exact test
   * missed 161 of 566 real pairs and reported one model with two dozen of them
   * as perfectly clean.
   */
  maxDistance: number;
  /** Longest listing before it is truncated; the summary still counts all. */
  top: number;
}

export const DEFAULT_MAX_DISTANCE = 0.3;
export const DEFAULT_TOP = 40;

interface Face {
  part: string;
  cell: readonly [number, number, number];
  face: string;
  rgb: string;
  world: readonly [number, number, number];
  normal: readonly [number, number, number];
}

const AXES = ['X', 'Y', 'Z'] as const;

// A local normal off `buildMesh` is axis-aligned and unit length, so the
// largest component names the face and its sign gives the direction.
function faceWord(n: readonly [number, number, number]): string {
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(n[i]!) > Math.abs(n[k]!)) k = i;
  return `${n[k]! < 0 ? '-' : '+'}${AXES[k]}`;
}

function hex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Every drawn face of the assembled model, in world space, each still knowing
 * the part and the part-local voxel it came from.
 */
export function facesOf(asm: Assembly): Face[] {
  const world = computeRestWorldTransforms(
    asm.manifest.parts,
    pivotRotsOf(asm.resolvedParts.map((rp) => [rp.name, rp.part] as const)),
  );
  const out: Face[] = [];
  for (const rp of asm.resolvedParts) {
    const wt = world.get(rp.name);
    if (wt === undefined) continue;
    const mesh = buildMesh(rp.part, rp.palette);
    const piv: Vec3Tuple = [
      rp.part.pivot.pos.x,
      rp.part.pivot.pos.y,
      rp.part.pivot.pos.z,
    ];
    const scale = composeScale(rp.scale, undefined);
    const quads = mesh.positions.length / 12;
    for (let f = 0; f < quads; f++) {
      const n0 = f * 12;
      const local: [number, number, number] = [
        mesh.normals[n0]!,
        mesh.normals[n0 + 1]!,
        mesh.normals[n0 + 2]!,
      ];
      // Local centroid, then step half a cell back along the normal: a face
      // lies ON a cell boundary, and the voxel that owns it is the one behind.
      const c: [number, number, number] = [0, 0, 0];
      const w: [number, number, number] = [0, 0, 0];
      for (let v = 0; v < 4; v++) {
        const at = (f * 4 + v) * 3;
        const p: Vec3Tuple = [
          mesh.positions[at]!,
          mesh.positions[at + 1]!,
          mesh.positions[at + 2]!,
        ];
        for (let i = 0; i < 3; i++) c[i]! += p[i]! / 4;
        const wp = localPointToWorld(p, piv, scale, wt);
        for (let i = 0; i < 3; i++) w[i]! += wp[i]! / 4;
      }
      out.push({
        part: rp.name,
        cell: [
          Math.floor(c[0] - local[0] * 0.5),
          Math.floor(c[1] - local[1] * 0.5),
          Math.floor(c[2] - local[2] * 0.5),
        ] as const,
        face: faceWord(local),
        rgb: hex(mesh.colors[n0]!, mesh.colors[n0 + 1]!, mesh.colors[n0 + 2]!),
        world: w as readonly [number, number, number],
        normal: quatRotateVec3(wt.quat, local),
      });
    }
  }
  return out;
}

/**
 * Pairs of faces that occupy the same place, point the same way, and disagree
 * about their colour.
 *
 * Same-COLOUR coincidence is left out on purpose: the two faces also share a
 * normal, so they shade identically and whichever the renderer picks draws the
 * same pixel. It is a real coincidence and an invisible one — the reference
 * humanoid carries forty-four of them and shows nothing.
 *
 * OPPOSED normals are left out for a different reason: back-face culling keeps
 * exactly one of them, whichever side the camera is on, so they never compete.
 */
export function findClashes(asm: Assembly, opts: ClashOptions): Clash[] {
  const faces = facesOf(asm);
  // One bucket per world cell, scanned against its 26 neighbours: the pairs
  // that matter are within a fraction of a voxel, so the whole-model O(n^2)
  // is not worth paying on a five-thousand-face model.
  const buckets = new Map<string, Face[]>();
  const key = (p: readonly number[]): string =>
    `${Math.round(p[0]!)},${Math.round(p[1]!)},${Math.round(p[2]!)}`;
  for (const f of faces) {
    const k = key(f.world);
    const b = buckets.get(k);
    if (b === undefined) buckets.set(k, [f]);
    else b.push(f);
  }
  const out: Clash[] = [];
  const seen = new Set<string>();
  for (const f of faces) {
    const [bx, by, bz] = [
      Math.round(f.world[0]),
      Math.round(f.world[1]),
      Math.round(f.world[2]),
    ];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const g of buckets.get(`${bx + dx},${by + dy},${bz + dz}`) ?? []) {
            if (g === f) continue;
            if (g.rgb === f.rgb) continue;
            const dot =
              f.normal[0] * g.normal[0] +
              f.normal[1] * g.normal[1] +
              f.normal[2] * g.normal[2];
            if (dot < 0.98) continue;
            const d = Math.hypot(
              f.world[0] - g.world[0],
              f.world[1] - g.world[1],
              f.world[2] - g.world[2],
            );
            if (d > opts.maxDistance) continue;
            const [a, b] =
              f.part < g.part || (f.part === g.part && f.rgb < g.rgb)
                ? [f, g]
                : [g, f];
            const id = `${a.part}|${a.cell.join(',')}|${a.face}|${b.part}|${b.cell.join(',')}|${b.face}`;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({
              distance: d,
              a: { part: a.part, cell: a.cell, face: a.face, rgb: a.rgb },
              b: { part: b.part, cell: b.cell, face: b.face, rgb: b.rgb },
              world: a.world,
            });
          }
        }
      }
    }
  }
  // Tightest first: an exactly coincident pair is certain, and the further
  // apart two surfaces are the more the verdict depends on the viewing
  // distance and the depth buffer.
  out.sort((p, q) => p.distance - q.distance || (p.a.part < q.a.part ? -1 : 1));
  return out;
}

function n3(v: number): string {
  return v.toFixed(3);
}

function side(s: ClashSide): string {
  return `${s.part} cell(${s.cell.join(',')}) ${s.face} ${s.rgb}`;
}

export function formatClashes(
  name: string,
  faceCount: number,
  clashes: readonly Clash[],
  opts: ClashOptions,
): string {
  const out: string[] = [`model: ${name}`, `faces: ${faceCount}`, ''];
  const exact = clashes.filter((c) => c.distance < 0.005).length;
  const tight = clashes.filter((c) => c.distance >= 0.005 && c.distance < 0.15).length;
  const loose = clashes.length - exact - tight;
  for (const c of clashes.slice(0, opts.top)) {
    out.push(
      `clash d=${n3(c.distance)}  ${side(c.a)}  vs  ${side(c.b)}` +
        `  world(${c.world.map(n3).join(',')})`,
    );
  }
  if (clashes.length > opts.top) {
    out.push(`... ${clashes.length - opts.top} more (raise --top to list them)`);
  }
  if (clashes.length > 0) out.push('');
  out.push(
    `clashes: ${clashes.length}  (exact ${exact}, within 0.15 ${tight}, within ${n3(opts.maxDistance)} ${loose})`,
  );
  return out.join('\n');
}

export async function runClash(
  dir: string,
  opts: ClashOptions,
): Promise<{ text: string; exitCode: number }> {
  const loaded = await loadAndAssemble(dir);
  if (!loaded.ok) {
    return { text: `cuboidy-clash: ${loaded.message}`, exitCode: loaded.exitCode };
  }
  const asm = loaded.assembly;
  const clashes = findClashes(asm, opts);
  const faceCount = facesOf(asm).length;
  return {
    text: formatClashes(asm.manifest.name, faceCount, clashes, opts),
    // Clean is silence-adjacent, not silence: the summary line always prints
    // so a reader can tell "checked, none" from "never ran".
    exitCode: clashes.length > 0 ? 1 : 0,
  };
}
