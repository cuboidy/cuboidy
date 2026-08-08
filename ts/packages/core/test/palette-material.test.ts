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
    expect(isMatte(paletteEntryFrom('#3AA0FF')!)).toBe(true);
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
    expect(e.a).toBe(0x66);
    expect(e.emissive).toBe(0.5);
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

  it('emits an identical mesh', () => {
    const a = buildMesh(part, matte);
    const b = buildMesh(part, shiny);
    expect(b.positions).toEqual(a.positions);
    expect(b.normals).toEqual(a.normals);
    expect(b.colors).toEqual(a.colors);
    expect(b.alphas).toEqual(a.alphas);
    expect(b.indices).toEqual(a.indices);
    expect(b.opaqueIndexCount).toBe(a.opaqueIndexCount);
  });

  it('emits identical quads', () => {
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
    expect(scene(shiny)).toEqual(scene(matte));
  });
});
