import { describe, expect, it } from 'vitest';
import {
  addInstance,
  emptyScene,
  setAttachment,
  setPlacement,
  type Scene,
} from '../src/lib/scene-doc.js';
import { placeScene } from '../src/lib/scene-resolve.js';
import { drawTree, panelTree } from '../src/lib/scene-tree.js';
import { towerAndGemLibrary } from './fixtures.js';

// Where an instance ends up, and how a drag in the 3D view gets back to
// the value that put it there.
//
// The move gizmo edits a WORLD transform — an attached guest is drawn at
// its resolved frame, not nested under its host — so every drag crosses
// the same conversion. A sign error there would misplace everything
// hanging off a rotated socket and look like the socket was wrong.

// The socket is turned a quarter turn about Y, so the guest's frame is
// genuinely rotated rather than a translated copy of the world's.
const LIBRARY = towerAndGemLibrary({ socketRot: [0, 90, 0] });

const scene = (): Scene =>
  addInstance(addInstance(emptyScene(), 'tower'), 'gem');

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
    expect(gem.attachAt).toBeNull();
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

  it('reports the socket in the HOST MODEL space, not the world', () => {
    const gem = find(attached(), 'gem');
    expect(gem.attachAt?.pos).toEqual([0, 2, 0]);
    // A quarter turn about Y.
    expect(gem.attachAt!.quat[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(gem.attachAt!.quat[3]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('keeps that frame unchanged when the HOST moves', () => {
    // The distinction that lets the 3D view nest: the host's own group
    // carries its model into the world, so what a guest needs on top is
    // the socket within that model — a value the host's placement must
    // not appear in, or it would be applied twice.
    const s = setPlacement(attached(), 'tower', { pos: [10, 0, 5] });
    const gem = find(s, 'gem');
    expect(gem.attachAt?.pos).toEqual([0, 2, 0]);
    // The resolved world frame does move, of course.
    expect(gem.frame.pos).toEqual([10, 2, 5]);
  });

  it('has no socket frame when the attachment did not resolve', () => {
    // Nothing to nest under, so the 3D view leaves it at the root and
    // draws it where placeScene put it.
    const s = setAttachment(scene(), 'gem', { to: 'tower', socket: 'gone' });
    const gem = find(s, 'gem');
    expect(gem.attachAt).toBeNull();
    expect(gem.problem).toMatch(/does not publish/);
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

// The two trees. The panel nests by what the scene CLAIMS so a problem
// stays attributable to the host it names; the 3D nests by what RESOLVED,
// because nesting is a transform and an unresolved guest has none to
// inherit.
describe('drawTree', () => {
  const attached = (): Scene =>
    setAttachment(scene(), 'gem', { to: 'tower', socket: 'peg' });

  it('nests a resolved guest under its host', () => {
    const roots = drawTree(placeScene(attached(), LIBRARY));
    expect(roots.map((n) => n.placed.instance.id)).toEqual(['tower']);
    expect(roots[0]?.children.map((n) => n.placed.instance.id)).toEqual(['gem']);
  });

  it('leaves an UNRESOLVED attachment at the root', () => {
    // placeScene draws it at its own placement in world space; hanging it
    // off the host would move it somewhere nothing asked for.
    const s = setAttachment(scene(), 'gem', { to: 'tower', socket: 'gone' });
    const placed = placeScene(s, LIBRARY);
    expect(drawTree(placed).map((n) => n.placed.instance.id)).toEqual([
      'tower',
      'gem',
    ]);
    // The panel still shows the claim, under a socket row it invented for
    // the name — so the problem has a row to sit on.
    const tower = panelTree(placed)[0]!;
    expect(tower.children).toHaveLength(2); // 'peg', then the phantom
    expect(tower.children[1]!.children).toHaveLength(1);
  });

  it('survives a cycle rather than dropping both instances', () => {
    // setAttachment refuses one, but a hand-edited scene file is not
    // required to. Before this, a cycle left both as somebody's child and
    // neither in the roots — absent from the panel and, once the 3D view
    // nested too, from the screen.
    const s: Scene = {
      instances: [
        {
          id: 'a',
          model: 'tower',
          placement: { pos: [0, 0, 0] },
          attach: { to: 'b', socket: 'peg' },
        },
        {
          id: 'b',
          model: 'tower',
          placement: { pos: [0, 0, 0] },
          attach: { to: 'a', socket: 'peg' },
        },
      ],
    };
    const placed = placeScene(s, LIBRARY);
    const ids = (ns: ReturnType<typeof drawTree>): string[] =>
      ns.flatMap((n) => [n.placed.instance.id, ...ids(n.children)]);
    expect(ids(drawTree(placed)).sort()).toEqual(['a', 'b']);
    // Both reach the panel too, each at the top rather than inside the
    // other.
    expect(panelTree(placed).map((r) => r.key).sort()).toEqual([
      'inst:a',
      'inst:b',
    ]);
  });
});
