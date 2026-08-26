import { describe, expect, it } from 'vitest';
import { buildForest, resolveHierarchy } from '../src/forest.js';
import type { ManifestPart } from '../src/manifest.js';
import {
  QUAT_IDENTITY,
  composePartRotation,
  composeScale,
  localPointToWorld,
  computeRestWorldTransforms,
  quatFromEulerZXYDeg,
  quatMultiply,
  quatRotateVec3,
  type QuatTuple,
} from '../src/rig-transform.js';
import type { Vec3Tuple } from '../src/geometry/types.js';

function expectVecClose(
  actual: readonly number[],
  expected: readonly number[],
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i]!, 10);
  }
}

function rotate(e: Vec3Tuple, v: Vec3Tuple): [number, number, number] {
  return quatRotateVec3(quatFromEulerZXYDeg(e), v);
}

describe('quatFromEulerZXYDeg', () => {
  it('maps zero Euler to the identity quaternion', () => {
    expectVecClose(quatFromEulerZXYDeg([0, 0, 0]), [...QUAT_IDENTITY]);
  });

  it('rotates +90° about X: +Y → +Z (right-hand rule, §4)', () => {
    expectVecClose(rotate([90, 0, 0], [0, 1, 0]), [0, 0, 1]);
  });

  it('rotates +90° about Y: +X → −Z', () => {
    expectVecClose(rotate([0, 90, 0], [1, 0, 0]), [0, 0, -1]);
  });

  it('rotates +90° about Z: +X → +Y', () => {
    expectVecClose(rotate([0, 0, 90], [1, 0, 0]), [0, 1, 0]);
  });

  it('applies ZXY intrinsic order (R = Rz·Rx·Ry, §4)', () => {
    // x=90, z=90: +X is unmoved by Rx, then Rz sends it to +Y. The
    // reversed composition (Rx·Rz) would land it on +Z instead — this
    // pins the intrinsic ZXY convention shared with three.js.
    expectVecClose(rotate([90, 0, 90], [1, 0, 0]), [0, 1, 0]);
    // And the same Euler on +Z: Rx sends it to −Y, Rz sends −Y to +X.
    expectVecClose(rotate([90, 0, 90], [0, 0, 1]), [1, 0, 0]);
  });

  it('produces unit quaternions for arbitrary angles', () => {
    const [x, y, z, w] = quatFromEulerZXYDeg([33.5, -71, 128.25]);
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 12);
  });
});

describe('quatMultiply', () => {
  it('composes rotations right-to-left (a ⊗ b applies b first)', () => {
    const a = quatFromEulerZXYDeg([0, 0, 90]); // then Z
    const b = quatFromEulerZXYDeg([90, 0, 0]); // X first
    // (0,0,1) —Rx90→ (0,−1,0) —Rz90→ (1,0,0)
    expectVecClose(quatRotateVec3(quatMultiply(a, b), [0, 0, 1]), [1, 0, 0]);
  });

  it('identity is neutral on both sides', () => {
    const q = quatFromEulerZXYDeg([10, 20, 30]);
    expectVecClose([...quatMultiply(q, QUAT_IDENTITY)], [...q]);
    expectVecClose([...quatMultiply(QUAT_IDENTITY, q)], [...q]);
  });
});

describe('composePartRotation', () => {
  it('is identity when every input is absent', () => {
    expectVecClose([...composePartRotation(undefined, undefined)], [...QUAT_IDENTITY]);
  });

  it('equals the plain Euler conversion with only one input', () => {
    const e: Vec3Tuple = [15, 30, 45];
    const expected = quatFromEulerZXYDeg(e);
    expectVecClose([...composePartRotation(e, undefined)], [...expected]);
    expectVecClose([...composePartRotation(undefined, e)], [...expected]);
    expectVecClose([...composePartRotation(undefined, undefined, e)], [...expected]);
  });

  it('orders q_rotation ⊗ q_pivot ⊗ q_anim (§7.7)', () => {
    // anim x=90 applies first: (0,0,1) → (0,−1,0); then rotation z=90:
    // (0,−1,0) → (1,0,0). The reverse order would yield (0,−1,0).
    const q = composePartRotation([0, 0, 90], undefined, [90, 0, 0]);
    expectVecClose(quatRotateVec3(q, [0, 0, 1]), [1, 0, 0]);
    // pivotRot slots between the two: same expectation with the outer
    // rotation moved to the pivot slot.
    const q2 = composePartRotation(undefined, [0, 0, 90], [90, 0, 0]);
    expectVecClose(quatRotateVec3(q2, [0, 0, 1]), [1, 0, 0]);
  });
});

const NO_PIVOT_ROTS: ReadonlyMap<string, Vec3Tuple> = new Map();

function part(
  name: string,
  extra: Partial<Omit<ManifestPart, 'name'>> = {},
): ManifestPart {
  return { name, ...extra } as ManifestPart;
}

describe('computeRestWorldTransforms', () => {
  it('places a root at its manifest position', () => {
    const wt = computeRestWorldTransforms(
      [part('body', { position: [1, 2, 3] })],
      NO_PIVOT_ROTS,
    );
    expectVecClose(wt.get('body')!.pos, [1, 2, 3]);
    expectVecClose([...wt.get('body')!.quat], [...QUAT_IDENTITY]);
  });

  it('defaults a missing position to the parent pivot (SPEC §6.2)', () => {
    const wt = computeRestWorldTransforms(
      [part('body', { position: [1, 2, 3] }), part('hat', { parent: 'body' })],
      NO_PIVOT_ROTS,
    );
    expectVecClose(wt.get('hat')!.pos, [1, 2, 3]);
  });

  it('sums positions down the chain when no rotations are present', () => {
    const wt = computeRestWorldTransforms(
      [
        part('body', { position: [0, 2, 0] }),
        part('head', { parent: 'body', position: [0, 4, 0] }),
        part('crest', { parent: 'head', position: [0, 3, -1] }),
      ],
      NO_PIVOT_ROTS,
    );
    expectVecClose(wt.get('crest')!.pos, [0, 9, -1]);
  });

  it("rotates a child's offset by the parent's manifest rotation", () => {
    const wt = computeRestWorldTransforms(
      [
        part('body', { position: [0, 2, 0], rotation: [0, 90, 0] }),
        part('arm', { parent: 'body', position: [2, 0, 0] }),
      ],
      NO_PIVOT_ROTS,
    );
    // Ry(90) sends +X to −Z: arm's pivot lands at body + (0, 0, −2).
    expectVecClose(wt.get('arm')!.pos, [0, 2, -2]);
    // The arm inherits the parent orientation.
    expectVecClose(
      quatRotateVec3(wt.get('arm')!.quat, [1, 0, 0]),
      [0, 0, -1],
    );
  });

  it("rotates a child's offset by the parent's pivot.rot too", () => {
    const wt = computeRestWorldTransforms(
      [
        part('body', { position: [0, 2, 0] }),
        part('arm', { parent: 'body', position: [2, 0, 0] }),
      ],
      new Map([['body', [0, 90, 0] as Vec3Tuple]]),
    );
    expectVecClose(wt.get('arm')!.pos, [0, 2, -2]);
  });

  it('composes manifest rotation outside pivot.rot (q_rotation ⊗ q_pivot)', () => {
    const wt = computeRestWorldTransforms(
      [part('body', { rotation: [0, 0, 90] })],
      new Map([['body', [90, 0, 0] as Vec3Tuple]]),
    );
    // pivot x=90 first: (0,0,1) → (0,−1,0); manifest z=90: → (1,0,0).
    expectVecClose(
      quatRotateVec3(wt.get('body')!.quat, [0, 0, 1]),
      [1, 0, 0],
    );
  });

  it('treats an unknown parent as a root (renderer leniency)', () => {
    const wt = computeRestWorldTransforms(
      [part('orphan', { parent: 'ghost', position: [1, 0, 0] })],
      NO_PIVOT_ROTS,
    );
    expectVecClose(wt.get('orphan')!.pos, [1, 0, 0]);
  });

  it('does not hang on a parent cycle', () => {
    const wt = computeRestWorldTransforms(
      [
        part('a', { parent: 'b', position: [1, 0, 0] }),
        part('b', { parent: 'a', position: [0, 1, 0] }),
      ],
      NO_PIVOT_ROTS,
    );
    expect(wt.get('a')).toBeDefined();
    expect(wt.get('b')).toBeDefined();
  });
});

// `computeWorldTransforms` used to carry its own parent walk, which
// disagreed with the one the rig tree uses (forest.ts) on every malformed
// shape. Both now go through `resolveHierarchy`, so these pin the policy
// rather than one function's version of it.
describe('computeRestWorldTransforms — malformed hierarchies', () => {
  it('applies a self-parented part exactly once', () => {
    // The recursive walk cached nothing before recursing, so `a` resolved
    // through itself and landed at [2,0,0] — its own offset, twice.
    const wt = computeRestWorldTransforms(
      [part('a', { parent: 'a', position: [1, 0, 0] })],
      NO_PIVOT_ROTS,
    );
    expectVecClose(wt.get('a')!.pos, [1, 0, 0]);
  });

  it('returns no entry for a parent that names no part', () => {
    // The walk used to cache an identity transform under the missing name,
    // so the returned map held a key the model does not have — visible to
    // any consumer that enumerates it.
    const wt = computeRestWorldTransforms(
      [part('orphan', { parent: 'ghost', position: [1, 0, 0] })],
      NO_PIVOT_ROTS,
    );
    expect([...wt.keys()]).toEqual(['orphan']);
    expect(wt.has('ghost')).toBe(false);
  });

  it('makes every member of a cycle a root, symmetrically', () => {
    const wt = computeRestWorldTransforms(
      [
        part('a', { parent: 'b', position: [1, 0, 0] }),
        part('b', { parent: 'a', position: [0, 1, 0] }),
      ],
      NO_PIVOT_ROTS,
    );
    expect([...wt.keys()].sort()).toEqual(['a', 'b']);
    // Each part's own edge is the one that closes the cycle from its point
    // of view, so both are dropped and both sit at their own offset. The
    // old walk instead composed one through the other and produced
    // [3,0,0] / [2,0,0]-style answers that swapped when the parts did.
    expectVecClose(wt.get('a')!.pos, [1, 0, 0]);
    expectVecClose(wt.get('b')!.pos, [0, 1, 0]);

    const reversed = computeRestWorldTransforms(
      [
        part('b', { parent: 'a', position: [0, 1, 0] }),
        part('a', { parent: 'b', position: [1, 0, 0] }),
      ],
      NO_PIVOT_ROTS,
    );
    expectVecClose(reversed.get('a')!.pos, [1, 0, 0]);
    expectVecClose(reversed.get('b')!.pos, [0, 1, 0]);
  });

  it('agrees with the rig tree about who is a root', () => {
    const parts = [
      part('a', { parent: 'a' }),
      part('b', { parent: 'ghost' }),
      part('c', { parent: 'd' }),
      part('d', { parent: 'c' }),
      part('e', {}),
    ];
    const roots = buildForest(
      parts,
      (p) => p.name,
      (p) => p.parent,
    ).map((n) => n.value.name);
    const { parentOf } = resolveHierarchy(
      parts,
      (p) => p.name,
      (p) => p.parent,
    );
    expect(roots).toEqual(
      parts.filter((p) => parentOf.get(p.name) === undefined).map((p) => p.name),
    );
    // And every part the transform map holds is a part.
    const wt = computeRestWorldTransforms(parts, NO_PIVOT_ROTS);
    expect([...wt.keys()].sort()).toEqual(parts.map((p) => p.name).sort());
  });

  it('reports why each edge was dropped', () => {
    const { dropped } = resolveHierarchy(
      [
        part('a', { parent: 'a' }),
        part('b', { parent: 'ghost' }),
        part('c', { parent: 'd' }),
        part('d', { parent: 'c' }),
        part('e', {}),
      ],
      (p) => p.name,
      (p) => p.parent,
    );
    expect(dropped.get('a')).toBe('self');
    expect(dropped.get('b')).toBe('unknown');
    // Both members of the cycle lose their edge — from each one's point of
    // view its own parent link is the one that closes the loop.
    expect(dropped.get('c')).toBe('cycle');
    expect(dropped.get('d')).toBe('cycle');
    expect(dropped.has('e')).toBe(false);
  });
});

// SPEC §6.2 + §6.5: the rest scale and the animated scale are one operator
// reached twice, so a part's total scale is their per-axis product.
describe('composeScale', () => {
  it('multiplies the two per axis', () => {
    expect(composeScale([2, 3, 4], [0.5, 2, 0.25])).toEqual([1, 6, 1]);
  });

  it('returns the other side untouched when one is absent', () => {
    expect(composeScale(undefined, [2, 2, 2])).toEqual([2, 2, 2]);
    expect(composeScale([2, 2, 2], undefined)).toEqual([2, 2, 2]);
  });

  it('stays undefined when neither is set, so the common path allocates nothing', () => {
    expect(composeScale(undefined, undefined)).toBeUndefined();
  });

  it('commutes, because both act on the same axes around the same pivot', () => {
    expect(composeScale([1.1, 2, 0.5], [3, 0.25, 4])).toEqual(
      composeScale([3, 0.25, 4], [1.1, 2, 0.5]),
    );
  });
});

// SPEC §7.7: scale acts on the pivot-relative offset, so the pivot is the
// one point it leaves alone — which is what lets a scaled part stay attached
// where its `position` says, and what keeps its children from moving.
describe('localPointToWorld — scale', () => {
  const world = { pos: [10, 0, 0] as Vec3Tuple, quat: QUAT_IDENTITY };
  const pivot: Vec3Tuple = [3, 0, 3];

  it('leaves the pivot itself where the transform puts it', () => {
    expectVecClose(localPointToWorld(pivot, pivot, [2, 2, 2], world), [10, 0, 0]);
  });

  it('pushes a corner out by the factor, measured from the pivot', () => {
    // The corner sits 3 out in x from the pivot, so 1.5x puts it 4.5 out.
    expectVecClose(
      localPointToWorld([6, 0, 3], pivot, [1.5, 1.5, 1.5], world),
      [14.5, 0, 0],
    );
  });

  it('applies each axis on its own', () => {
    expectVecClose(
      localPointToWorld([6, 2, 6], pivot, [1, 2, 3], world),
      [13, 4, 9],
    );
  });

  it('is identity when absent', () => {
    expectVecClose(
      localPointToWorld([6, 2, 6], pivot, undefined, world),
      [13, 2, 3],
    );
  });
});
