import { describe, expect, it } from 'vitest';
import { parseManifest, type Manifest } from '../src/manifest.js';
import { resolveProject } from '../src/project.js';
import { publishedSocketFrame } from '../src/socket-frame.js';
import { geo } from './helpers/geometry.js';

// SPEC §7.8 + §6.12: where a published socket is in world space. This is
// the point two packages meet at, so it is worth pinning numerically —
// a host and a guest that disagree here come apart visibly.

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
    const poses = new Map([
      ['tower', { rot: [0, 0, 90] as [number, number, number], pos: [0, 0, 0] as [number, number, number] }],
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
