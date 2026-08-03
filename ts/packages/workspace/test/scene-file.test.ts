import { describe, expect, it } from 'vitest';
import { parseScene, serializeScene, SCENE_FORMAT } from '../src/lib/scene-file.js';
import {
  addInstance,
  emptyScene,
  setAnimation,
  setAttachment,
  type Scene,
} from '../src/lib/scene-doc.js';

// The `*.scene.json` file. Not a Cuboidy file — the SPEC says nothing
// about composition, so this format is the workspace's and is versioned
// on its own.

const built = (): Scene => {
  let s = addInstance(addInstance(emptyScene(), 'knight'), 'sword');
  s = setAttachment(s, 'sword', { to: 'knight', socket: 'weapon' });
  return s;
};

describe('round trip', () => {
  it('survives save → load unchanged', () => {
    const before = built();
    const after = parseScene(serializeScene(before));
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.scene).toEqual(before);
  });

  it('does NOT carry playback across', () => {
    // A scene records an arrangement. What is playing is a viewing state,
    // like the camera and the view mode — and a file that started
    // something moving when opened would be a surprising file.
    const s = setAnimation(built(), 'knight', { clip: 'walk', playing: true });
    const text = serializeScene(s);
    expect(text).not.toContain('"anim"');
    const back = parseScene(text);
    expect(back.ok && back.scene.instances[0]?.anim).toBeUndefined();
  });

  it('opens a file that still has `anim`, without starting it', () => {
    const back = parseScene(
      JSON.stringify({
        format: SCENE_FORMAT,
        version: 1,
        instances: [
          { id: 'a', model: 'knight', anim: { clip: 'walk', playing: true } },
        ],
      }),
    );
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.scene.instances[0]?.anim).toBeUndefined();
  });

  it('omits defaults, so a file shows only what was decided', () => {
    // Scenes are read and diffed by hand; a file full of zeroes buries
    // the parts that matter.
    const text = serializeScene(addInstance(emptyScene(), 'knight'));
    expect(text).not.toContain('"pos"');
    expect(text).not.toContain('"attach"');
    expect(text).not.toContain('"anim"');
    expect(JSON.parse(text).instances[0]).toEqual({
      id: 'knight',
      model: 'knight',
    });
  });

  it('keeps a placement that is not the origin', () => {
    const s = emptyScene();
    s.instances.push({
      id: 'a',
      model: 'knight',
      placement: { pos: [1, 2, 3] },
    });
    expect(serializeScene(s)).toContain('"pos"');
    const back = parseScene(serializeScene(s));
    expect(back.ok && back.scene.instances[0]?.placement.pos).toEqual([1, 2, 3]);
  });

  it('keeps a rotation, and omits one that is all zero', () => {
    // A tweak rotation on a guest is the difference between a sword held
    // and a sword floating, so it is part of what the scene IS.
    const s = emptyScene();
    s.instances.push({
      id: 'a',
      model: 'sword',
      placement: { pos: [0, 0, 0], rot: [-90, 90, 0] },
    });
    s.instances.push({
      id: 'b',
      model: 'sword',
      placement: { pos: [0, 0, 0], rot: [0, 0, 0] },
    });
    const text = serializeScene(s);
    const back = parseScene(text);
    expect(back.ok && back.scene.instances[0]?.placement.rot).toEqual([
      -90, 90, 0,
    ]);
    expect(JSON.parse(text).instances[1]).toEqual({ id: 'b', model: 'sword' });
  });
});

describe('rejection', () => {
  it('says so when handed a Cuboidy model instead of a scene', () => {
    // The likeliest wrong file, since scenes live in the same folder as
    // the packages they reference.
    const r = parseScene(
      JSON.stringify({ name: 'knight', parts: [{ name: 'body' }] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/looks like a Cuboidy model/);
  });

  it('rejects a future version rather than guessing at it', () => {
    const r = parseScene(
      JSON.stringify({ format: SCENE_FORMAT, version: 99, instances: [] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/version 99/);
  });

  it('rejects duplicate ids, which would make an attachment ambiguous', () => {
    const r = parseScene(
      JSON.stringify({
        format: SCENE_FORMAT,
        version: 1,
        instances: [
          { id: 'a', model: 'knight' },
          { id: 'a', model: 'sword' },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duplicate id 'a'/);
  });

  it('names the instance an error is in', () => {
    const r = parseScene(
      JSON.stringify({
        format: SCENE_FORMAT,
        version: 1,
        instances: [{ id: 'a', model: 'knight' }, { id: 'b' }],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/instances\[1\]/);
  });

  it('reports bad JSON as bad JSON', () => {
    const r = parseScene('{ not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not JSON/);
  });
});

describe('tolerance', () => {
  it('ACCEPTS a host that is not in the file', () => {
    // A scene outlives the models it references; placeScene reports a
    // dangling attachment against the instance and still draws it.
    // Refusing to open the file would make a stale reference
    // unrecoverable in the app that could fix it.
    const r = parseScene(
      JSON.stringify({
        format: SCENE_FORMAT,
        version: 1,
        instances: [
          { id: 'sword', model: 'sword', attach: { to: 'ghost', socket: 'weapon' } },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scene.instances[0]?.attach?.to).toBe('ghost');
  });

  it('opens a file still carrying the old `name`, and ignores it', () => {
    // Every scene written before the filename became the identity has
    // one. They keep opening; there is simply nothing left for the field
    // to disagree with, and the next save drops it.
    const r = parseScene(
      JSON.stringify({
        format: SCENE_FORMAT,
        version: 1,
        name: 'something else entirely',
        instances: [{ id: 'a', model: 'knight' }],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scene).toEqual({
        instances: [{ id: 'a', model: 'knight', placement: { pos: [0, 0, 0] } }],
      });
      expect(serializeScene(r.scene)).not.toContain('"name"');
    }
  });

  it('defaults a malformed pos to the origin rather than failing', () => {
    const r = parseScene(
      JSON.stringify({
        format: SCENE_FORMAT,
        version: 1,
        instances: [{ id: 'a', model: 'knight', pos: [1, 'x'] }],
      }),
    );
    expect(r.ok && r.scene.instances[0]?.placement.pos).toEqual([0, 0, 0]);
  });
});
