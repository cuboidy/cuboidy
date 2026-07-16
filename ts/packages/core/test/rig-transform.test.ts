import { describe, expect, it } from 'vitest';
import type { ManifestPart } from '../src/manifest.js';
import {
  QUAT_IDENTITY,
  composePartRotation,
  computeRestWorldTransforms,
  quatFromEulerZXYDeg,
  quatMultiply,
  quatRotateVec3,
  type QuatTuple,
  type Vec3Tuple,
} from '../src/rig-transform.js';

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
