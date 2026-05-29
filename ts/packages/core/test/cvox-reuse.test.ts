import { describe, expect, it } from 'vitest';
import { parseCvox } from '../src/cvox/parse.js';
import { serializeCvox } from '../src/cvox/serialize.js';
import type { Cvox, Part } from '../src/cvox/types.js';

// SPEC §7.5.1: part reuse — `clone` (verbatim) and `mirror <axis>` (reflected).

function ok(input: string): Cvox {
  const r = parseCvox(input);
  if (!r.ok) throw new Error(`parse failed: ${r.code}: ${r.message}`);
  return r.value;
}

function part(cvox: Cvox, name: string): Part {
  const p = cvox.parts.find((q) => q.name === name);
  if (p === undefined) throw new Error(`no part '${name}'`);
  return p;
}

const PAL = 'palette #FF0000 #00FF00 #0000FF';

describe('cvox reuse — clone (verbatim)', () => {
  const src = `${PAL}
part a
    size 3 1 1
    pivot 0 0 0.5
    voxels { 012 }
part c clone a`;

  it('carries from = { part } with no mirror', () => {
    const c = part(ok(src), 'c');
    expect(c.from).toEqual({ part: 'a' });
  });

  it('reuses size, voxels, and pivot verbatim', () => {
    const cvox = ok(src);
    const a = part(cvox, 'a');
    const c = part(cvox, 'c');
    expect(c.size).toEqual(a.size);
    expect(c.voxels).toEqual(a.voxels);
    expect(c.pivot).toEqual(a.pivot);
    expect(c.voxels[0]![0]).toEqual([0, 1, 2]);
  });
});

describe('cvox reuse — mirror (reflected)', () => {
  const src = `${PAL}
part a
    size 3 1 1
    pivot 0 0 0.5
    voxels { 012 }
part b mirror a`;

  it('carries from = { part, mirror: "x" } (default axis x)', () => {
    expect(part(ok(src), 'b').from).toEqual({ part: 'a', mirror: 'x' });
  });

  it('reverses each row in X', () => {
    expect(part(ok(src), 'b').voxels[0]![0]).toEqual([2, 1, 0]);
  });

  it('reflects pivot.x to (W - x), keeping y and z', () => {
    expect(part(ok(src), 'b').pivot.pos).toEqual({ x: 3, y: 0, z: 0.5 });
  });

  it('mirror on z reverses the row (layer) order in Z', () => {
    const z = ok(`${PAL}
part a
    size 1 1 3
    voxels { 0 1 2 }
part b mirror a z`);
    // a layer is voxels[y][z][x]; for D=3 the three z-rows are [0],[1],[2]
    expect(part(z, 'a').voxels[0]).toEqual([[0], [1], [2]]);
    expect(part(z, 'b').voxels[0]).toEqual([[2], [1], [0]]);
    expect(part(z, 'b').from).toEqual({ part: 'a', mirror: 'z' });
  });

  it('resolves a referent declared AFTER the reuse part (free-order)', () => {
    const cvox = ok(`${PAL}
part b mirror a
part a
    size 3 1 1
    voxels { 012 }`);
    expect(part(cvox, 'b').voxels[0]![0]).toEqual([2, 1, 0]);
  });
});

describe('cvox reuse — serialization round-trips, not expanded', () => {
  it('emits the clone/mirror one-liner instead of a body', () => {
    const text = serializeCvox(
      ok(`${PAL}
part a
    size 3 1 1
    voxels { 012 }
part b mirror a
part c clone a`),
    );
    expect(text).toContain('part b mirror a\n');
    expect(text).toContain('part c clone a\n');
    // the reuse parts do NOT emit their own size/voxels body
    expect(text).not.toContain('part b\n');
    expect(text).not.toContain('part c\n');
  });

  it('omits the default mirror axis x, keeps a non-default axis', () => {
    const text = serializeCvox(
      ok(`${PAL}
part a
    size 1 1 3
    voxels { 0 1 2 }
part bx mirror a x
part bz mirror a z`),
    );
    expect(text).toContain('part bx mirror a\n'); // explicit x normalized away
    expect(text).toContain('part bz mirror a z\n');
  });

  it('is idempotent across a parse/serialize round-trip', () => {
    const src = `${PAL}
part a
    size 3 1 1
    pivot 0 0 0.5
    voxels { 012 }
part b mirror a
part c clone a`;
    const once = serializeCvox(ok(src));
    const twice = serializeCvox(ok(once));
    expect(twice).toBe(once);
  });
});

describe('cvox reuse — errors', () => {
  function code(input: string): string {
    const r = parseCvox(input);
    return r.ok ? 'OK' : r.code;
  }

  it('missing: clone references an unknown part', () => {
    expect(code(`${PAL}\npart b clone nope`)).toBe('missing');
  });

  it('invalid-value: reuse chain (mirror of a mirror)', () => {
    expect(
      code(`${PAL}
part a
    size 1 1 1
    voxels { 0 }
part b mirror a
part c mirror b`),
    ).toBe('invalid-value');
  });

  it('invalid-value: a part cannot clone itself', () => {
    expect(code(`${PAL}\npart a clone a`)).toBe('invalid-value');
  });

  it('invalid-value: a reuse part must not declare a body', () => {
    expect(
      code(`${PAL}
part a
    size 1 1 1
    voxels { 0 }
part b clone a
    size 1 1 1`),
    ).toBe('invalid-value');
  });

  it('missing: clone/mirror at file scope (no part header)', () => {
    expect(code(`${PAL}\nclone a`)).toBe('missing');
  });

  it('invalid-value: clone/mirror cannot be a part name (reserved keyword)', () => {
    expect(code(`${PAL}\npart clone\n    size 1 1 1\n    voxels { 0 }`)).toBe(
      'invalid-value',
    );
  });
});
