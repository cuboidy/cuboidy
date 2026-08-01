import { describe, expect, it } from 'vitest';
import { buildLibrary } from '../src/lib/library.js';
import {
  addInstance,
  anyPlaying,
  emptyScene,
  freshId,
  placeScene,
  removeInstance,
  sceneTree,
  setAnimation,
  setAttachment,
  type Scene,
} from '../src/lib/scene.js';

// The scene layer: the format the SPEC deliberately does not define. A
// model says what it OFFERS (§6.12) and never what it is used in, so the
// arrangement is the app's. These pin the rules that arrangement has.

const host = (name: string) =>
  JSON.stringify({
    name,
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

const guest = JSON.stringify({
  name: 'gem',
  palette: ['#00FF00'],
  parts: [{ name: 'gem', geometry: { size: [1, 1, 1], voxels: [['0']] } }],
});

const LIBRARY = buildLibrary(
  'lib',
  new Map([
    ['tower/cuboidy.json', host('tower')],
    ['gem/cuboidy.json', guest],
  ]),
);

const scene = (): Scene =>
  addInstance(addInstance(emptyScene('s'), 'tower'), 'gem');

describe('instance ids', () => {
  it('names the first copy after the model and numbers the rest', () => {
    // Ids show up in the tree and in the saved file, so they are legible
    // rather than uuids.
    let s = emptyScene();
    s = addInstance(s, 'tower');
    s = addInstance(s, 'tower');
    s = addInstance(s, 'tower');
    expect(s.instances.map((i) => i.id)).toEqual(['tower', 'tower-2', 'tower-3']);
  });

  it('skips an id already taken', () => {
    const s = addInstance(addInstance(emptyScene(), 'tower'), 'tower');
    expect(freshId(s, 'tower')).toBe('tower-3');
  });
});

describe('attachment', () => {
  it('puts the guest ORIGIN on the published socket (§6.12)', () => {
    // The tower's pivot is at y=0 and its socket 2 above, so a guest
    // attached there sits at y=2 — its model origin, not its part pivot.
    const s = setAttachment(scene(), 'gem', { to: 'tower', socket: 'peg' });
    const placed = placeScene(s, LIBRARY);
    const gem = placed.find((p) => p.instance.id === 'gem');
    expect(gem?.frame.pos).toEqual([0, 2, 0]);
    expect(gem?.problem).toBeUndefined();
  });

  it('carries a guest when its host moves', () => {
    let s = setAttachment(scene(), 'gem', { to: 'tower', socket: 'peg' });
    s = {
      ...s,
      instances: s.instances.map((i) =>
        i.id === 'tower' ? { ...i, placement: { pos: [10, 0, 5] } } : i,
      ),
    };
    const gem = placeScene(s, LIBRARY).find((p) => p.instance.id === 'gem');
    expect(gem?.frame.pos).toEqual([10, 2, 5]);
  });

  it('reports a socket the host does not publish, rather than dropping it', () => {
    // A scene referencing a socket a model has since stopped publishing
    // must still open — with the reason on the instance.
    const s = setAttachment(scene(), 'gem', { to: 'tower', socket: 'gone' });
    const gem = placeScene(s, LIBRARY).find((p) => p.instance.id === 'gem');
    expect(gem?.problem).toMatch(/does not publish a socket called 'gone'/);
    // Still drawn, at its own placement.
    expect(gem?.frame.pos).toEqual([0, 0, 0]);
  });

  it('reports a host that is not in the scene', () => {
    const s = setAttachment(scene(), 'gem', { to: 'ghost', socket: 'peg' });
    const gem = placeScene(s, LIBRARY).find((p) => p.instance.id === 'gem');
    expect(gem?.problem).toMatch(/not in the scene/);
  });

  it('refuses a cycle', () => {
    // A flat list makes a cycle representable, so it has to be refused
    // rather than prevented by the shape — and refusing beats hanging.
    let s = setAttachment(scene(), 'gem', { to: 'tower', socket: 'peg' });
    s = setAttachment(s, 'tower', { to: 'gem', socket: 'peg' });
    expect(s.instances.find((i) => i.id === 'tower')?.attach).toBeUndefined();
  });

  it('refuses attaching an instance to itself', () => {
    const s = setAttachment(scene(), 'gem', { to: 'gem', socket: 'peg' });
    expect(s.instances.find((i) => i.id === 'gem')?.attach).toBeUndefined();
  });
});

describe('removal', () => {
  it('detaches what a removed host carried instead of deleting it', () => {
    // Removing one model should not silently take others with it.
    let s = setAttachment(scene(), 'gem', { to: 'tower', socket: 'peg' });
    s = removeInstance(s, 'tower');
    expect(s.instances.map((i) => i.id)).toEqual(['gem']);
    expect(s.instances[0]?.attach).toBeUndefined();
  });
});

describe('sceneTree', () => {
  it('nests a guest under its host', () => {
    const s = setAttachment(scene(), 'gem', { to: 'tower', socket: 'peg' });
    const roots = sceneTree(placeScene(s, LIBRARY));
    expect(roots.map((n) => n.placed.instance.id)).toEqual(['tower']);
    expect(roots[0]?.children.map((n) => n.placed.instance.id)).toEqual(['gem']);
  });

  it('shows an instance whose host is missing at the top, not nowhere', () => {
    const s = setAttachment(scene(), 'gem', { to: 'ghost', socket: 'peg' });
    const roots = sceneTree(placeScene(s, LIBRARY));
    expect(roots.map((n) => n.placed.instance.id).sort()).toEqual(['gem', 'tower']);
  });
});

// ── playback ──────────────────────────────────────────────────────────

// A model whose single part swings 90° about Z at the half-second, with
// its socket 2 above the pivot — so the socket sweeps from (0,2,0) to
// (−2,0,0) and back. Anything attached has to make the same trip.
const SWINGER = JSON.stringify({
  name: 'swinger',
  palette: ['#FF0000'],
  parts: [
    {
      name: 'arm',
      geometry: {
        size: [1, 2, 1],
        pivot: { pos: [0, 0, 0] },
        sockets: [{ name: 'tip', pos: [0, 2, 0] }],
        voxels: [['0'], ['0']],
      },
    },
  ],
  sockets: { peg: { part: 'arm', socket: 'tip' } },
  animations: {
    swing: {
      duration: 1,
      loop: true,
      parts: {
        arm: {
          '0.0': { rot: [0, 0, 0] },
          '0.5': { rot: [0, 0, 90] },
          '1.0': { rot: [0, 0, 0] },
        },
      },
    },
  },
});

const ANIM_LIB = buildLibrary(
  'lib',
  new Map([
    ['swinger/cuboidy.json', SWINGER],
    ['gem/cuboidy.json', guest],
  ]),
);

const animScene = (): Scene =>
  addInstance(addInstance(emptyScene('s'), 'swinger'), 'gem');

describe('animation', () => {
  it('anyPlaying is false until something plays, so the clock can idle', () => {
    let s = animScene();
    expect(anyPlaying(s)).toBe(false);
    s = setAnimation(s, 'swinger', { clip: 'swing', playing: true });
    expect(anyPlaying(s)).toBe(true);
    s = setAnimation(s, 'swinger', { clip: 'swing', playing: false });
    expect(anyPlaying(s)).toBe(false);
  });

  it('samples the selected clip at the scene time', () => {
    const s = setAnimation(animScene(), 'swinger', { clip: 'swing', playing: true });
    const at = (t: number) =>
      placeScene(s, ANIM_LIB, t).find((p) => p.instance.id === 'swinger')?.poses;
    expect(at(0)?.get('arm')?.rot).toEqual([0, 0, 0]);
    expect(at(0.5)?.get('arm')?.rot).toEqual([0, 0, 90]);
  });

  it('CARRIES an attached guest as the socket moves', () => {
    // The point of attaching to a socket rather than to a position. At
    // rest the tip is 2 above the pivot; a quarter-turn later the arm has
    // swung it round to −X.
    let s = animScene();
    s = setAttachment(s, 'gem', { to: 'swinger', socket: 'peg' });
    s = setAnimation(s, 'swinger', { clip: 'swing', playing: true });
    const gemAt = (t: number) =>
      placeScene(s, ANIM_LIB, t).find((p) => p.instance.id === 'gem')!.frame.pos;
    expect(gemAt(0)[1]).toBeCloseTo(2, 6);
    const swung = gemAt(0.5);
    expect(swung[0]).toBeCloseTo(-2, 6);
    expect(swung[1]).toBeCloseTo(0, 6);
  });

  it('a paused instance holds its pose rather than snapping to rest', () => {
    // Pausing should show the frame you were looking at.
    const s = setAnimation(animScene(), 'swinger', { clip: 'swing', playing: false });
    const poses = placeScene(s, ANIM_LIB, 0.5).find(
      (p) => p.instance.id === 'swinger',
    )?.poses;
    expect(poses).not.toBeNull();
    expect(poses?.get('arm')?.rot).toEqual([0, 0, 0]);
  });

  it('stopping returns the rest pose', () => {
    let s = setAnimation(animScene(), 'swinger', { clip: 'swing', playing: true });
    s = setAnimation(s, 'swinger', null);
    const p = placeScene(s, ANIM_LIB, 0.5).find((x) => x.instance.id === 'swinger');
    expect(p?.poses).toBeNull();
  });

  it('a clip the model no longer defines falls back to the rest pose', () => {
    const s = setAnimation(animScene(), 'swinger', { clip: 'gone', playing: true });
    const p = placeScene(s, ANIM_LIB, 0.5).find((x) => x.instance.id === 'swinger');
    expect(p?.poses).toBeNull();
  });
});
