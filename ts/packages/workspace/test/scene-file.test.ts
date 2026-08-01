import { describe, expect, it } from 'vitest';
import { parseScene, serializeScene, SCENE_FORMAT } from '../src/lib/scene-file.js';
import {
  addInstance,
  emptyScene,
  setAnimation,
  setAttachment,
  type Scene,
} from '../src/lib/scene.js';

// The `*.scene.json` file. Not a Cuboidy file — the SPEC says nothing
// about composition, so this format is the workspace's and is versioned
// on its own.

const built = (): Scene => {
  let s = addInstance(addInstance(emptyScene('armed'), 'knight'), 'sword');
  s = setAttachment(s, 'sword', { to: 'knight', socket: 'weapon' });
  s = setAnimation(s, 'knight', { clip: 'walk', playing: true });
  return s;
};

describe('round trip', () => {
  it('survives save → load unchanged', () => {
    const before = built();
    const after = parseScene(serializeScene(before), 'x');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.scene).toEqual(before);
  });

  it('omits defaults, so a file shows only what was decided', () => {
    // Scenes are read and diffed by hand; a file full of zeroes buries
    // the parts that matter.
    const text = serializeScene(addInstance(emptyScene('s'), 'knight'));
    expect(text).not.toContain('"pos"');
    expect(text).not.toContain('"attach"');
    expect(text).not.toContain('"anim"');
    expect(JSON.parse(text).instances[0]).toEqual({
      id: 'knight',
      model: 'knight',
    });
  });

  it('keeps a placement that is not the origin', () => {
    const s = emptyScene('s');
    s.instances.push({
      id: 'a',
      model: 'knight',
      placement: { pos: [1, 2, 3] },
    });
    expect(serializeScene(s)).toContain('"pos"');
    const back = parseScene(serializeScene(s), 'x');
    expect(back.ok && back.scene.instances[0]?.placement.pos).toEqual([1, 2, 3]);
  });
});

describe('rejection', () => {
  it('says so when handed a Cuboidy model instead of a scene', () => {
    // The likeliest wrong file, since scenes live in the same folder as
    // the packages they reference.
    const r = parseScene(
      JSON.stringify({ name: 'knight', parts: [{ name: 'body' }] }),
      'x',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/looks like a Cuboidy model/);
  });

  it('rejects a future version rather than guessing at it', () => {
    const r = parseScene(
      JSON.stringify({ format: SCENE_FORMAT, version: 99, instances: [] }),
      'x',
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
      'x',
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
      'x',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/instances\[1\]/);
  });

  it('reports bad JSON as bad JSON', () => {
    const r = parseScene('{ not json', 'x');
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
      'x',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scene.instances[0]?.attach?.to).toBe('ghost');
  });

  it('takes its name from the filename when the file omits one', () => {
    const r = parseScene(
      JSON.stringify({ format: SCENE_FORMAT, version: 1, instances: [] }),
      'parade',
    );
    expect(r.ok && r.scene.name).toBe('parade');
  });

  it('defaults a malformed pos to the origin rather than failing', () => {
    const r = parseScene(
      JSON.stringify({
        format: SCENE_FORMAT,
        version: 1,
        instances: [{ id: 'a', model: 'knight', pos: [1, 'x'] }],
      }),
      'x',
    );
    expect(r.ok && r.scene.instances[0]?.placement.pos).toEqual([0, 0, 0]);
  });
});
