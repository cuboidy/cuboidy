import { describe, expect, it } from 'vitest';
import { parseManifest, type Manifest } from '../src/manifest.js';
import { resolveProject } from '../src/project.js';
import { publishedSocketFrame, socketFrameOn } from '../src/socket-frame.js';
import { QUAT_IDENTITY } from '../src/rig-transform.js';
import type { Pose } from '../src/animation.js';
import { buildSceneFromParts } from '../src/render/scene.js';
import { geo } from './helpers/geometry.js';
import { rgba } from './helpers/palette.js';

// SPEC §7.8 + §6.12: where a published socket is in world space. This is
// the point two packages meet at, so it is worth pinning numerically —
// a host and a guest that disagree here come apart visibly.

function expectVecClose(
  actual: readonly number[],
  expected: readonly number[],
): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i]!, 10);
  }
}

function manifest(json: object): Manifest {
  const r = parseManifest(json);
  if (!r.ok) throw new Error(r.message);
  return r.value;
}

// A 2x2x2 part with its pivot at the bottom centre and a socket at the top
// centre, so socket − pivot is a clean +2 in Y.
const TOWER = geo(
  [
    {
      name: 'tower',
      size: [2, 2, 2],
      pivot: [1, 0, 1],
      sockets: [{ name: 'top', pos: [1, 2, 1] }],
      voxels: [
        ['00', '00'],
        ['00', '00'],
      ],
    },
  ],
  ['#FF0000'],
);

const near = (got: readonly number[], want: readonly number[]): void => {
  expect(got.length).toBe(want.length);
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 6));
};

describe('publishedSocketFrame', () => {
  it('places the socket relative to the part pivot, not the grid origin', () => {
    const m = manifest({
      name: 'm',
      parts: [{ name: 'tower', position: [10, 0, 0] }],
      sockets: { top: { part: 'tower', socket: 'top' } },
    });
    const p = resolveProject(m, new Map([['voxels.json', TOWER]]));
    const frame = publishedSocketFrame(m, p.parts, 'top');
    // pivot sits at x=10; the socket is 2 above it.
    near(frame!.pos, [10, 2, 0]);
    near(frame!.quat, [0, 0, 0, 1]);
  });

  it('rides the host part rotation', () => {
    // 90° about Z sends the part's +Y to world −X, so a socket 2 above the
    // pivot lands 2 to the −X side of it.
    const m = manifest({
      name: 'm',
      parts: [{ name: 'tower', rotation: [0, 0, 90] }],
      sockets: { top: { part: 'tower', socket: 'top' } },
    });
    const p = resolveProject(m, new Map([['voxels.json', TOWER]]));
    near(publishedSocketFrame(m, p.parts, 'top')!.pos, [-2, 0, 0]);
  });

  it('rides an ANCESTOR rotation, not just the host part', () => {
    // The rig is a chain: rotating the base has to carry the socket on the
    // part above it, or anything attached stays behind when the host moves.
    const m = manifest({
      name: 'm',
      parts: [
        { name: 'base', rotation: [0, 0, 90] },
        { name: 'tower', parent: 'base', position: [0, 1, 0] },
      ],
      sockets: { top: { part: 'tower', socket: 'top' } },
    });
    const geometry = geo(
      [
        { name: 'base', size: [1, 1, 1], pivot: [0, 0, 0], voxels: [['0']] },
        {
          name: 'tower',
          size: [2, 2, 2],
          pivot: [1, 0, 1],
          sockets: [{ name: 'top', pos: [1, 2, 1] }],
          voxels: [
            ['00', '00'],
            ['00', '00'],
          ],
        },
      ],
      ['#FF0000'],
    );
    const p = resolveProject(m, new Map([['voxels.json', geometry]]));
    // base rotates +Y→−X, so tower's pivot goes to (−1,0,0) and its socket
    // a further 2 along the same rotated axis.
    near(publishedSocketFrame(m, p.parts, 'top')!.pos, [-3, 0, 0]);
  });

  it("composes the socket's own rot onto the host orientation (§7.8)", () => {
    const withRot = geo(
      [
        {
          name: 'tower',
          size: [2, 2, 2],
          pivot: [1, 0, 1],
          sockets: [{ name: 'top', pos: [1, 2, 1], rot: [0, 90, 0] }],
          voxels: [
            ['00', '00'],
            ['00', '00'],
          ],
        },
      ],
      ['#FF0000'],
    );
    const m = manifest({
      name: 'm',
      parts: [{ name: 'tower' }],
      sockets: { top: { part: 'tower', socket: 'top' } },
    });
    const p = resolveProject(m, new Map([['voxels.json', withRot]]));
    const q = publishedSocketFrame(m, p.parts, 'top')!.quat;
    // 90° about Y.
    near(q, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  });

  it('follows an animated host', () => {
    // A socket on a swinging arm moves with it, so whatever is attached
    // does too. Same 90° as above, supplied as a pose instead of a rest
    // rotation — the result must match.
    const m = manifest({
      name: 'm',
      parts: [{ name: 'tower' }],
      sockets: { top: { part: 'tower', socket: 'top' } },
    });
    const p = resolveProject(m, new Map([['voxels.json', TOWER]]));
    // A whole Pose, not the two fields the rig reads. The rig used to
    // declare a narrower view that a partial object satisfied structurally;
    // C# has no such thing, so there is one pose type and it is complete.
    const poses = new Map<string, Pose>([
      [
        'tower',
        { rot: [0, 0, 90], pos: [0, 0, 0], scale: [1, 1, 1], visible: true },
      ],
    ]);
    near(publishedSocketFrame(m, p.parts, 'top', poses)!.pos, [-2, 0, 0]);
  });

  it('returns null for a name the model does not publish', () => {
    // The consumer-side `unknown` of §11.6. Declaring a socket is not
    // publishing it, so an unpublished one is not reachable either.
    const m = manifest({
      name: 'm',
      parts: [{ name: 'tower' }],
      sockets: { top: { part: 'tower', socket: 'top' } },
    });
    const p = resolveProject(m, new Map([['voxels.json', TOWER]]));
    expect(publishedSocketFrame(m, p.parts, 'nope')).toBeNull();
  });
});

// SPEC §7.8 was silent about §6.5 `scale`, and the implementation ignored it
// — a socket on a 3x-lengthened arm stayed where the unscaled arm had put
// it, a third of the way along. A socket is a point in the part's geometry,
// so it moves with the voxels around it.
describe('socketFrameOn — animated scale (§6.5 / §7.8)', () => {
  const arm = {
    name: 'arm',
    size: { w: 1, h: 4, d: 1 },
    // Pivot at the shoulder; the socket sits at the far tip.
    pivot: { pos: { x: 0.5, y: 0, z: 0.5 } },
    sockets: [{ name: 'grip', pos: { x: 0.5, y: 4, z: 0.5 } }],
    voxels: [[[0]], [[0]], [[0]], [[0]]],
  };
  const atOrigin = { pos: [0, 0, 0] as [number, number, number], quat: QUAT_IDENTITY };

  it('leaves the socket where it is at unit scale', () => {
    const f = socketFrameOn(arm, atOrigin, 'grip');
    expectVecClose(f!.pos, [0, 4, 0]);
  });

  it('carries the socket out with the geometry', () => {
    const f = socketFrameOn(arm, atOrigin, 'grip', [1, 3, 1]);
    // The tip is 4 above the pivot; tripling the part's length puts it at 12.
    expectVecClose(f!.pos, [0, 12, 0]);
  });

  it('scales about the pivot, not the grid origin', () => {
    // A socket AT the pivot cannot move, whatever the scale.
    const atPivot = {
      ...arm,
      sockets: [{ name: 'grip', pos: { x: 0.5, y: 0, z: 0.5 } }],
    };
    const f = socketFrameOn(atPivot, atOrigin, 'grip', [5, 5, 5]);
    expectVecClose(f!.pos, [0, 0, 0]);
  });

  it('does not resize the guest — the frame carries no scale', () => {
    const f = socketFrameOn(arm, atOrigin, 'grip', [1, 3, 1]);
    expect(Object.keys(f!).sort()).toEqual(['pos', 'quat']);
  });

  it('agrees with where the rasterizer puts the same local point', () => {
    // This used to compare socketFrameOn against localPointToWorld with the
    // same arguments socketFrameOn passes it — f(x) === f(x), which cannot
    // fail. The claim is about the RASTERIZER, so ask the rasterizer: the
    // socket sits on the arm's top face, and a corner of the top voxel is
    // the same local point.
    const scaled: [number, number, number] = [1, 3, 1];
    const viaSocket = socketFrameOn(arm, atOrigin, 'grip', scaled)!.pos;
    const scene = buildSceneFromParts(
      [{ part: arm, remap: null, transform: atOrigin, scale: scaled }],
      [rgba(255, 0, 0, 255)],
    );
    // The socket sits at the centre of the top face, so it is not itself a
    // corner — but it is in that plane, and the rasterizer's highest corner
    // is too. If the two rules disagreed about scale, these would part.
    expect(scene.max[1]).toBeCloseTo(viaSocket[1], 10);
    // And at unit scale both come back down together.
    const rest = socketFrameOn(arm, atOrigin, 'grip')!.pos;
    const restScene = buildSceneFromParts(
      [{ part: arm, remap: null, transform: atOrigin }],
      [rgba(255, 0, 0, 255)],
    );
    expect(restScene.max[1]).toBeCloseTo(rest[1], 10);
    expect(viaSocket[1]).toBeCloseTo(rest[1] * 3, 10);
  });
});
