import { describe, expect, it } from 'vitest';
import { parseGeometryText } from '../src/geometry/parse.js';
import { serializeGeometry } from '../src/geometry/serialize.js';
import {
  MATTE,
  isMatte,
  paletteEntryFrom,
  serializePaletteEntry,
} from '../src/geometry/palette.js';
import { buildMesh } from '../src/mesh.js';
import { buildSceneFromParts } from '../src/render/scene.js';
import { QUAT_IDENTITY } from '../src/rig-transform.js';
import type { Palette, Part } from '../src/geometry/types.js';
import { rgba } from './helpers/palette.js';

// SPEC §7.4 material: a palette entry may be a bare colour, or an object
// carrying that colour plus how it responds to light.

function geometryWith(palette: string): string {
  return JSON.stringify({
    version: '0.9',
    palette: JSON.parse(palette),
    parts: [
      {
        name: 'p',
        size: [1, 1, 1],
        pivot: { pos: [0, 0, 0] },
        voxels: [['0']],
      },
    ],
  });
}

describe('palette entry codec', () => {
  it('defaults a bare colour to matte', () => {
    expect(paletteEntryFrom('#3AA0FF')).toEqual(rgba(0x3a, 0xa0, 0xff));
    expect(isMatte(paletteEntryFrom('#3AA0FF')!.material)).toBe(true);
  });

  it('matches three.js MeshStandardMaterial defaults', () => {
    // Not arbitrary: "said nothing" and "said the defaults" have to be the
    // same pixels, or adding materials would restyle every existing model.
    expect(MATTE).toEqual({ metallic: 0, roughness: 1, emissive: 0 });
  });

  it('reads the object form, filling absent fields from the default', () => {
    expect(paletteEntryFrom({ color: '#C0C4CC', metallic: 1 })).toEqual(
      rgba(0xc0, 0xc4, 0xcc, 255, { metallic: 1 }),
    );
  });

  it('keeps alpha and material independent', () => {
    const e = paletteEntryFrom({ color: '#3AA0FF66', emissive: 0.5 })!;
    expect(e.color.a).toBe(0x66);
    expect(e.material.emissive).toBe(0.5);
  });

  it('writes a matte entry back as a bare string', () => {
    expect(serializePaletteEntry(rgba(0x3a, 0xa0, 0xff))).toBe('#3AA0FF');
    expect(serializePaletteEntry(rgba(0x3a, 0xa0, 0xff, 0x66))).toBe('#3AA0FF66');
  });

  it('writes only the fields that differ from the default', () => {
    expect(
      serializePaletteEntry(rgba(0xc0, 0xc4, 0xcc, 255, { metallic: 1 })),
    ).toEqual({ color: '#C0C4CC', metallic: 1 });
    expect(
      serializePaletteEntry(rgba(255, 106, 58, 255, { emissive: 0.9 })),
    ).toEqual({ color: '#FF6A3A', emissive: 0.9 });
  });

  it('emits object keys in a fixed order', () => {
    // JSON.stringify follows insertion order and canonical output must have
    // exactly one representation per value.
    const out = serializePaletteEntry(
      rgba(1, 2, 3, 255, { emissive: 0.5, roughness: 0.25, metallic: 1 }),
    );
    expect(Object.keys(out as object)).toEqual([
      'color',
      'metallic',
      'roughness',
      'emissive',
    ]);
  });
});

describe('material through a geometry file', () => {
  it('round-trips the object form', () => {
    const text = geometryWith(
      '["#B8BEC6", { "color": "#C0C4CC", "metallic": 1, "roughness": 0.25 }]',
    );
    const parsed = parseGeometryText(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.palette[1]).toEqual(
      rgba(0xc0, 0xc4, 0xcc, 255, { metallic: 1, roughness: 0.25 }),
    );

    const round = parseGeometryText(serializeGeometry(parsed.value));
    expect(round.ok).toBe(true);
    if (round.ok) expect(round.value.palette).toEqual(parsed.value.palette);
  });

  it('leaves a palette of bare colours as bare colours', () => {
    // The whole point of the string form surviving: a model written before
    // materials existed must come back byte-identical.
    const text = geometryWith('["#B8BEC6", "#3AA0FF66"]');
    const parsed = parseGeometryText(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeGeometry(parsed.value)).toContain(
      '"palette": ["#B8BEC6", "#3AA0FF66"]',
    );
  });

  it('rejects a material value outside 0..1', () => {
    const r = parseGeometryText(
      geometryWith('[{ "color": "#fff", "roughness": -0.1 }]'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-value');
  });

  it('rejects an unknown key on an entry', () => {
    const r = parseGeometryText(
      geometryWith('[{ "color": "#fff", "glossiness": 1 }]'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown');
  });
});

// The normative half of §7.4's material. Shading is a renderer's own
// business and two conforming implementations may disagree about pixels —
// but they may not disagree about the mesh, which is what a port can
// actually be held to. Alpha is the one field allowed to change geometry.
describe('material does not change geometry (§7.4, normative)', () => {
  const part: Part = {
    name: 'p',
    size: { w: 2, h: 2, d: 2 },
    pivot: { pos: { x: 0, y: 0, z: 0 } },
    sockets: [],
    voxels: [
      [[0, 1], [1, 0]],
      [[1, 0], [0, 1]],
    ],
  };
  const matte: Palette = [rgba(180, 60, 40), rgba(60, 160, 255)];
  const shiny: Palette = [
    rgba(180, 60, 40, 255, { metallic: 1, roughness: 0.1 }),
    rgba(60, 160, 255, 255, { emissive: 0.8, roughness: 0.4 }),
  ];

  // Every triangle, as a comparable string, order-independent. The index
  // BUFFER order is allowed to differ — partitioning it by material is the
  // whole point of the buckets — but the set of triangles it describes is
  // not.
  function triangles(m: ReturnType<typeof buildMesh>): string[] {
    const out: string[] = [];
    for (let i = 0; i < m.indices.length; i += 3) {
      out.push([0, 1, 2].map((k) => m.indices[i + k]!).join(','));
    }
    return out.sort();
  }

  it('emits the same vertices', () => {
    const a = buildMesh(part, matte);
    const b = buildMesh(part, shiny);
    // Vertices are pushed in voxel order regardless of which bucket the
    // face lands in, so these are identical element for element.
    expect(b.positions).toEqual(a.positions);
    expect(b.normals).toEqual(a.normals);
    expect(b.colors).toEqual(a.colors);
    expect(b.alphas).toEqual(a.alphas);
  });

  it('emits the same triangles', () => {
    const a = buildMesh(part, matte);
    const b = buildMesh(part, shiny);
    expect(triangles(b)).toEqual(triangles(a));
    expect(b.indices.length).toBe(a.indices.length);
    expect(b.opaqueIndexCount).toBe(a.opaqueIndexCount);
  });

  it('partitions those triangles by material', () => {
    const a = buildMesh(part, matte);
    const b = buildMesh(part, shiny);
    // The one thing material IS allowed to change.
    expect(a.materials).toHaveLength(1);
    expect(b.materials).toHaveLength(2);
    for (const m of [a, b]) {
      expect(m.groups.reduce((n, g) => n + g.count, 0)).toBe(m.indices.length);
      // Contiguous and gapless, in order.
      let at = 0;
      for (const g of m.groups) {
        expect(g.start).toBe(at);
        at += g.count;
      }
    }
  });

  it('emits identical quads apart from the material they carry', () => {
    const scene = (palette: Palette) =>
      buildSceneFromParts(
        [
          {
            part,
            remap: null,
            transform: { pos: [0, 0, 0], quat: QUAT_IDENTITY },
          },
        ],
        palette,
      ).quads;
    const a = scene(matte);
    const b = scene(shiny);
    expect(b).toHaveLength(a.length);
    // render/scene.ts emits one flat list, so here even the ORDER holds.
    for (const [i, q] of b.entries()) {
      const { material: _b, ...bGeom } = q;
      const { material: _a, ...aGeom } = a[i]!;
      expect(bGeom).toEqual(aGeom);
    }
  });
});

// A bucket that holds no quad still advertised a material, which made the
// renderer flip to a material array plus groups for a model with one visible
// finish, compile a shader nothing drew with, and issue a zero-count draw.
describe('buckets hold only materials that are actually visible', () => {
  it('ignores a material used solely by an enclosed voxel', () => {
    const shell = rgba(180, 180, 180);
    const hidden = rgba(200, 200, 200, 255, { metallic: 1, roughness: 0.1 });
    const part: Part = {
      name: 'p',
      size: { w: 3, h: 3, d: 3 },
      pivot: { pos: { x: 0, y: 0, z: 0 } },
      sockets: [],
      // Index 1 sits at the centre, enclosed on all six sides by index 0.
      voxels: Array.from({ length: 3 }, (_, y) =>
        Array.from({ length: 3 }, (_, z) =>
          Array.from({ length: 3 }, (_, x) =>
            x === 1 && y === 1 && z === 1 ? 1 : 0,
          ),
        ),
      ),
    };
    const mesh = buildMesh(part, [shell, hidden]);
    expect(mesh.materials).toHaveLength(1);
    expect(mesh.groups).toHaveLength(1);
    for (const g of mesh.groups) expect(g.count).toBeGreaterThan(0);
  });

  it('keeps a material the moment one of its faces is visible', () => {
    const shell = rgba(180, 180, 180);
    const shown = rgba(200, 200, 200, 255, { metallic: 1, roughness: 0.1 });
    const part: Part = {
      name: 'p',
      size: { w: 2, h: 1, d: 1 },
      pivot: { pos: { x: 0, y: 0, z: 0 } },
      sockets: [],
      voxels: [[[0, 1]]],
    };
    const mesh = buildMesh(part, [shell, shown]);
    expect(mesh.materials).toHaveLength(2);
    for (const g of mesh.groups) expect(g.count).toBeGreaterThan(0);
  });
});

// SPEC §7.4: `MeshGroup.material` indexes `MeshData.materials`, so that
// array's order is part of what two implementations must agree on. Deriving
// it from first appearance would tie it to the voxel walk — which §7.4
// explicitly leaves free — and a port iterating x→y→z would hand the same
// face to a different material while conforming to everything else.
describe('material order is derived from value, not from the voxel walk', () => {
  const DULL = rgba(150, 150, 150, 255, { metallic: 1, roughness: 0.7 });
  const POLISHED = rgba(150, 150, 150, 255, { metallic: 1, roughness: 0.1 });
  const GLOW = rgba(255, 200, 100, 255, { emissive: 0.8 });
  const GLASS = rgba(100, 200, 255, 0x80);
  const P: Palette = [DULL, POLISHED, GLOW, GLASS];

  // Same four materials, two different orders of first appearance.
  function row(order: readonly number[]): Part {
    return {
      name: 'p',
      size: { w: order.length, h: 1, d: 1 },
      pivot: { pos: { x: 0, y: 0, z: 0 } },
      sockets: [],
      voxels: [[[...order]]],
    };
  }

  it('gives the same material list whatever order the voxels appear in', () => {
    const a = buildMesh(row([0, 1, 2, 3]), P);
    const b = buildMesh(row([3, 2, 1, 0]), P);
    expect(b.materials).toEqual(a.materials);
  });

  it('puts opaque before translucent, then ascending by value', () => {
    const m = buildMesh(row([3, 2, 1, 0]), P);
    expect(m.materials.map((x) => x.translucent)).toEqual([
      false, false, false, true,
    ]);
    // Among the opaque three: emissive-only (metallic 0) sorts before the
    // two metals, and the polished metal before the dull one.
    expect(m.materials[0]!.emissive).toBeCloseTo(0.8, 6);
    expect(m.materials[1]!.roughness).toBeCloseTo(0.1, 6);
    expect(m.materials[2]!.roughness).toBeCloseTo(0.7, 6);
  });

  it('keeps opaqueIndexCount on a group boundary', () => {
    const m = buildMesh(row([3, 2, 1, 0]), P);
    const starts = m.groups.map((g) => g.start);
    expect(starts).toContain(m.opaqueIndexCount);
  });
});
