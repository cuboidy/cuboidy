import { describe, expect, it } from 'vitest';
import { buildLibrary } from '../src/lib/library.js';
import { GEM_JSON, towerAndGemLibrary } from './fixtures.js';
import {
  addInstance,
  anyPlaying,
  emptyScene,
  freshId,
  removeInstance,
  renameInstance,
  setAnimation,
  setAttachment,
  type Scene,
} from '../src/lib/scene-doc.js';
import { placeScene } from '../src/lib/scene-resolve.js';
import { panelTree, type PanelRow } from '../src/lib/scene-tree.js';

// The scene layer: the format the SPEC deliberately does not define. A
// model says what it OFFERS (§6.12) and never what it is used in, so the
// arrangement is the app's. These pin the rules that arrangement has.

const LIBRARY = towerAndGemLibrary();

const scene = (): Scene =>
  addInstance(addInstance(emptyScene(), 'tower'), 'gem');

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

describe('renameInstance', () => {
  it('carries the attachments that point at it', () => {
    // An id is a reference, not a label. Renaming only the instance would
    // leave its guests naming a host that no longer exists — and they
    // would quietly fall back to the scene root rather than complain.
    let s = setAttachment(scene(), 'gem', { to: 'tower', socket: 'peg' });
    s = renameInstance(s, 'tower', 'plinth');
    expect(s.instances.map((i) => i.id)).toEqual(['plinth', 'gem']);
    expect(s.instances[1]?.attach).toEqual({ to: 'plinth', socket: 'peg' });
    // And it still resolves to the same place.
    const gem = placeScene(s, LIBRARY).find((p) => p.instance.id === 'gem');
    expect(gem?.frame.pos).toEqual([0, 2, 0]);
    expect(gem?.problem).toBeUndefined();
  });

  it('refuses a name another instance already has', () => {
    // parseScene rejects duplicate ids, so allowing one here would write a
    // file this app cannot read back.
    const s = renameInstance(scene(), 'gem', 'tower');
    expect(s.instances.map((i) => i.id)).toEqual(['tower', 'gem']);
  });

  it('leaves an empty or unchanged name alone', () => {
    expect(renameInstance(scene(), 'gem', '   ').instances[1]?.id).toBe('gem');
    expect(renameInstance(scene(), 'gem', 'gem').instances[1]?.id).toBe('gem');
  });

  it('ignores an id that is not in the scene', () => {
    const s = scene();
    expect(renameInstance(s, 'ghost', 'x')).toBe(s);
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

// The panel's tree puts a SOCKET row between a host and its guests, so
// what a guest hangs from is a thing on screen rather than a note beside
// a name.
describe('panelTree', () => {
  const idsOf = (rows: readonly PanelRow[]): string[] =>
    rows.map((r) => (r.kind === 'instance' ? r.placed.instance.id : r.socket));

  it('nests a guest under the SOCKET it names, under its host', () => {
    const s = setAttachment(scene(), 'gem', { to: 'tower', socket: 'peg' });
    const rows = panelTree(placeScene(s, LIBRARY));
    expect(idsOf(rows)).toEqual(['tower']);
    const tower = rows[0]!;
    expect(idsOf(tower.children)).toEqual(['peg']);
    expect(idsOf(tower.children[0]!.children)).toEqual(['gem']);
  });

  it('shows a published socket that is empty', () => {
    // What a model OFFERS (§6.12) is worth seeing before anything is on
    // it — that is the row you are about to drag onto.
    const rows = panelTree(placeScene(scene(), LIBRARY));
    const tower = rows.find((r) => r.kind === 'instance' && r.key === 'inst:tower')!;
    expect(idsOf(tower.children)).toEqual(['peg']);
    expect(tower.children[0]!.children).toEqual([]);
  });

  it('gives a model that publishes nothing no socket rows', () => {
    const rows = panelTree(placeScene(scene(), LIBRARY));
    const gem = rows.find((r) => r.kind === 'instance' && r.key === 'inst:gem')!;
    expect(gem.children).toEqual([]);
  });

  it('invents a row for a socket the host has stopped publishing', () => {
    // The guest has to be SOMEWHERE, and hanging it directly off the host
    // would quietly imply the attachment was fine.
    const s = setAttachment(scene(), 'gem', { to: 'tower', socket: 'gone' });
    const tower = panelTree(placeScene(s, LIBRARY))[0]!;
    expect(idsOf(tower.children)).toEqual(['peg', 'gone']);
    const gone = tower.children[1]!;
    expect(gone.kind === 'socket' && gone.published).toBe(false);
    expect(idsOf(gone.children)).toEqual(['gem']);
  });

  it('shows an instance whose host is missing at the top, not nowhere', () => {
    const s = setAttachment(scene(), 'gem', { to: 'ghost', socket: 'peg' });
    const rows = panelTree(placeScene(s, LIBRARY));
    expect(idsOf(rows).sort()).toEqual(['gem', 'tower']);
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
    ['gem/cuboidy.json', GEM_JSON],
  ]),
);

const animScene = (): Scene =>
  addInstance(addInstance(emptyScene(), 'swinger'), 'gem');

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

  it('a paused instance reads its OWN frozen point, not the shared clock', () => {
    // The clock keeps running while other actors play, so a paused one
    // that read the shared time would keep animating. It holds `at`.
    const s = setAnimation(animScene(), 'swinger', {
      clip: 'swing',
      playing: false,
      at: 0.5,
    });
    const poses = placeScene(s, ANIM_LIB, 999).find(
      (p) => p.instance.id === 'swinger',
    )?.poses;
    expect(poses?.get('arm')?.rot).toEqual([0, 0, 90]);
  });

  it('a paused instance with no frozen point holds frame zero', () => {
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

  it('rest mode ignores every clip, playing or paused', () => {
    // Rig view is not "playback paused" — that is per instance and holds
    // whatever frame each was stopped at. It is the arrangement itself,
    // with animation out of the way of reading it.
    let s = setAnimation(animScene(), 'swinger', { clip: 'swing', playing: true });
    s = setAttachment(s, 'gem', { to: 'swinger', socket: 'peg' });
    const placed = placeScene(s, ANIM_LIB, 0.5, { rest: true });
    expect(placed.find((p) => p.instance.id === 'swinger')?.poses).toBeNull();
    // And the guest goes back to the socket's rest position with it.
    expect(placed.find((p) => p.instance.id === 'gem')?.frame.pos[1]).toBeCloseTo(
      2,
      6,
    );
  });

  it('rest mode keeps the frozen point of a paused instance for later', () => {
    // Switching views must not lose where playback was stopped.
    const s = setAnimation(animScene(), 'swinger', {
      clip: 'swing',
      playing: false,
      at: 0.5,
    });
    expect(placeScene(s, ANIM_LIB, 0, { rest: true })[0]?.poses).toBeNull();
    expect(
      placeScene(s, ANIM_LIB, 0).find((p) => p.instance.id === 'swinger')?.poses
        ?.get('arm')?.rot,
    ).toEqual([0, 0, 90]);
  });
});
