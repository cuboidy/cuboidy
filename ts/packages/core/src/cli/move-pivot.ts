import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadAndAssemble } from './assemble.js';
import { buildMesh } from '../mesh.js';
import {
  composePartRotation,
  composeScale,
  localPointToWorld,
  pivotRotsOf,
  computeRestWorldTransforms,
  quatRotateVec3,
} from '../rig-transform.js';
import type { Vec3Tuple } from '../geometry/types.js';
import {
  arrayValueSpan,
  partObjectSpan,
  vec3,
  type Span,
} from './json-splice.js';

// Moving a part's pivot WITHOUT moving the part.
//
// The pivot is the point a part turns and scales about, and where it sits is
// a modelling decision that comes up constantly: a limb wants it at the
// cross-section centre so a scale offset moves every side face, a hinge wants
// it on the axis line, a rotor arm wants it at the root of the sweep. What
// they have in common is that moving it is supposed to change how the part
// BEHAVES and not where it IS -- and doing that by hand means editing two
// files with a compensation that is easy to get subtly wrong and, once
// wrong, is close to invisible.
//
// Measured on a zombie's forearm: shifting a pivot one voxel without
// compensating left `cuboidy-lint`, `cuboidy-overlap`, the bbox and even
// `cuboidy-query --transforms` byte-identical -- the transform reports the
// PIVOT's world position, which is exactly the thing that did not move --
// while `cuboidy-clash` went 57 to 49. The single number that moves moves in
// the reassuring direction, so an author watching the clash count while
// doing a pivot pass would read parts drifting apart as progress.
//
// The maths, from SPEC §7.7. A voxel at local `v` lands at
//   world = wt.pos + wt.quat · ((v − pivot) ⊙ scale)
// and `wt.pos = parent.pos + parent.quat · position`. Moving `pivot` by `p`
// with `d = p ⊙ scale` leaves the voxel where it was when
//   position += localQ · d          (localQ = this part's OWN rest rotation)
// The parent's rotation cancels out entirely; only the part's own turns the
// correction. Then, because a child's `position` is measured from its
// PARENT'S PIVOT, every direct child needs
//   position −= d                   (no rotation: same frame)
// and nothing below that, since restoring a child's pivot restores its whole
// subtree.

export interface MovePivotResult {
  text: string;
  exitCode: number;
}

/**
 * How far the drawn surface moved between two assemblies, as the largest
 * distance any one vertex travelled.
 *
 * A tolerance rather than an equality, and the reason is arithmetic rather
 * than laziness. The correction for a part that carries a rest rotation is
 * `position + localQ · d`, and recomposing that through the same rotation
 * does not return bit-identical doubles -- floating-point addition is not
 * associative. Measured on an owl's tail, an exactly correct move landed
 * every vertex within 1e-6 voxels, which is a sixteen-millionth of a block
 * and about a thousand times finer than the format's own half-voxel grid.
 * Demanding bit equality would refuse to move a pivot on exactly the parts
 * that most need it -- the rotated ones.
 */
function surfaceDrift(
  before: Awaited<ReturnType<typeof loadAndAssemble>>,
  after: Awaited<ReturnType<typeof loadAndAssemble>>,
): number {
  const a = surfacePoints(before);
  const b = surfacePoints(after);
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let worst = 0;
  for (let i = 0; i < a.length; i += 3) {
    const dx = a[i]! - b[i]!;
    const dy = a[i + 1]! - b[i + 1]!;
    const dz = a[i + 2]! - b[i + 2]!;
    worst = Math.max(worst, Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  return worst;
}

/**
 * The largest vertex movement that still counts as "the part did not move".
 * Three orders of magnitude under a voxel, and three above the float noise
 * a correct rotated move produces.
 */
export const DRIFT_TOLERANCE = 1e-3;

/** Every drawn vertex, in world space, in a stable order. */
function surfacePoints(asm: Awaited<ReturnType<typeof loadAndAssemble>>): number[] {
  if (!('assembly' in asm)) return [];
  const a = asm.assembly;
  const world = computeRestWorldTransforms(
    a.manifest.parts,
    pivotRotsOf(a.resolvedParts.map((rp) => [rp.name, rp.part] as const)),
  );
  const out: number[] = [];
  // Part order is the assembly's, which a pivot edit does not change, so the
  // two runs line up index for index and each vertex is compared with itself
  // rather than with whichever vertex happens to sort next to it.
  for (const rp of a.resolvedParts) {
    const wt = world.get(rp.name);
    if (wt === undefined) continue;
    const mesh = buildMesh(rp.part, rp.palette);
    const piv: Vec3Tuple = [
      rp.part.pivot.pos.x,
      rp.part.pivot.pos.y,
      rp.part.pivot.pos.z,
    ];
    const scale = composeScale(rp.scale, undefined);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const p: Vec3Tuple = [
        mesh.positions[i]!,
        mesh.positions[i + 1]!,
        mesh.positions[i + 2]!,
      ];
      const w = localPointToWorld(p, piv, scale, wt);
      out.push(w[0]!, w[1]!, w[2]!);
    }
  }
  return out;
}

function splice(text: string, span: Span, replacement: string): string {
  return text.slice(0, span[0]) + replacement + text.slice(span[1]);
}

/** Insert `"position": [...]` into a part object that has none. */
function insertPosition(text: string, obj: Span, value: string): string {
  // After the name, which every part object has, so the key lands where a
  // reader expects rather than at the front of the object.
  const nameAt = text.indexOf('"name"', obj[0]);
  const comma = text.indexOf(',', nameAt);
  const at = comma > 0 && comma < obj[1] ? comma + 1 : obj[0] + 1;
  return `${text.slice(0, at)} "position": ${value},${text.slice(at)}`;
}

export async function runMovePivot(
  dir: string,
  part: string,
  to: Vec3Tuple,
  opts: { dryRun?: boolean } = {},
): Promise<MovePivotResult> {
  const root = resolve(dir);
  const before = await loadAndAssemble(root);
  if (!('assembly' in before)) {
    return { text: `cuboidy-part: ${before.message}`, exitCode: before.exitCode };
  }
  const asm = before.assembly;
  const rp = asm.resolvedParts.find((p) => p.name === part);
  if (rp === undefined) {
    const known = asm.resolvedParts.map((p) => p.name).sort().join(', ');
    return {
      text: `cuboidy-part: no part "${part}" in ${root} (has: ${known})\n`,
      exitCode: 1,
    };
  }

  const from: Vec3Tuple = [
    rp.part.pivot.pos.x,
    rp.part.pivot.pos.y,
    rp.part.pivot.pos.z,
  ];
  const delta: Vec3Tuple = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  if (delta.every((v) => Math.abs(v) < 1e-9)) {
    return { text: `pivot of "${part}" is already at ${vec3(to)}\n`, exitCode: 0 };
  }
  const scale = composeScale(rp.scale, undefined) ?? [1, 1, 1];
  const d: Vec3Tuple = [
    delta[0] * scale[0],
    delta[1] * scale[1],
    delta[2] * scale[2],
  ];

  // Which geometry file holds the part, and where the manifest names it.
  const manifestPath = join(root, 'cuboidy.json');
  const manifestText = await readFile(manifestPath, 'utf8');
  const mp = asm.manifest.parts.find((p) => p.name === part);
  if (mp === undefined) {
    return { text: `cuboidy-part: "${part}" is not in the manifest\n`, exitCode: 1 };
  }

  // The part's OWN rest rotation, which is what turns its correction.
  const localQ = composePartRotation(
    mp.rotation,
    rp.part.pivot.rot === undefined
      ? undefined
      : [rp.part.pivot.rot.x, rp.part.pivot.rot.y, rp.part.pivot.rot.z],
    undefined,
  );
  const corr = quatRotateVec3(localQ, d);

  let text = manifestText;
  const own = partObjectSpan(text, part);
  if (own === null) {
    return { text: `cuboidy-part: cannot locate "${part}" in the manifest\n`, exitCode: 1 };
  }
  const basePos = mp.position ?? [0, 0, 0];
  const newPos: Vec3Tuple = [
    basePos[0] + corr[0]!,
    basePos[1] + corr[1]!,
    basePos[2] + corr[2]!,
  ];
  const ownPosSpan = arrayValueSpan(text, 'position', own[0], own[1]);
  text =
    ownPosSpan === null
      ? insertPosition(text, own, vec3(newPos))
      : splice(text, ownPosSpan, vec3(newPos));

  // Direct children, in reverse source order so earlier spans stay valid.
  const children = asm.manifest.parts.filter((p) => p.parent === part);
  const edits: Array<{ span: Span; text: string; insert?: Span }> = [];
  for (const c of children) {
    const span = partObjectSpan(text, c.name);
    if (span === null) continue;
    const cp = c.position ?? [0, 0, 0];
    const moved = vec3([cp[0] - d[0], cp[1] - d[1], cp[2] - d[2]]);
    const posSpan = arrayValueSpan(text, 'position', span[0], span[1]);
    if (posSpan === null) edits.push({ span, text: moved, insert: span });
    else edits.push({ span: posSpan, text: moved });
  }
  edits.sort((a, b) => b.span[0] - a.span[0]);
  for (const e of edits) {
    text = e.insert ? insertPosition(text, e.insert, e.text) : splice(text, e.span, e.text);
  }

  // The geometry file's pivot. An all-inline model (§6.13) declares none,
  // and this operation has nothing to edit there.
  let geomPath: string | null = null;
  let geomText = '';
  for (const g of asm.manifest.geometry ?? []) {
    const p = join(root, g);
    const t = await readFile(p, 'utf8');
    if (partObjectSpan(t, rp.part.name) !== null) {
      geomPath = p;
      geomText = t;
      break;
    }
  }
  if (geomPath === null) {
    return {
      text:
        `cuboidy-part: "${part}" is defined inline (SPEC §6.13), and ` +
        `move-pivot edits declared geometry files only\n`,
      exitCode: 1,
    };
  }
  const gObj = partObjectSpan(geomText, rp.part.name);
  if (gObj === null) {
    return { text: `cuboidy-part: cannot locate "${part}" in ${geomPath}\n`, exitCode: 1 };
  }
  const pivSpan = arrayValueSpan(geomText, 'pos', gObj[0], gObj[1]);
  if (pivSpan === null) {
    return {
      text: `cuboidy-part: "${part}" has no pivot.pos to move in ${geomPath}\n`,
      exitCode: 1,
    };
  }
  const newGeom = splice(geomText, pivSpan, vec3(to));

  const summary =
    `move-pivot: "${part}" ${vec3(from)} -> ${vec3(to)}\n` +
    `  ${manifestPath}: position ${vec3(basePos as Vec3Tuple)} -> ${vec3(newPos)}\n` +
    children
      .map((c) => {
        const cp = c.position ?? [0, 0, 0];
        return `  child "${c.name}": position ${vec3(cp as Vec3Tuple)} -> ${vec3([cp[0] - d[0], cp[1] - d[1], cp[2] - d[2]])}\n`;
      })
      .join('');

  if (opts.dryRun === true) {
    return { text: `${summary}  (dry run: nothing written)\n`, exitCode: 0 };
  }

  await writeFile(manifestPath, text);
  await writeFile(geomPath, newGeom);

  // The invariant, checked rather than asserted in a comment: every drawn
  // face has to land where it landed before. Nothing else in the toolchain
  // checks this -- see the note at the top of this file -- so if the tool is
  // the only thing that can get it wrong, the tool is what has to prove it
  // did not.
  const after = await loadAndAssemble(root);
  const drift = surfaceDrift(before, after);
  if (!(drift <= DRIFT_TOLERANCE)) {
    await writeFile(manifestPath, manifestText);
    await writeFile(geomPath, geomText);
    return {
      text:
        `cuboidy-part: move-pivot would have moved "${part}" by ` +
        `${drift.toFixed(6)} voxels and was rolled back. Nothing was ` +
        `written. This is a bug in the compensation, not in your input.\n`,
      exitCode: 1,
    };
  }
  return {
    text: `${summary}  surface verified: drift ${drift.toExponential(1)} voxels\n`,
    exitCode: 0,
  };
}
