import { describe, expect, it } from 'vitest';
import { buildSceneFromParts, type OrientedPart } from '../src/render/scene.js';
import { Framebuffer } from '../src/render/framebuffer.js';
import { QUAT_IDENTITY, quatFromEulerZXYDeg } from '../src/rig-transform.js';
import { AIR } from '../src/geometry/voxel-row.js';
import type { Palette, Part } from '../src/geometry/types.js';

const PALETTE: Palette = [
  { r: 255, g: 0, b: 0, a: 255 },
  { r: 0, g: 255, b: 0, a: 255 },
];

// A w×1×1 bar of palette-index-0 voxels with pivot at the origin corner.
function bar(w: number): Part {
  return {
    name: 'p',
    size: { w, h: 1, d: 1 },
    pivot: { pos: { x: 0, y: 0, z: 0 } },
    sockets: [],
    voxels: [[Array.from({ length: w }, () => 0)]],
  };
}

function oriented(part: Part, over: Partial<OrientedPart> = {}): OrientedPart {
  return {
    part,
    remap: null,
    transform: { pos: [0, 0, 0], quat: QUAT_IDENTITY },
    ...over,
  };
}

describe('buildSceneFromParts', () => {
  it('emits six faces for an identity-transform lone voxel', () => {
    const scene = buildSceneFromParts([oriented(bar(1))], PALETTE);
    expect(scene.quads).toHaveLength(6);
    expect(scene.min).toEqual([0, 0, 0]);
    expect(scene.max).toEqual([1, 1, 1]);
    expect(scene.center).toEqual([0.5, 0.5, 0.5]);
  });

  it('culls shared faces within a part', () => {
    const scene = buildSceneFromParts([oriented(bar(2))], PALETTE);
    expect(scene.quads).toHaveLength(10);
    expect(scene.max).toEqual([2, 1, 1]);
  });

  it('keeps cross-part seam faces (z-buffer hides them)', () => {
    const scene = buildSceneFromParts(
      [
        oriented(bar(1)),
        oriented(bar(1), { transform: { pos: [1, 0, 0], quat: QUAT_IDENTITY } }),
      ],
      PALETTE,
    );
    expect(scene.quads).toHaveLength(12);
    expect(scene.max).toEqual([2, 1, 1]);
  });

  it('applies the palette remap to quad colors', () => {
    const scene = buildSceneFromParts([oriented(bar(1), { remap: [1] })], PALETTE);
    expect(scene.quads[0]!.color).toEqual([0, 1, 0]);
  });

  it('subtracts the pivot before transforming (pivot lands at transform.pos)', () => {
    const part = bar(1);
    part.pivot = { pos: { x: 1, y: 0, z: 0 } };
    const scene = buildSceneFromParts(
      [oriented(part, { transform: { pos: [5, 0, 0], quat: QUAT_IDENTITY } })],
      PALETTE,
    );
    expect(scene.min).toEqual([4, 0, 0]);
    expect(scene.max).toEqual([5, 1, 1]);
  });

  it('rotates quads around the pivot (90° about Z turns the unit cube)', () => {
    const scene = buildSceneFromParts(
      [
        oriented(bar(1), {
          transform: { pos: [0, 0, 0], quat: quatFromEulerZXYDeg([0, 0, 90]) },
        }),
      ],
      PALETTE,
    );
    // Rz(90) maps (x, y) → (−y, x): the cube [0,1]³ lands at x ∈ [−1,0].
    expect(scene.quads).toHaveLength(6);
    expect(scene.min[0]).toBeCloseTo(-1, 10);
    expect(scene.max[0]).toBeCloseTo(0, 10);
    expect(scene.min[1]).toBeCloseTo(0, 10);
    expect(scene.max[1]).toBeCloseTo(1, 10);
    expect(scene.min[2]).toBeCloseTo(0, 10);
    expect(scene.max[2]).toBeCloseTo(1, 10);
  });

  it('returns the finite origin-anchored scene for all-AIR parts', () => {
    const part = bar(1);
    part.voxels = [[[AIR]]];
    const scene = buildSceneFromParts([oriented(part)], PALETTE);
    expect(scene.quads).toHaveLength(0);
    expect(scene.center).toEqual([0, 0, 0]);
  });
});

// SPEC §7.4: an index no palette entry defines renders as opaque magenta.
// The rasterizer used to assert its way past this with two non-null
// assertions and emit `color: undefined`, which `snapshot.ts` then
// multiplied by a light intensity. It was unreachable only because the CLI
// rejects such a model first — a renderer defended by its caller.
describe('buildSceneFromParts — unresolved color (§7.4)', () => {
  const onePart = (voxel: number) => ({
    part: {
      name: 'p',
      size: { w: 1, h: 1, d: 1 },
      pivot: { pos: { x: 0, y: 0, z: 0 } },
      sockets: [],
      voxels: [[[voxel]]],
    },
    remap: null,
    transform: { pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
  });

  it('paints an index past the palette magenta, never undefined', () => {
    const scene = buildSceneFromParts([onePart(5)], [
      { r: 0, g: 0, b: 0, a: 255 },
    ]);
    expect(scene.quads).toHaveLength(6);
    for (const q of scene.quads) expect(q.color).toEqual([1, 0, 1]);
  });

  it('survives a remap that does not cover the index', () => {
    const scene = buildSceneFromParts(
      [{ ...onePart(3), remap: [0] }],
      [{ r: 255, g: 0, b: 0, a: 255 }],
    );
    for (const q of scene.quads) expect(q.color).toEqual([1, 0, 1]);
  });

  it('still paints an in-range index its own color', () => {
    const scene = buildSceneFromParts([onePart(0)], [
      { r: 255, g: 0, b: 0, a: 255 },
    ]);
    for (const q of scene.quads) expect(q.color).toEqual([1, 0, 0]);
  });
});

// SPEC §7.4: alpha rides the palette entry, and it decides which faces
// exist as well as how they are drawn.
describe('buildSceneFromParts — translucency (§7.4)', () => {
  const OPAQUE = { r: 200, g: 80, b: 40, a: 255 };
  const GLASS = { r: 60, g: 160, b: 255, a: 0x55 };
  const flat = { pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] };
  const strip = (cells: number[]) => ({
    part: {
      name: 'p',
      size: { w: cells.length, h: 1, d: 1 },
      pivot: { pos: { x: 0, y: 0, z: 0 } },
      sockets: [],
      voxels: [[cells]],
    },
    remap: null,
    transform: flat,
  });

  it('carries the palette entry alpha onto every quad', () => {
    const s = buildSceneFromParts([strip([0, 1])], [OPAQUE, GLASS]);
    const alphas = new Set(s.quads.map((q) => q.alpha));
    expect([...alphas].sort()).toEqual([0x55 / 255, 1]);
  });

  it('keeps an opaque face a translucent neighbour would have hidden', () => {
    // The whole point: the wall behind the glass must still have a face.
    const withGlass = buildSceneFromParts([strip([0, 1])], [OPAQUE, GLASS]);
    const bothOpaque = buildSceneFromParts([strip([0, 1])], [OPAQUE, OPAQUE]);
    expect(withGlass.quads.length).toBeGreaterThan(bothOpaque.quads.length);
  });

  it('drops the faces inside a run of one translucent color', () => {
    const one = buildSceneFromParts([strip([0])], [GLASS]);
    const three = buildSceneFromParts([strip([0, 0, 0])], [GLASS]);
    expect(three.quads.length).toBe(one.quads.length * 3 - 4);
  });

  it('drops them between two different translucent colors as well', () => {
    const GLASS2 = { r: 60, g: 255, b: 160, a: 0x55 };
    const same = buildSceneFromParts([strip([0, 0])], [GLASS, GLASS2]);
    const mixed = buildSceneFromParts([strip([0, 1])], [GLASS, GLASS2]);
    expect(mixed.quads.length).toBe(same.quads.length);
  });

  it('leaves an opaque model at alpha 1', () => {
    const s = buildSceneFromParts([strip([0, 0])], [OPAQUE]);
    expect(s.quads.every((q) => q.alpha === 1)).toBe(true);
  });
});

// The blend itself, and the depth rule that makes back-to-front work.
describe('Framebuffer.fillTriangle — alpha (§7.4)', () => {
  const tri = (fb: Framebuffer, depth: number, rgb: [number, number, number], alpha?: number) => {
    const v = (x: number, y: number) => ({ x, y, depth });
    fb.fillTriangle(v(0, 0), v(8, 0), v(0, 8), rgb, alpha);
    fb.fillTriangle(v(8, 0), v(8, 8), v(0, 8), rgb, alpha);
  };
  const pixel = (fb: Framebuffer) => {
    const o = (2 * fb.width + 2) * 4;
    return [fb.color[o], fb.color[o + 1], fb.color[o + 2]];
  };

  it('blends source-over instead of replacing', () => {
    const fb = new Framebuffer(8, 8, [0, 0, 0]);
    tri(fb, 0.9, [1, 0, 0]); // opaque red behind
    tri(fb, 0.5, [0, 0, 1], 0.5); // half blue in front
    expect(pixel(fb)).toEqual([128, 0, 128]);
  });

  it('does not write depth, so a farther face still draws after it', () => {
    // Exactly what the back-to-front pass relies on: two translucent
    // sheets both land, whatever order the depth buffer would have
    // allowed.
    const fb = new Framebuffer(8, 8, [0, 0, 0]);
    tri(fb, 0.9, [1, 0, 0], 0.5);
    tri(fb, 0.5, [0, 0, 1], 0.5);
    const [r, , b] = pixel(fb);
    expect(r).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  it('an opaque face still occludes what comes after it', () => {
    const fb = new Framebuffer(8, 8, [0, 0, 0]);
    tri(fb, 0.5, [1, 0, 0]); // near, opaque
    tri(fb, 0.9, [0, 0, 1], 0.5); // farther — depth-rejected
    expect(pixel(fb)).toEqual([255, 0, 0]);
  });

  it('alpha 0 draws nothing at all', () => {
    const fb = new Framebuffer(8, 8, [0, 0, 0]);
    tri(fb, 0.5, [1, 1, 1], 0);
    expect(pixel(fb)).toEqual([0, 0, 0]);
  });
});

// A pixel exactly on the edge shared by two triangles belongs to exactly
// ONE of them. Accepting it for both is invisible under an opaque fill —
// the second write lays the same colour over the first — and is a seam
// under alpha, where it lays a second coat of tint. It drew a diagonal
// across a translucent face wherever a quad's own triangulation landed on
// pixel centres, and a grid wherever two voxels of one colour met.
describe('Framebuffer.fillTriangle — shared edges (§7.4)', () => {
  // Two triangles meeting on the diagonal, the way a quad is triangulated.
  const quad = (fb: Framebuffer, alpha: number) => {
    const v = (x: number, y: number) => ({ x, y, depth: 0.5 });
    fb.fillTriangle(v(0, 0), v(16, 0), v(16, 16), [1, 1, 1], alpha);
    fb.fillTriangle(v(0, 0), v(16, 16), v(0, 16), [1, 1, 1], alpha);
  };
  const shades = (fb: Framebuffer) => {
    const seen = new Set<number>();
    for (let y = 1; y < 15; y++) {
      for (let x = 1; x < 15; x++) seen.add(fb.color[(y * fb.width + x) * 4]!);
    }
    return [...seen].sort((p, q) => p - q);
  };

  it('blends a translucent quad exactly once everywhere', () => {
    const fb = new Framebuffer(16, 16, [0, 0, 0]);
    quad(fb, 0.5);
    // One coat of 50% white over black. A twice-covered pixel would be 191.
    expect(shades(fb)).toEqual([128]);
  });

  it('covers the quad completely — no gap along the diagonal', () => {
    const fb = new Framebuffer(16, 16, [0, 0, 0]);
    quad(fb, 0.5);
    expect(shades(fb)).not.toContain(0);
  });

  it('leaves an opaque quad exactly as it was', () => {
    const fb = new Framebuffer(16, 16, [0, 0, 0]);
    quad(fb, 1);
    expect(shades(fb)).toEqual([255]);
  });

  it('accepts either winding', () => {
    const a = new Framebuffer(16, 16, [0, 0, 0]);
    const b = new Framebuffer(16, 16, [0, 0, 0]);
    const v = (x: number, y: number) => ({ x, y, depth: 0.5 });
    a.fillTriangle(v(0, 0), v(16, 0), v(0, 16), [1, 1, 1], 0.5);
    b.fillTriangle(v(0, 0), v(0, 16), v(16, 0), [1, 1, 1], 0.5);
    const at = (fb: Framebuffer) => fb.color[(4 * fb.width + 4) * 4];
    expect(at(a)).toBe(at(b));
    expect(at(a)).toBe(128);
  });
});
