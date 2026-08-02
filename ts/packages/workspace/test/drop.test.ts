import { describe, expect, it } from 'vitest';
import { buildLibrary } from '../src/lib/library.js';
import {
  addInstance,
  emptyScene,
  placeScene,
  setPlacement,
  type Scene,
} from '../src/lib/scene.js';
import {
  SOCKET_GRAB_PX,
  dropKey,
  groundPoint,
  resolveDrop,
  socketCandidates,
  type ProjectToPixels,
  type Ray,
} from '../src/lib/drop.js';

// Where a dragged model lands.
//
// Unit-tested rather than left to the E2E because the failure is silent:
// a wrong sign or a missed frame composition puts the model somewhere
// plausible-looking, and "it appeared in the scene" passes either way.

const TOWER = JSON.stringify({
  name: 'tower',
  parts: [
    {
      name: 'body',
      geometry: {
        size: [1, 2, 1],
        pivot: { pos: [0, 0, 0] },
        sockets: [{ name: 'top', pos: [0, 2, 0] }],
        voxels: [['0'], ['0']],
      },
    },
  ],
  palette: ['#FF0000'],
  sockets: { peg: { part: 'body', socket: 'top' } },
});

const GEM = JSON.stringify({
  name: 'gem',
  palette: ['#00FF00'],
  parts: [{ name: 'gem', geometry: { size: [1, 1, 1], voxels: [['0']] } }],
});

const LIBRARY = buildLibrary(
  'lib',
  new Map([
    ['tower/cuboidy.json', TOWER],
    ['gem/cuboidy.json', GEM],
  ]),
);

// A camera looking straight down from above: the world's x/z map to
// screen x/y at one pixel per unit, which makes the expected pixel of any
// world point something a reader can work out by hand.
const overhead: ProjectToPixels = (p) => [400 + p[0], 300 + p[2]];

const downward = (x: number, z: number): Ray => ({
  origin: [x, 50, z],
  dir: [0, -1, 0],
});

describe('groundPoint', () => {
  it('snaps to whole units, because a scene is measured at voxel scale', () => {
    expect(groundPoint({ origin: [3.7, 10, -2.2], dir: [0, -1, 0] })).toEqual([
      4, 0, -2,
    ]);
  });

  it('follows a slanted ray to the floor', () => {
    // 45 degrees down and along +x from 10 up: it meets y=0 ten out.
    const s = Math.SQRT1_2;
    expect(groundPoint({ origin: [0, 10, 0], dir: [s, -s, 0] })).toEqual([
      10, 0, 0,
    ]);
  });

  it('has no answer when the ray never reaches the floor', () => {
    // Looking up at the horizon. Inventing a point here would drop models
    // behind the camera.
    expect(groundPoint({ origin: [0, 10, 0], dir: [0, 1, 0] })).toBeNull();
    expect(groundPoint({ origin: [0, 10, 0], dir: [1, 0, 0] })).toBeNull();
  });
});

describe('socketCandidates', () => {
  const scene = (): Scene => addInstance(emptyScene(), 'tower');

  it('carries a socket into the world, not the host model space', () => {
    // The tower is moved; its socket has to move with it, or every drop
    // near it would resolve against where it used to be.
    const s = setPlacement(scene(), 'tower', { pos: [10, 0, 5] });
    const [c] = socketCandidates(placeScene(s, LIBRARY));
    expect(c?.host).toBe('tower');
    expect(c?.socket).toBe('peg');
    expect(c?.frame.pos).toEqual([10, 2, 5]);
  });

  it('turns with a rotated host', () => {
    const s = setPlacement(scene(), 'tower', { rot: [0, 90, 0] });
    const [c] = socketCandidates(placeScene(s, LIBRARY));
    expect(c!.frame.quat[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('offers nothing for a model that publishes nothing', () => {
    const s = addInstance(emptyScene(), 'gem');
    expect(socketCandidates(placeScene(s, LIBRARY))).toEqual([]);
  });

  it('can leave one instance out, for re-targeting an existing one', () => {
    let s = addInstance(emptyScene(), 'tower');
    s = addInstance(s, 'tower');
    const placed = placeScene(s, LIBRARY);
    expect(socketCandidates(placed)).toHaveLength(2);
    expect(socketCandidates(placed, 'tower')).toHaveLength(1);
  });
});

describe('resolveDrop', () => {
  const scene = (): Scene => addInstance(emptyScene(), 'tower');
  const candidates = () => socketCandidates(placeScene(scene(), LIBRARY));

  it('takes a socket when the pointer is near one on screen', () => {
    // The socket is at world [0,2,0], which the overhead camera puts at
    // pixel [400,300]. Aim a few pixels off it.
    const t = resolveDrop(downward(0, 0), [406, 304], candidates(), overhead);
    expect(t).toMatchObject({ kind: 'socket', host: 'tower', socket: 'peg' });
  });

  it('falls to the ground once the pointer is past the grab radius', () => {
    const far = SOCKET_GRAB_PX + 10;
    const t = resolveDrop(
      downward(far, 0),
      [400 + far, 300],
      candidates(),
      overhead,
    );
    expect(t).toEqual({ kind: 'ground', pos: [far, 0, 0] });
  });

  it('prefers the NEARER socket when two are in reach', () => {
    let s = addInstance(emptyScene(), 'tower');
    s = addInstance(s, 'tower');
    s = setPlacement(s, 'tower-2', { pos: [20, 0, 0] });
    const cs = socketCandidates(placeScene(s, LIBRARY));
    // The two sockets land on pixels 400 and 420, so 410 is the divide.
    // At 405 the first is 5 away and the second 15.
    expect(resolveDrop(downward(5, 0), [405, 300], cs, overhead)).toMatchObject(
      { host: 'tower' },
    );
    // At 415 they swap.
    expect(
      resolveDrop(downward(15, 0), [415, 300], cs, overhead),
    ).toMatchObject({ host: 'tower-2' });
  });

  it('ignores a socket behind the camera', () => {
    // `project` returns null for those; a socket at your back must never
    // become the nearest thing on screen.
    const behind: ProjectToPixels = () => null;
    const t = resolveDrop(downward(0, 0), [400, 300], candidates(), behind);
    expect(t).toEqual({ kind: 'ground', pos: [0, 0, 0] });
  });

  it('resolves to nothing when the ray misses the floor and every socket', () => {
    const up: Ray = { origin: [0, 10, 0], dir: [0, 1, 0] };
    expect(resolveDrop(up, [9999, 9999], candidates(), overhead)).toBeNull();
  });
});

describe('dropKey', () => {
  it('is stable while the answer is, so the preview does not re-render per pixel', () => {
    const a = dropKey({ kind: 'ground', pos: [3, 0, 4] });
    expect(dropKey({ kind: 'ground', pos: [3, 0, 4] })).toBe(a);
    expect(dropKey({ kind: 'ground', pos: [3, 0, 5] })).not.toBe(a);
    expect(dropKey(null)).toBe('');
  });

  it('tells two sockets on the same host apart', () => {
    const frame = { pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as const };
    expect(dropKey({ kind: 'socket', host: 'k', socket: 'a', frame })).not.toBe(
      dropKey({ kind: 'socket', host: 'k', socket: 'b', frame }),
    );
  });
});

describe('addInstance placement', () => {
  it('lands on the ground point it was dropped at', () => {
    const s = addInstance(emptyScene(), 'gem', {
      kind: 'ground',
      pos: [4, 0, -3],
    });
    expect(s.instances[0]?.placement.pos).toEqual([4, 0, -3]);
    expect(s.instances[0]?.attach).toBeUndefined();
  });

  it('arrives already attached when dropped on a socket', () => {
    // The whole point of the gesture: one motion, not "place, then find
    // it in the tree, then pick a socket".
    let s = addInstance(emptyScene(), 'tower');
    s = addInstance(s, 'gem', { kind: 'socket', host: 'tower', socket: 'peg' });
    expect(s.instances[1]?.attach).toEqual({ to: 'tower', socket: 'peg' });
    const gem = placeScene(s, LIBRARY).find((p) => p.instance.id === 'gem');
    expect(gem?.frame.pos).toEqual([0, 2, 0]);
  });

  it('still goes to the origin when nothing said where', () => {
    const s = addInstance(emptyScene(), 'gem');
    expect(s.instances[0]?.placement.pos).toEqual([0, 0, 0]);
  });
});
