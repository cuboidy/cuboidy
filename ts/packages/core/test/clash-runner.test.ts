import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import {
  runClash,
  DEFAULT_MAX_DISTANCE,
  DEFAULT_SAMPLES,
} from '../src/cli/clash-runner.js';

// The fault this covers is the one nothing else in the toolchain sees: two
// surfaces in one place, facing the same way, in different colours. Lint is
// structural and never assembles, and a rest-pose render draws the dither
// without naming it, so a model can be clean by every other check and still
// hatch on screen.

async function write(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cuboidy-clash-test-'));
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(dir, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }
  return dir;
}

// A geometry file's `palette` is a PATH, never an inline object — the schema
// rejects the object form outright.
const PALETTE = JSON.stringify({ colors: ['#FF0000', '#00FF00'] });

// Two 1x1x1 parts. `where` places the second one; the colours differ unless
// the caller says otherwise.
function model(
  where: [number, number, number],
  colours: [string, string] = ['0', '1'],
  rotation?: [number, number, number],
): Record<string, string> {
  return {
    'cuboidy.json': JSON.stringify({
      name: 'pair',
      version: '0.9',
      geometry: ['g.json'],
      parts: [
        { name: 'a', position: [0, 0, 0] },
        { name: 'b', position: where, ...(rotation ? { rotation } : {}) },
      ],
    }),
    'p.json': PALETTE,
    'g.json': JSON.stringify({
      version: '0.9',
      palette: 'p.json',
      parts: [
        {
          name: 'a',
          size: [1, 1, 1],
          pivot: { pos: [0, 0, 0] },
          voxels: [[colours[0]]],
        },
        {
          name: 'b',
          size: [1, 1, 1],
          pivot: { pos: [0, 0, 0] },
          voxels: [[colours[1]]],
        },
      ],
    }),
  };
}

const OPTS = { maxDistance: DEFAULT_MAX_DISTANCE, top: 40, samples: DEFAULT_SAMPLES };

/**
 * The pair, apart at rest, with a clip that slides `b` onto `a` and off
 * again. The rest pose is clean and the midpoint is not — which is the whole
 * reason a sweep exists, and the shape a rest-only check reported as fine.
 */
function slidingModel(): Record<string, string> {
  const m = model([2, 0, 0]);
  const manifest = JSON.parse(m['cuboidy.json']!) as Record<string, unknown>;
  manifest['animations'] = {
    slide: {
      duration: 2,
      loop: true,
      parts: {
        b: {
          '0.0': { pos: [0, 0, 0] },
          '1.0': { pos: [-2, 0, 0] },
          '2.0': { pos: [0, 0, 0] },
        },
      },
    },
  };
  return { ...m, 'cuboidy.json': JSON.stringify(manifest) };
}

describe('runClash', () => {
  it('finds two parts sharing one cell, and names both sides', async () => {
    const { text, exitCode } = await runClash(await write(model([0, 0, 0])), OPTS);
    // One cell, six faces a side, every one of them coincident and
    // differently coloured.
    expect(text).toContain('clashes: 6 visible  (exact 6');
    expect(exitCode).toBe(1);
    // The point of the tool: a finding you can act on without hunting.
    expect(text).toMatch(
      /clash d=0\.000\s+a cell\(0,0,0\) \+X #FF0000 {2}vs {2}b cell\(0,0,0\) \+X #00FF00/,
    );
  });

  it('says nothing when the two parts merely touch', async () => {
    // Adjacent cells share a plane, but each part's face there points away
    // from the other. Back-face culling keeps exactly one, so they never
    // compete — flagging this would fire on every joint in every model.
    const { text, exitCode } = await runClash(await write(model([1, 0, 0])), OPTS);
    expect(text).toContain('clashes: 0 visible');
    expect(exitCode).toBe(0);
  });

  it('ignores a coincidence the eye cannot see', async () => {
    // Same cell, same colour: the faces also share a normal, so they shade
    // identically and whichever the renderer picks draws the same pixel.
    const { text } = await runClash(
      await write(model([0, 0, 0], ['0', '0'])),
      OPTS,
    );
    expect(text).toContain('clashes: 0 visible');
  });

  it('measures separation along the normal, not centre to centre', async () => {
    // A part carrying a rest ROTATION. Its face CENTRES swing away from its
    // neighbour's, but the planes they lie on stay all but coincident, and it
    // is the planes a depth buffer fights over. So this is still caught with
    // the threshold wound down to a thousandth of a cell.
    //
    // Centre-to-centre distance was the first criterion tried and it reported
    // this model clean, because it mixed the separation of the planes with
    // how far the faces slide along them.
    const dir = await write(model([0, 0, 0], ['0', '1'], [0, 4, 0]));
    const tight = await runClash(dir, { ...OPTS, maxDistance: 0.001 });
    expect(tight.text).not.toContain('clashes: 0 visible');
    expect(tight.exitCode).toBe(1);
  });

  it('leaves faces that merely tile alone', async () => {
    // Two cells side by side. Their upward faces are exactly coplanar and
    // point the same way, but they are a whole cell apart in that plane, so
    // they cover none of each other and nothing competes. The lateral limit
    // is what keeps this from firing on every flat surface in every model.
    const { text, exitCode } = await runClash(await write(model([1, 0, 0])), OPTS);
    expect(text).toContain('clashes: 0 visible');
    expect(exitCode).toBe(0);
  });

  it('reports a summary alone when asked for no listing', async () => {
    const { text } = await runClash(await write(model([0, 0, 0])), {
      ...OPTS,
      top: 0,
    });
    expect(text).not.toContain('clash d=');
    expect(text).toContain('clashes: 6 visible');
  });

  it('counts a clash nobody can see separately, and does not fail on it', async () => {
    // Two 1x1x1 parts sharing a cell at the centre of a 5x5x5 block. They do
    // fight, but two solid cells of cover stand between them and every
    // direction, so no camera reaches it. Counting these beside the visible
    // ones makes two models incomparable: how deeply a rig buries its joints
    // is a property of the rig, not of its quality.
    const dir = await write({
      'p.json': PALETTE,
      'g.json': JSON.stringify({
        version: '0.9',
        palette: 'p.json',
        parts: [
          {
            name: 'cover',
            size: [5, 5, 5],
            pivot: { pos: [0, 0, 0] },
            voxels: Array.from({ length: 5 }, () =>
              Array.from({ length: 5 }, () => '00000'),
            ),
          },
          { name: 'x', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['0']] },
          { name: 'y', size: [1, 1, 1], pivot: { pos: [0, 0, 0] }, voxels: [['1']] },
        ],
      }),
      'cuboidy.json': JSON.stringify({
        name: 'buried',
        version: '0.9',
        geometry: ['g.json'],
        parts: [
          { name: 'cover', position: [0, 0, 0] },
          { name: 'x', position: [2, 2, 2] },
          { name: 'y', position: [2, 2, 2] },
        ],
      }),
    });
    const { text, exitCode } = await runClash(dir, OPTS);
    expect(text).toContain('clashes: 0 visible');
    expect(text).toMatch(/\+ [1-9]\d* hidden inside the model/);
    // Nothing an author could act on, so the gate stays green.
    expect(exitCode).toBe(0);
  });

  it('does not report a scaled part abutting itself', async () => {
    // The lateral test asks whether two coplanar faces cover any of each
    // other, and it used to ask that in VOXELS -- which assumed every drawn
    // face is one cell square. A `scale` under 1 makes them smaller, so
    // neighbouring faces sit closer than the constant while still merely
    // abutting, and every colour boundary on the part was reported.
    //
    // Two cells of one part can never overlap anyway: a part's voxels are on
    // an integer grid, so its coplanar faces are adjacent tiles. Measured on
    // a yeti's hand at `scale [0.93, 1, 0.93]`, the claw row in the outer
    // column scored 2 visible clashes and now scores 0 -- and a rule about
    // where detail colour may sit had already been written to explain that
    // artifact.
    const twoTone = {
      'p.json': PALETTE,
      'g.json': JSON.stringify({
        version: '0.9',
        palette: 'p.json',
        parts: [
          {
            name: 'slab',
            size: [1, 1, 2],
            pivot: { pos: [0.5, 0, 1] },
            // Two cells stacked in Z, different colours: their +X faces are
            // coplanar, co-facing, and abut along an edge.
            voxels: [['0', '1']],
          },
        ],
      }),
    };
    const build = (scale?: number[]): Record<string, string> => ({
      ...twoTone,
      'cuboidy.json': JSON.stringify({
        name: 'slab',
        version: '0.9',
        geometry: ['g.json'],
        parts: [{ name: 'slab', position: [0, 0, 0], ...(scale ? { scale } : {}) }],
      }),
    });
    for (const s of [undefined, [0.99, 1, 0.99], [0.95, 1, 0.95], [0.93, 1, 0.93], [0.6, 1, 0.6]]) {
      const { text } = await runClash(await write(build(s)), OPTS);
      expect(text, `scale ${JSON.stringify(s)}`).toContain('clashes: 0 visible');
    }
  });

  it('still finds a real coincidence between two scaled parts', async () => {
    // The other half: normalising by the faces' own size must not blind the
    // check on a model that scales. Two parts in the same place, different
    // colours, both scaled.
    const m = model([0, 0, 0]);
    const manifest = JSON.parse(m['cuboidy.json']!) as {
      parts: Array<Record<string, unknown>>;
    };
    for (const p of manifest.parts) p['scale'] = [0.93, 1, 0.93];
    const { text, exitCode } = await runClash(
      await write({ ...m, 'cuboidy.json': JSON.stringify(manifest) }),
      OPTS,
    );
    expect(text).toMatch(/clashes: [1-9]\d* visible/);
    expect(exitCode).toBe(1);
  });

  it('passes the loader exit code through for an unreadable model', async () => {
    const { exitCode } = await runClash(
      resolve(tmpdir(), 'cuboidy-clash-does-not-exist'),
      OPTS,
    );
    expect(exitCode).toBe(2);
  });

  it('finds a clash a clip creates and the rest pose does not have', async () => {
    // Why sweeping is the default. --rest-only reports this model clean,
    // which is true and useless: the flicker is at t=1.
    const dir = await write(slidingModel());
    const still = await runClash(dir, { ...OPTS, restOnly: true });
    expect(still.text).toContain('clashes: 0 visible');
    expect(still.exitCode).toBe(0);

    // No --anim: every clip, because a quick answer nobody asked to narrow
    // should be the safe one.
    const swept = await runClash(dir, OPTS);
    expect(swept.text).toContain('pose  rest');
    // The default step count is even, so the midpoint the parts actually
    // meet at is sampled rather than stepped over.
    expect(swept.text).toContain('slide t=1.000');
    // The listing follows the worst pose, and names both sides of the pair.
    expect(swept.text).toMatch(/clash d=0\.000.*\ba\b.*vs.*\bb\b/);
    expect(swept.text).toContain('slide t=1.000; rest 0');
    // A seam that only fights mid-swing still fails the gate.
    expect(swept.exitCode).toBe(1);
  });

  it('does not spend a pose on a looping clip\'s duplicated end', async () => {
    const dir = await write(slidingModel());
    const { text } = await runClash(dir, { ...OPTS, anim: 'slide', samples: 2 });
    // duration 2, looping, two steps: t=0 and t=1. Not t=2 — that is t=0
    // again, and sampling it twice buys nothing.
    expect(text).toContain('slide t=0.000');
    expect(text).toContain('slide t=1.000');
    expect(text).not.toContain('slide t=2.000');
  });

  it('checks one pinned time when asked', async () => {
    const dir = await write(slidingModel());
    const { text } = await runClash(dir, {
      ...OPTS,
      anim: 'slide',
      time: 1,
    });
    expect(text).toContain('slide t=1.000; rest 0');
    expect(text).not.toContain('t=0.250');
  });

  it('refuses rest-only together with a clip, rather than picking one', async () => {
    const dir = await write(slidingModel());
    const { text, exitCode } = await runClash(dir, {
      ...OPTS,
      restOnly: true,
      anim: 'slide',
    });
    expect(text).toContain('cannot be combined');
    expect(exitCode).toBe(2);
  });

  it('names the clips it has when asked for one it does not', async () => {
    const { text, exitCode } = await runClash(await write(slidingModel()), {
      ...OPTS,
      anim: 'walk',
    });
    expect(text).toContain('model has no animation "walk"');
    expect(text).toContain('has: slide');
    expect(exitCode).toBe(2);
  });

  it('ignores a part a clip hides', async () => {
    // `b` is drawn on top of `a` at rest, and the clip switches it off. A
    // hidden part has no surfaces, so the pose it is hidden in is clean —
    // counting the clash there would report a fault nobody can see.
    const m = model([0, 0, 0]);
    const manifest = JSON.parse(m['cuboidy.json']!) as Record<string, unknown>;
    manifest['animations'] = {
      vanish: {
        duration: 1,
        loop: false,
        parts: { b: { '0.0': { visible: false } } },
      },
    };
    const dir = await write({ ...m, 'cuboidy.json': JSON.stringify(manifest) });
    const { text } = await runClash(dir, { ...OPTS, anim: 'vanish', time: 0 });
    expect(text).toMatch(/^pose {2}vanish t=0\.000 {2}\s*0 visible/m);
  });
});
