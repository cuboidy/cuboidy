import { loadAndAssemble, type Assembly } from './assemble.js';
import { sampleAnimation, type Pose } from '../animation.js';
import {
  composeScale,
  computeWorldTransforms,
  localPointToWorld,
  pivotRotsOf,
  quatRotateVec3,
  type WorldTransform,
} from '../rig-transform.js';
import { AIR } from '../geometry/voxel-row.js';
import type { Part, Vec3Tuple } from '../geometry/types.js';

// cuboidy-overlap: parts that hold the same space when they have no business
// touching — the other overlap, and a different problem from the one
// cuboidy-clash reports.
//
// READ THIS BEFORE ACTING ON THE NUMBERS. Overlapping volume is not a fault
// and reducing it is not the goal. A joint is BUILT by burying the child in
// the parent; that is what stops it tearing open when a clip swings it, and a
// model with none of it is a model that comes apart. Chasing the total down is
// how you break a rig.
//
// What is worth finding is overlap between parts that are not joined. An arm
// inside a thigh is not a joint technique, it is two limbs in one place, and
// no amount of pivot or scale work is the fix — the parts are mispositioned.
// That is what the rig distance beside each pair is for.
//
// The two get confused because they share a cause. cuboidy-clash finds
// SURFACES in one place, which is a rendering fault: the depth buffer has no
// way to choose and the seam dithers or flickers. This finds VOLUME in one
// place, which renders perfectly well — the inner cells simply never emit a
// face.
//
// They are kept apart because the fixes pull in opposite directions. A clash
// is fixed by moving a surface off its neighbour's plane; an overlap is fixed
// by deleting cells. Run them together and it is easy to delete the cells that
// were holding a joint shut.
//
// Which is why the census splits. A cell buried at rest and buried at every
// pose of every clip is DEAD: nothing will ever see it and nothing depends on
// it. A cell buried at rest that a clip UNCOVERS is the overlap doing its job
// -- it is what stops a joint tearing open mid-swing, and deleting it is how
// you get a hole. On the model this was written for, one part's arms were 57%
// buried and looked like the worst waste in the rig; they turned out to be 49
// dead cells against 145 covering ones, the best ratio in the model.

/** Overlap between parts this far apart in the rig is not a joint. */
export const STRANGER_DISTANCE = 3;

export interface PartOverlap {
  part: string;
  /** Solid cells in the part. */
  cells: number;
  /** Cells sitting inside another part in the REST pose. */
  buriedAtRest: number;
  /** Buried at rest and at every sampled pose of every clip. */
  dead: number;
  /** Buried at rest but uncovered by some pose — the overlap earning its keep. */
  covering: number;
  /**
   * Who it is buried in, most cells first, each with how far apart the two
   * parts are in the rig. 1 is a joint and 2 is a part reaching past its
   * parent into its grandparent; both are how models are built. 3 or more
   * means two parts that are not structurally near each other are in the same
   * place, which is the finding worth acting on.
   */
  insideOf: readonly { part: string; cells: number; rigDistance: number }[];
}

export interface OverlapOptions {
  /** Poses to sample per clip. 0 leaves the census at the rest pose alone. */
  samples: number;
  /** Longest listing before it is truncated. */
  top: number;
}

export const DEFAULT_SAMPLES = 8;
export const DEFAULT_TOP = 40;

interface Placed {
  name: string;
  part: Part;
  wt: WorldTransform;
  scale: Vec3Tuple | undefined;
}

function place(
  asm: Assembly,
  poses: ReadonlyMap<string, Pose> | undefined,
): Placed[] {
  const world = computeWorldTransforms(
    asm.manifest.parts,
    pivotRotsOf(asm.resolvedParts.map((rp) => [rp.name, rp.part] as const)),
    poses,
  );
  const out: Placed[] = [];
  for (const rp of asm.resolvedParts) {
    const pose = poses?.get(rp.name);
    // A part a clip has hidden holds no volume while it is hidden.
    if (pose !== undefined && !pose.visible) continue;
    const wt = world.get(rp.name);
    if (wt === undefined) continue;
    out.push({
      name: rp.name,
      part: rp.part,
      wt,
      scale: composeScale(rp.scale, pose?.scale),
    });
  }
  return out;
}

/**
 * The nine points a cell is tested by: its eight corners, pulled a twentieth
 * of a cell inward so a shared face does not read as an intersection, plus the
 * centre to catch a cavity the corners would straddle.
 *
 * A cell is only counted buried when ALL of them are inside another part,
 * because that is the question being asked — can this cell be deleted without
 * changing what renders. A cell half inside another still shows its other
 * half. Testing the centre alone answers neither "does it touch" nor "is it
 * covered", and on a model whose rest pose carries rotations the three answers
 * are nowhere near each other: one humanoid here reads 48% by touch, 35% by
 * centre and 15% fully covered.
 */
const PROBES: readonly (readonly [number, number, number])[] = [
  [0.5, 0.5, 0.5],
  [0.05, 0.05, 0.05], [0.95, 0.05, 0.05], [0.05, 0.95, 0.05], [0.95, 0.95, 0.05],
  [0.05, 0.05, 0.95], [0.95, 0.05, 0.95], [0.05, 0.95, 0.95], [0.95, 0.95, 0.95],
];

/** Every solid cell of a part, as its nine probe points, in grid order. */
function centres(p: Placed): [number, number, number][][] {
  const { w, h, d } = p.part.size;
  const piv = p.part.pivot.pos;
  const pivot: Vec3Tuple = [piv.x, piv.y, piv.z];
  const out: [number, number, number][][] = [];
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        if ((p.part.voxels[y]?.[z]?.[x] ?? AIR) === AIR) continue;
        out.push(
          PROBES.map((o) => {
            const q = localPointToWorld(
              [x + o[0], y + o[1], z + o[2]],
              pivot,
              p.scale,
              p.wt,
            );
            return [q[0], q[1], q[2]] as [number, number, number];
          }),
        );
      }
    }
  }
  return out;
}

/** Is every probe point of this cell inside that part? */
function covers(p: Placed, cell: readonly [number, number, number][]): boolean {
  for (const at of cell) if (!holds(p, at)) return false;
  return true;
}

/** Is this world point inside that part's solid volume? */
function holds(p: Placed, at: readonly [number, number, number]): boolean {
  const q = p.wt.quat;
  const l = quatRotateVec3([-q[0], -q[1], -q[2], q[3]], [
    at[0] - p.wt.pos[0],
    at[1] - p.wt.pos[1],
    at[2] - p.wt.pos[2],
  ]);
  const [sx, sy, sz] = p.scale ?? [1, 1, 1];
  const piv = p.part.pivot.pos;
  const x = Math.floor(piv.x + l[0] / sx);
  const y = Math.floor(piv.y + l[1] / sy);
  const z = Math.floor(piv.z + l[2] / sz);
  const { w, h, d } = p.part.size;
  if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) return false;
  return (p.part.voxels[y]?.[z]?.[x] ?? AIR) !== AIR;
}

/**
 * Steps between two parts along the rig's parent links. A joint is 1; a part
 * reaching past its parent into its grandparent, or two body sections stacked
 * as siblings, is 2. Anything further apart has no structural reason to share
 * space.
 */
function rigDistances(asm: Assembly): Map<string, Map<string, number>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    let set = adj.get(a);
    if (set === undefined) adj.set(a, (set = new Set()));
    set.add(b);
  };
  for (const p of asm.manifest.parts) {
    if (!adj.has(p.name)) adj.set(p.name, new Set());
    if (p.parent === undefined) continue;
    link(p.name, p.parent);
    link(p.parent, p.name);
  }
  const out = new Map<string, Map<string, number>>();
  for (const start of adj.keys()) {
    const seen = new Map<string, number>([[start, 0]]);
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? []) {
        if (seen.has(nb)) continue;
        seen.set(nb, seen.get(cur)! + 1);
        queue.push(nb);
      }
    }
    out.set(start, seen);
  }
  return out;
}

export function findOverlap(
  asm: Assembly,
  opts: OverlapOptions,
): PartOverlap[] {
  const rest = place(asm, undefined);
  const distance = rigDistances(asm);
  // Cell order is stable across poses (the grid walk is the same), so a cell
  // can be tracked by its index without carrying coordinates around.
  const restCells = new Map<string, [number, number, number][][]>();
  for (const p of rest) restCells.set(p.name, centres(p));

  const buried = new Map<string, boolean[]>();
  const insideOf = new Map<string, Map<string, number>>();
  for (const p of rest) {
    const cs = restCells.get(p.name)!;
    const flags = new Array<boolean>(cs.length).fill(false);
    const who = new Map<string, number>();
    for (let i = 0; i < cs.length; i++) {
      for (const q of rest) {
        if (q.name === p.name) continue;
        if (!covers(q, cs[i]!)) continue;
        flags[i] = true;
        who.set(q.name, (who.get(q.name) ?? 0) + 1);
      }
    }
    buried.set(p.name, flags);
    insideOf.set(p.name, who);
  }

  // A cell starts out assumed dead and is cleared the first time any pose
  // uncovers it. Absent clips, everything buried at rest counts as dead:
  // nothing can uncover it, so nothing is holding a joint shut either.
  const stillDead = new Map<string, boolean[]>();
  for (const [name, flags] of buried) stillDead.set(name, [...flags]);

  if (opts.samples > 0) {
    for (const [, clip] of asm.animations) {
      for (let s = 0; s < opts.samples; s++) {
        const t = (clip.duration * s) / opts.samples;
        const posed = place(asm, sampleAnimation(clip, t));
        for (const p of posed) {
          const dead = stillDead.get(p.name);
          if (dead === undefined) continue;
          const cs = centres(p);
          for (let i = 0; i < cs.length && i < dead.length; i++) {
            if (!dead[i]) continue;
            let covered = false;
            for (const q of posed) {
              if (q.name === p.name) continue;
              if (covers(q, cs[i]!)) {
                covered = true;
                break;
              }
            }
            if (!covered) dead[i] = false;
          }
        }
      }
    }
  }

  const out: PartOverlap[] = [];
  for (const p of rest) {
    const flags = buried.get(p.name)!;
    const dead = stillDead.get(p.name)!;
    const b = flags.filter(Boolean).length;
    const d = dead.filter(Boolean).length;
    out.push({
      part: p.name,
      cells: flags.length,
      buriedAtRest: b,
      dead: d,
      covering: b - d,
      insideOf: [...(insideOf.get(p.name) ?? new Map())]
        .map(([part, cells]) => ({
          part,
          cells,
          // Unreachable parts (a rig with more than one root) are as far
          // apart as it is possible to be, so they read as strangers.
          rigDistance: distance.get(p.name)?.get(part) ?? Infinity,
        }))
        .sort((x, y) => y.cells - x.cells),
    });
  }
  // Sorted by how much of the part sits inside something it is not joined to,
  // because that is the finding. Deliberately NOT by dead weight: ranking a
  // census by what could be deleted invites deleting it, and most of what is
  // buried is a joint doing its job.
  const strange = (p: PartOverlap): number =>
    p.insideOf
      .filter((i) => i.rigDistance >= STRANGER_DISTANCE)
      .reduce((n, i) => n + i.cells, 0);
  out.sort((a, b) => strange(b) - strange(a) || b.buriedAtRest - a.buriedAtRest);
  return out;
}

function pct(n: number, of: number): string {
  return of === 0 ? '  -' : `${Math.round((100 * n) / of)}%`.padStart(4);
}

export function formatOverlap(
  name: string,
  parts: readonly PartOverlap[],
  sampled: boolean,
  opts: OverlapOptions,
): string {
  const cells = parts.reduce((n, p) => n + p.cells, 0);
  const buried = parts.reduce((n, p) => n + p.buriedAtRest, 0);
  const dead = parts.reduce((n, p) => n + p.dead, 0);
  const out: string[] = [`model: ${name}`, ''];

  // The finding first, because the rest of the report is background. Overlap
  // between parts the rig does not join is the thing to act on; overlap at a
  // joint is how a joint is made.
  const strangers: string[] = [];
  for (const p of parts) {
    for (const i of p.insideOf) {
      if (i.rigDistance < STRANGER_DISTANCE) continue;
      // One line per pair, not two: A inside B and B inside A are one fact.
      if (p.part > i.part) continue;
      strangers.push(
        `not joined: ${p.part} and ${i.part} share ${i.cells} cells ` +
          `(${i.rigDistance} steps apart in the rig)`,
      );
    }
  }
  if (strangers.length > 0) {
    out.push(...strangers, '');
  } else {
    out.push('no overlap between parts the rig does not join', '');
  }

  out.push(
    `${'part'.padEnd(16)}${'cells'.padStart(7)}${'buried'.padStart(8)}` +
      `${'dead'.padStart(8)}${'covering'.padStart(10)}   inside of (rig steps)`,
  );
  for (const p of parts.slice(0, opts.top)) {
    if (p.buriedAtRest === 0) continue;
    const who = p.insideOf
      .map((i) => `${i.part}(${i.cells}/${i.rigDistance})`)
      .join(' ');
    out.push(
      p.part.padEnd(16) +
        String(p.cells).padStart(7) +
        `${String(p.buriedAtRest).padStart(6)} ${pct(p.buriedAtRest, p.cells)}` +
        `${String(p.dead).padStart(6)} ${pct(p.dead, p.cells)}` +
        String(p.covering).padStart(10) +
        `   ${who}`,
    );
  }
  out.push('');
  out.push(
    `cells: ${cells}   buried at rest: ${buried} (${pct(buried, cells).trim()})` +
      `   dead: ${dead} (${pct(dead, cells).trim()})`,
  );
  // Overlap is mutual: where two parts hold one place, each is inside the
  // other, so the shared volume is counted on both sides. The per-part rows
  // are what an author acts on -- the totals are their sum, and read as
  // "cells carried", not "cells that could be removed", since resolving a
  // shared cell means deleting one side of it and not both.
  out.push('totals sum the rows; a shared cell is counted on both sides');
  if (!sampled) {
    // Said out loud, because the number means something different without
    // clips: with none sampled, every buried cell is reported dead, and a
    // cell that a swing would have uncovered is indistinguishable from one
    // that is truly never seen.
    out.push(
      'no clips sampled: "dead" here means "buried at rest", which over-counts',
    );
  }
  return out.join('\n');
}

export async function runOverlap(
  dir: string,
  opts: OverlapOptions,
): Promise<{ text: string; exitCode: number }> {
  const loaded = await loadAndAssemble(dir);
  if (!loaded.ok) {
    return { text: `cuboidy-overlap: ${loaded.message}`, exitCode: loaded.exitCode };
  }
  const asm = loaded.assembly;
  const parts = findOverlap(asm, opts);
  const sampled = opts.samples > 0 && asm.animations.size > 0;
  return {
    // Always 0: this is a census, not a gate. Overlap is not a fault — some of
    // it is load-bearing — so there is no count that should fail a build.
    text: formatOverlap(asm.manifest.name, parts, sampled, opts),
    exitCode: 0,
  };
}
