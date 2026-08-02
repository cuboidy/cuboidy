import { describe, expect, it } from 'vitest';
import { quatFromEulerZXYDeg, quatRotateVec3 } from '@cuboidy/core';
import { buildLibrary } from '../src/lib/library.js';
import {
  addInstance,
  emptyScene,
  localPosFrom,
  placeScene,
  setAttachment,
  setPlacement,
  type Scene,
} from '../src/lib/scene.js';

// Where an instance ends up, and how a drag in the 3D view gets back to
// the value that put it there.
//
// The move gizmo edits a WORLD transform — an attached guest is drawn at
// its resolved frame, not nested under its host — so every drag crosses
// the same conversion. A sign error there would misplace everything
// hanging off a rotated socket and look like the socket was wrong.

// A host whose published socket is turned a quarter turn about Y, so the
// guest's frame is genuinely rotated rather than a translated copy of the
// world's.
const TOWER = JSON.stringify({
  name: 'tower',
  parts: [
    {
      name: 'body',
      geometry: {
        size: [1, 2, 1],
        pivot: { pos: [0, 0, 0] },
        sockets: [{ name: 'top', pos: [0, 2, 0], rot: [0, 90, 0] }],
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

const scene = (): Scene =>
  addInstance(addInstance(emptyScene('s'), 'tower'), 'gem');

const find = (s: Scene, id: string) =>
  placeScene(s, LIBRARY).find((p) => p.instance.id === id)!;

describe('setPlacement', () => {
  it('patches one half without restating the other', () => {
    let s = setPlacement(scene(), 'gem', { rot: [0, 45, 0] });
    s = setPlacement(s, 'gem', { pos: [1, 2, 3] });
    const gem = s.instances.find((i) => i.id === 'gem');
    expect(gem?.placement).toEqual({ pos: [1, 2, 3], rot: [0, 45, 0] });
  });

  it('drops an all-zero rotation instead of storing the default', () => {
    // The serialized scene is meant to be read by hand; a file that spells
    // out every identity hides the values that mean something.
    let s = setPlacement(scene(), 'gem', { rot: [0, 45, 0] });
    s = setPlacement(s, 'gem', { rot: [0, 0, 0] });
    expect(s.instances.find((i) => i.id === 'gem')?.placement.rot).toBeUndefined();
  });
});

describe('a free instance', () => {
  it('is placed in world space, unrotated', () => {
    const gem = find(setPlacement(scene(), 'gem', { pos: [3, 1, -2] }), 'gem');
    expect(gem.frame.pos).toEqual([3, 1, -2]);
    expect(gem.base.pos).toEqual([0, 0, 0]);
    expect(gem.base.quat).toEqual([0, 0, 0, 1]);
  });

  it('turns about its own origin, so rotating never moves it', () => {
    const s = setPlacement(scene(), 'gem', { pos: [3, 1, -2], rot: [0, 90, 0] });
    const gem = find(s, 'gem');
    expect(gem.frame.pos).toEqual([3, 1, -2]);
    expect(gem.frame.quat[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe('an attached instance', () => {
  const attached = (): Scene =>
    setAttachment(scene(), 'gem', { to: 'tower', socket: 'peg' });

  it('measures its base from the socket, orientation included', () => {
    const gem = find(attached(), 'gem');
    expect(gem.base.pos).toEqual([0, 2, 0]);
    // A quarter turn about Y.
    expect(gem.base.quat[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(gem.base.quat[3]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('offsets along the SOCKET axes, not the world ones', () => {
    // +x in a frame turned 90° about Y points along world −z. Offsetting
    // in world axes instead would make an offset drift as the host turns,
    // which is the whole reason to attach rather than position.
    const s = setPlacement(attached(), 'gem', { pos: [1, 0, 0] });
    const gem = find(s, 'gem');
    expect(gem.frame.pos[0]).toBeCloseTo(0, 6);
    expect(gem.frame.pos[1]).toBeCloseTo(2, 6);
    expect(gem.frame.pos[2]).toBeCloseTo(-1, 6);
  });

  it('composes its own rotation onto the socket frame', () => {
    // 90° about Y from the socket plus 90° about Y from the placement is
    // a half turn.
    const s = setPlacement(attached(), 'gem', { rot: [0, 90, 0] });
    const gem = find(s, 'gem');
    expect(gem.frame.quat[1]).toBeCloseTo(1, 6);
    expect(gem.frame.quat[3]).toBeCloseTo(0, 6);
  });
});

describe('localPosFrom', () => {
  it('inverts the forward placement exactly', () => {
    const base = find(
      setAttachment(scene(), 'gem', { to: 'tower', socket: 'peg' }),
      'gem',
    ).base;
    for (const want of [
      [0, 0, 0],
      [1, 0, 0],
      [-2.5, 3, 0.5],
      [7, -1.2, -4],
    ] as [number, number, number][]) {
      // Forward: the same composition placeScene does.
      const off = quatRotateVec3(base.quat, want);
      const world: [number, number, number] = [
        base.pos[0] + off[0],
        base.pos[1] + off[1],
        base.pos[2] + off[2],
      ];
      expect(localPosFrom(base, world)).toEqual(want);
    }
  });

  it('is the identity in an unrotated frame', () => {
    const base = { pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as const };
    expect(localPosFrom(base, [4, -1, 2])).toEqual([4, -1, 2]);
  });

  it('rounds back onto the 0.1 authoring grid', () => {
    // The gizmo snaps in WORLD space; un-rotating that lands just off the
    // grid, and the file must never see the float noise.
    const base = { pos: [0, 0, 0] as [number, number, number], quat: quatFromEulerZXYDeg([0, 37, 0]) };
    const [x, y, z] = localPosFrom(base, [3, 0, 5]);
    for (const v of [x, y, z]) {
      expect(Math.abs(v * 10 - Math.round(v * 10))).toBeLessThan(1e-9);
    }
  });
});
