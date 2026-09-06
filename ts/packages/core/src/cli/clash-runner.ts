import { loadAndAssemble, type Assembly } from './assemble.js';
import { buildMesh } from '../mesh.js';
import { sampleAnimation, sampleTimes, type Pose } from '../animation.js';
import {
  composeScale,
  computeWorldTransforms,
  localPointToWorld,
  pivotRotsOf,
  quatRotateVec3,
} from '../rig-transform.js';
import type { Vec3Tuple } from '../geometry/types.js';
import { AIR } from '../geometry/voxel-row.js';

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
  /** How far apart the two planes are, along the normal. Zero is coplanar. */
  distance: number;
  a: ClashSide;
  b: ClashSide;
  /** Where the pair sits in the assembled model. */
  world: readonly [number, number, number];
  /**
   * True when solid geometry stands between this pair and the outside, so
   * nothing can ever see it fight. Roughly a fifth to two thirds of the pairs
   * in a rigged model are like this -- a shoulder inside an arm, a hip inside
   * a thigh -- and counting them beside the visible ones makes two models
   * incomparable, since the ratio is a property of how deeply THAT rig nests.
   */
  hidden: boolean;
}

export interface ClashOptions {
  /**
   * Report a pair whose PLANES are within this many voxels of each other,
   * measured along the shared normal. Coincident surfaces on the integer
   * lattice land at exactly 0; a part carrying a rest ROTATION lands near but
   * not on its neighbour, which is why a distance and not an equality test.
   *
   * Along the normal, and only along it. Centre-to-centre distance was the
   * first thing tried and it is wrong: it mixes the separation of the two
   * planes, which is what a depth buffer fights over, with how far the faces
   * slide past each other IN the plane, which only decides whether they
   * overlap at all. Two faces sitting on exactly the same plane but offset
   * half a cell sideways still cover half of each other and still fight, and
   * a centre-distance test scored them as far apart. On this cast it missed
   * about two pairs in three -- and called a model with fourteen of them
   * perfectly clean.
   */
  maxDistance: number;
  /** Longest listing before it is truncated; the summary still counts all. */
  top: number;
  /**
   * One SPEC §6.3 clip to narrow to. Undefined means EVERY clip the model
   * declares, which is the default because the alternative was measured and
   * it lies: a yeti reads 2 visible at rest and 218 partway through its
   * attack, and the rest number is not a weak signal of the other, it is
   * unrelated. Checking only the rest pose is a real option -- it is twenty
   * times quicker -- but it has to be asked for, or the quick answer is the
   * one that gets reported as clean.
   *
   * The rest pose is always evaluated and always reported first, because it
   * is the baseline the others are read against: a seam that fights in every
   * pose is a build fault, and one that appears only past a certain angle is
   * a clearance fault, and the two are fixed differently.
   */
  anim?: string | undefined;
  /** Skip every clip and check the rest pose alone. */
  restOnly?: boolean | undefined;
  /** Pin one time in seconds instead of sweeping. */
  time?: number | undefined;
  /**
   * Equal steps to cut each clip into when `time` is not pinned; see
   * `sampleTimes`, which decides the times and is shared with
   * cuboidy-overlap. A one-shot clip yields one more pose than steps,
   * because its end is a pose of its own.
   */
  samples: number;
}

/**
 * Half the offset the joint rule asks for, so a joint fixed that way reads
 * clean and the check does not fight the rule it exists to support.
 *
 * 0.3 was a guess and it was too generous by nearly two orders of magnitude.
 * Measured: two same-sized segments meeting flush dither visibly, and a
 * child scaled 0.99 across the bone -- 0.003 voxels of separation, the
 * smallest step tried -- renders with a clean boundary. Any real separation
 * resolves it, because a rasterizer only has to break a tie.
 *
 * That measurement is the software rasterizer in cuboidy-snap. A GPU depth
 * buffer has finite precision and can still fight at long range on a
 * separation this small, which is why the authoring rule asks for 0.01 --
 * twice this -- rather than the least that measured clean.
 */
export const DEFAULT_MAX_DISTANCE = 0.005;

/**
 * EVEN on purpose: an even number of steps always lands on the clip's
 * midpoint, which is where a swing that goes out and comes back reaches
 * furthest. See `sampleTimes`.
 *
 * 32 and not 8, because 8 was measured and it is not a bar anyone can sign
 * off against. Eight division points only ever look at eight moments, and a
 * pair that crosses between them is invisible. Across a fleet of seventeen
 * models, nine of which had been declared "0 in every pose" on the strength
 * of the 8-sample sweep, raising it to 32 found faults in every one: a yeti
 * at 24, a bear at 9, a camel at 6, a zombie at 4, and 2 apiece on five
 * more. Only the models whose authors had raised the count themselves came
 * through clean.
 *
 * The cost is small and was measured too, on the heaviest model in that
 * fleet: 3.7s at 8 divisions and 5.2s at 32, because most of the work is
 * building the faces rather than the poses. 64 is 10.2s and finds almost
 * nothing 32 misses -- the yeti reports the same 24 at both.
 *
 * There is a bound worth knowing rather than sweeping for. Normals pair at
 * `dot >= 0.98`, which is 11.478 degrees, and the lateral cut-off is 0.95,
 * so a coplanar pair needs about `0.95 * tan(11.478) = 0.193` voxels of
 * separation before no rotation inside the gate can bring it back. Anything
 * less is a bet on where the samples happen to fall, at any count.
 */
export const DEFAULT_SAMPLES = 32;

/**
 * How far two faces may slide past each other in their shared plane and still
 * cover any of each other, as a FRACTION of the pair's own size: 1 is the
 * offset at which they meet along an edge and stop overlapping, and a hair
 * under it, because a pair that meets only along an edge is not a fight.
 *
 * A fraction and not a length in voxels, because a drawn face is one cell
 * square only at rest. A clip's `scale` resizes a part's voxels, so on a
 * squash-and-stretch model the faces are not unit-sized, and a fixed
 * 0.95-VOXEL limit then reads every colour BAND boundary on a squashed wall
 * as a clash -- abutting faces, never overlapping, whose centres the squash
 * simply pulled under the constant. Measured on the slime, whose idle passes
 * through a body scale of 0.95: at 0.950308 the sweep reports 6 and at
 * 0.950000 it reports 74, on geometry that did not change. Normalising by the
 * faces' real extent removes that cliff and leaves every unit-scale model's
 * numbers exactly as they were, since two unit half-extents sum to 1.
 */
const LATERAL_LIMIT = 0.95;
export const DEFAULT_TOP = 40;

interface Face {
  part: string;
  cell: readonly [number, number, number];
  face: string;
  rgb: string;
  world: readonly [number, number, number];
  normal: readonly [number, number, number];
  /**
   * The face's two in-plane HALF-edges, in world space. A drawn face is one
   * local cell square, so at rest these are half unit vectors -- but a clip's
   * `scale` resizes a part's voxels, and that resizing lands here. Measuring
   * them rather than assuming them is what keeps LATERAL_LIMIT honest on a
   * squash-and-stretch model.
   */
  u: readonly [number, number, number];
  v: readonly [number, number, number];
}

const AXES = ['X', 'Y', 'Z'] as const;

function dot3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * A face's half-extent across `dir`: the length of whichever of its two edges
 * lies more nearly along that direction.
 *
 * Its own edge LENGTH, deliberately, and not the support of the rectangle --
 * which is what a face turned within its plane would project onto `dir`. The
 * support is the more correct answer to "could these two rectangles overlap",
 * and adopting it here turns this into a separating-axis test that finds every
 * corner-on-corner sliver two rest ROTATIONS leave behind: measured across the
 * mob fleet it raised eleven models by a fifth to a half, none of which is a
 * seam anybody would go and edit. This check under-reports on purpose, so the
 * rotation stays out of it and only the SIZE is read off the geometry.
 */
function halfSpan(f: Face, dir: readonly [number, number, number]): number {
  const u = Math.hypot(f.u[0], f.u[1], f.u[2]);
  const v = Math.hypot(f.v[0], f.v[1], f.v[2]);
  return Math.abs(dot3(f.u, dir)) >= Math.abs(dot3(f.v, dir)) ? u : v;
}

function unit(
  v: readonly [number, number, number],
): [number, number, number] | undefined {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n === 0 ? undefined : [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * How far two coplanar faces have slid past each other, measured in units of
 * how far they COULD slide before they stopped covering each other -- so 1 is
 * edge to edge whatever size a clip has scaled them to.
 *
 * Read on the first face's own in-plane axes, and combined as a radius rather
 * than per axis, which inscribes an ellipse in the overlap rectangle and so
 * trims its corners. That under-reports slightly, which is the safe direction
 * for a check whose findings cost an edit, and it is what this did before the
 * measurement moved from voxels to fractions: at unit scale the two forms are
 * the same arithmetic, so every model that scales nothing reports what it
 * always reported -- verified across the seventeen mobs, where only the one
 * squash-and-stretch model moved.
 */
function lateralSlide(
  f: Face,
  g: Face,
  off: readonly [number, number, number],
): number {
  const uHat = unit(f.u);
  const vHat = unit(f.v);
  if (uHat === undefined || vHat === undefined) return Infinity;
  const su = halfSpan(f, uHat) + halfSpan(g, uHat);
  const sv = halfSpan(f, vHat) + halfSpan(g, vHat);
  if (su <= 0 || sv <= 0) return Infinity;
  return Math.hypot(dot3(off, uHat) / su, dot3(off, vHat) / sv);
}

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
export function facesOf(
  asm: Assembly,
  poses?: ReadonlyMap<string, Pose>,
): Face[] {
  const world = computeWorldTransforms(
    asm.manifest.parts,
    pivotRotsOf(asm.resolvedParts.map((rp) => [rp.name, rp.part] as const)),
    poses,
  );
  const out: Face[] = [];
  for (const rp of asm.resolvedParts) {
    const wt = world.get(rp.name);
    if (wt === undefined) continue;
    const pose = poses?.get(rp.name);
    // A clip that hides a part hides its surfaces too. Counting a clash on
    // something the pose does not draw would report a fault nobody can see.
    if (pose !== undefined && !pose.visible) continue;
    const mesh = buildMesh(rp.part, rp.palette);
    const piv: Vec3Tuple = [
      rp.part.pivot.pos.x,
      rp.part.pivot.pos.y,
      rp.part.pivot.pos.z,
    ];
    const scale = composeScale(rp.scale, pose?.scale);
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
      // The corners are kept, not just averaged: the two edges leaving corner
      // 0 are the face's in-plane axes AND its size along them, and the size
      // is what a clip's scale changes. `mesh.ts` lists a quad's corners as a
      // ring, so 0->1 and 0->3 are its two edges on whichever face this is.
      const corner: [number, number, number][] = [];
      for (let k = 0; k < 4; k++) {
        const at = (f * 4 + k) * 3;
        const p: Vec3Tuple = [
          mesh.positions[at]!,
          mesh.positions[at + 1]!,
          mesh.positions[at + 2]!,
        ];
        for (let i = 0; i < 3; i++) c[i]! += p[i]! / 4;
        const wp = localPointToWorld(p, piv, scale, wt);
        corner.push([wp[0], wp[1], wp[2]]);
        for (let i = 0; i < 3; i++) w[i]! += wp[i]! / 4;
      }
      const halfEdge = (k: number): [number, number, number] => [
        (corner[k]![0] - corner[0]![0]) / 2,
        (corner[k]![1] - corner[0]![1]) / 2,
        (corner[k]![2] - corner[0]![2]) / 2,
      ];
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
        u: halfEdge(1),
        v: halfEdge(3),
      });
    }
  }
  return out;
}

/**
 * Is this world point inside anybody's voxel? The inverse of
 * `localPointToWorld`, run against every part: rotate the offset back by the
 * conjugate, undo the scale, add the pivot, and index the grid.
 */
function occupancyOf(
  asm: Assembly,
  poses?: ReadonlyMap<string, Pose>,
): (p: readonly [number, number, number]) => boolean {
  const world = computeWorldTransforms(
    asm.manifest.parts,
    pivotRotsOf(asm.resolvedParts.map((rp) => [rp.name, rp.part] as const)),
    poses,
  );
  const entries = asm.resolvedParts
    .filter((rp) => poses?.get(rp.name)?.visible !== false)
    .map((rp) => ({
      part: rp.part,
      wt: world.get(rp.name),
      scale: composeScale(rp.scale, poses?.get(rp.name)?.scale),
    }))
    .filter((e): e is { part: typeof e.part; wt: NonNullable<typeof e.wt>; scale: typeof e.scale } =>
      e.wt !== undefined,
    );
  return (p) => {
    for (const e of entries) {
      const q = e.wt.quat;
      const l = quatRotateVec3([-q[0], -q[1], -q[2], q[3]], [
        p[0] - e.wt.pos[0],
        p[1] - e.wt.pos[1],
        p[2] - e.wt.pos[2],
      ]);
      const [sx, sy, sz] = e.scale ?? [1, 1, 1];
      const piv = e.part.pivot.pos;
      const x = Math.floor(piv.x + l[0] / sx);
      const y = Math.floor(piv.y + l[1] / sy);
      const z = Math.floor(piv.z + l[2] / sz);
      if (x < 0 || y < 0 || z < 0) continue;
      if (x >= e.part.size.w || y >= e.part.size.h || z >= e.part.size.d) continue;
      if ((e.part.voxels[y]?.[z]?.[x] ?? AIR) !== AIR) return true;
    }
    return false;
  };
}

/**
 * Does anything stand between this pair and the outside? Marched along the
 * shared normal, which is a CONSERVATIVE test: a solid cell directly in front
 * hides the pair from every direction, while an empty line of sight proves
 * only that one direction is open. So it can call a pair visible that a
 * glancing view would not reach, and never the other way round.
 */
function occluded(
  solidAt: (p: readonly [number, number, number]) => boolean,
  from: readonly [number, number, number],
  normal: readonly [number, number, number],
  reach: number,
): boolean {
  // A quarter of a cell: a one-voxel wall is four samples thick, so nothing
  // solid can be stepped over.
  const STEP = 0.25;
  for (let t = STEP; t <= reach; t += STEP) {
    if (
      solidAt([
        from[0] + normal[0] * t,
        from[1] + normal[1] * t,
        from[2] + normal[2] * t,
      ])
    ) {
      return true;
    }
  }
  return false;
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
export function findClashes(
  asm: Assembly,
  opts: ClashOptions,
  poses?: ReadonlyMap<string, Pose>,
): Clash[] {
  const faces = facesOf(asm, poses);
  // From the SAME poses as the faces. Occlusion is a property of the pose:
  // an arm that hides a seam at rest can swing off it, and testing a bent
  // pose's surfaces against the rest body would call that seam hidden.
  const solidAt = occupancyOf(asm, poses);
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
  // How far a probe has to travel to be sure it left the model: the widest
  // span of the thing, plus a margin. Anything shorter reports a deep pair as
  // visible because the ray ran out inside the body.
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const f of faces) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, f.world[i]!);
      hi[i] = Math.max(hi[i]!, f.world[i]!);
    }
  }
  const reach = Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) + 4;

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
            // Split the offset into the part that separates the planes and
            // the part that slides along them.
            const dx = g.world[0] - f.world[0];
            const dy = g.world[1] - f.world[1];
            const dz = g.world[2] - f.world[2];
            const d = Math.abs(dx * f.normal[0] + dy * f.normal[1] + dz * f.normal[2]);
            if (d > opts.maxDistance) continue;
            // Two faces on one plane cover each other while their centres are
            // less than the sum of their half-extents apart. The mesher merges
            // nothing, so that sum is one cell -- until a clip scales one of
            // them, which is why it is read off the faces themselves.
            const lat = lateralSlide(f, g, [dx, dy, dz]);
            if (lat >= LATERAL_LIMIT) continue;
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
              hidden: occluded(solidAt, a.world, a.normal, reach),
            });
          }
        }
      }
    }
  }
  // Tightest first: an exactly coincident pair is certain, and the further
  // apart two surfaces are the more the verdict depends on the viewing
  // distance and the depth buffer.
  // Visible first, then tightest. A hidden pair is real and worth counting but
  // is never the one to fix first.
  out.sort(
    (p, q) =>
      Number(p.hidden) - Number(q.hidden) ||
      p.distance - q.distance ||
      (p.a.part < q.a.part ? -1 : 1),
  );
  return out;
}

function n3(v: number): string {
  return v.toFixed(3);
}

function side(s: ClashSide): string {
  return `${s.part} cell(${s.cell.join(',')}) ${s.face} ${s.rgb}`;
}

/** One evaluated pose: what it is called, and what fought in it. */
export interface PoseClashes {
  /** `rest`, or `<clip> t=<seconds>`. */
  label: string;
  clashes: Clash[];
}

function visibleCount(p: PoseClashes): number {
  return p.clashes.filter((c) => !c.hidden).length;
}

export function formatClashes(
  name: string,
  faceCount: number,
  poses: readonly PoseClashes[],
  opts: ClashOptions,
): string {
  const out: string[] = [`model: ${name}`, `faces: ${faceCount}`, ''];
  // The listing describes the pose with the most to fix. Printing every
  // pose's listing buries it; printing only the rest pose's is what made a
  // sweep worth nothing.
  const worst = poses.reduce((a, b) => (visibleCount(b) > visibleCount(a) ? b : a));
  const rest = poses[0]!;
  if (poses.length > 1) {
    const w = Math.max(...poses.map((p) => p.label.length));
    for (const p of poses) {
      const v = visibleCount(p);
      out.push(
        `pose  ${p.label.padEnd(w)}  ${String(v).padStart(4)} visible` +
          `  + ${p.clashes.length - v} hidden` +
          (p === worst && poses.length > 1 ? '   <- listed below' : ''),
      );
    }
    out.push('');
  }
  const clashes = worst.clashes;
  const seen = clashes.filter((c) => !c.hidden);
  const hidden = clashes.length - seen.length;
  const exact = seen.filter((c) => c.distance < 0.005).length;
  const tight = seen.filter((c) => c.distance >= 0.005 && c.distance < 0.15).length;
  const loose = seen.length - exact - tight;
  for (const c of clashes.slice(0, opts.top)) {
    out.push(
      `clash d=${n3(c.distance)}${c.hidden ? ' [hidden]' : '         '}  ` +
        `${side(c.a)}  vs  ${side(c.b)}` +
        `  world(${c.world.map(n3).join(',')})`,
    );
  }
  // Only when a listing was actually asked for: `--top=0` means "the count is
  // the answer", and a "162 more" line under it is the listing coming back.
  if (opts.top > 0 && clashes.length > opts.top) {
    out.push(`... ${clashes.length - opts.top} more (raise --top to list them)`);
  }
  if (opts.top > 0 && clashes.length > 0) out.push('');
  out.push(
    `clashes: ${seen.length} visible  ` +
      `(exact ${exact}, within 0.15 ${tight}, within ${n3(opts.maxDistance)} ${loose})` +
      `  + ${hidden} hidden inside the model` +
      (poses.length > 1
        ? `  [worst of ${poses.length} poses: ${worst.label}; rest ${visibleCount(rest)}]`
        : ''),
  );
  return out.join('\n');
}

export async function runClash(
  dir: string,
  opts: ClashOptions,
): Promise<{ text: string; exitCode: number }> {
  // Contradictory rather than merely redundant: one says which clip to bend
  // by, the other says not to bend at all. Silently picking a winner is how a
  // run gets read as a sweep that never happened.
  if (opts.restOnly === true && (opts.anim !== undefined || opts.time !== undefined)) {
    return {
      text: 'cuboidy-clash: rest-only cannot be combined with a clip or a pinned time\n',
      exitCode: 2,
    };
  }
  const loaded = await loadAndAssemble(dir);
  if (!loaded.ok) {
    return { text: `cuboidy-clash: ${loaded.message}`, exitCode: loaded.exitCode };
  }
  const asm = loaded.assembly;

  // The rest pose is index 0 and always present: every other pose is read
  // against it.
  const poses: PoseClashes[] = [
    { label: 'rest', clashes: findClashes(asm, opts) },
  ];
  if (opts.restOnly !== true) {
    const names =
      opts.anim === undefined || opts.anim === 'all'
        ? [...asm.animations.keys()].sort()
        : [opts.anim];
    for (const n of names) {
      const clip = asm.animations.get(n);
      if (clip === undefined) {
        const known = [...asm.animations.keys()].sort().join(', ');
        return {
          text:
            `cuboidy-clash: model has no animation "${n}"` +
            `${known === '' ? '' : ` (has: ${known})`}\n`,
          exitCode: 2,
        };
      }
      // A pinned time is one pose; otherwise the shared rule, so this and
      // cuboidy-overlap cannot disagree about which poses a clip has.
      const times =
        opts.time !== undefined ? [opts.time] : sampleTimes(clip, opts.samples);
      for (const t of times) {
        poses.push({
          label: `${n} t=${t.toFixed(3)}`,
          clashes: findClashes(asm, opts, sampleAnimation(clip, t)),
        });
      }
    }
  }

  const faceCount = facesOf(asm).length;
  return {
    text: formatClashes(asm.manifest.name, faceCount, poses, opts),
    // Clean is silence-adjacent, not silence: the summary line always prints
    // so a reader can tell "checked, none" from "never ran".
    // Gated on what can be SEEN. A model whose only clashes are buried has
    // nothing an author could act on, and failing it would train people to
    // ignore the check. Any pose counts: a seam that only fights mid-swing
    // is still a seam the player watches flicker.
    exitCode: poses.some((p) => p.clashes.some((c) => !c.hidden)) ? 1 : 0,
  };
}
