import type { Color, Material, PaletteEntry } from './types.js';

// SPEC §7.4: the colour codec, shared by a geometry file's own palette and the
// external palette file (§6.10) — both use the same grammar and the same
// 62-slot index space.
export const MAX_PALETTE = 62;

// The material an entry has when it says nothing: a plain matte dielectric.
// These exact numbers are what every model rendered as before §7.4 gained
// materials, and they are three.js MeshStandardMaterial's own defaults, so
// "said nothing" and "said the defaults" are the same pixels.
export const MATTE: Material = { metallic: 0, roughness: 1, emissive: 0 };

// The object form of a palette entry, as it appears in a file. Structural
// rather than inferred from Zod so this module stays free of the schema —
// schema.ts already imports MAX_PALETTE from here, and the reverse would
// close the loop.
export interface PaletteEntryDoc {
  color: string;
  metallic?: number | undefined;
  roughness?: number | undefined;
  emissive?: number | undefined;
}

const HEX_RE = /^#([0-9a-fA-F]+)$/;

export function parseHexColor(s: string): Color | null {
  const m = HEX_RE.exec(s);
  if (!m) return null;
  const hex = m[1]!;
  switch (hex.length) {
    case 3:
      return {
        r: dup(hex, 0),
        g: dup(hex, 1),
        b: dup(hex, 2),
        a: 0xff,
      };
    case 4:
      return {
        r: dup(hex, 0),
        g: dup(hex, 1),
        b: dup(hex, 2),
        a: dup(hex, 3),
      };
    case 6:
      return {
        r: pair(hex, 0),
        g: pair(hex, 2),
        b: pair(hex, 4),
        a: 0xff,
      };
    case 8:
      return {
        r: pair(hex, 0),
        g: pair(hex, 2),
        b: pair(hex, 4),
        a: pair(hex, 6),
      };
    default:
      return null;
  }
}

// Canonical colour form: `#RRGGBB` when alpha = 0xFF, `#RRGGBBAA` otherwise.
// Short forms (`#RGB`, `#RGBA`) are reader-accepted but not writer-emitted —
// canonical output has exactly one representation per colour value.
export function serializeColor(c: Color): string {
  const rgb = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a === 0xff ? rgb : `${rgb}${hex2(c.a)}`;
}

export function isMatte(m: Material): boolean {
  return (
    m.metallic === MATTE.metallic &&
    m.roughness === MATTE.roughness &&
    m.emissive === MATTE.emissive
  );
}

// A validated entry from a file → the runtime shape. The single place the
// §7.4 material defaults are applied, so no caller has to know them.
//
// Returns null only for a malformed colour. Range and key checks belong to
// the schema, which has already run and can report a path.
export function paletteEntryFrom(
  doc: string | PaletteEntryDoc,
): PaletteEntry | null {
  const hex = typeof doc === 'string' ? doc : doc.color;
  const color = parseHexColor(hex);
  if (color === null) return null;
  if (typeof doc === 'string') return { color, material: MATTE };
  return {
    color,
    material: {
      metallic: doc.metallic ?? MATTE.metallic,
      roughness: doc.roughness ?? MATTE.roughness,
      emissive: doc.emissive ?? MATTE.emissive,
    },
  };
}

// Canonical entry form: the bare hex STRING when the material is the
// default, the object otherwise, with default-valued keys left out.
//
// A matte entry writing itself as a string is what keeps every model that
// predates materials byte-identical through a round trip — and keeps a
// palette readable, since most entries are matte in practice.
//
// Key order is fixed (colour, then metallic, roughness, emissive) because
// `JSON.stringify` preserves insertion order and canonical output must have
// exactly one representation.
export function serializePaletteEntry(
  e: PaletteEntry,
): string | PaletteEntryDoc {
  const color = serializeColor(e.color);
  const m = e.material;
  if (isMatte(m)) return color;
  const out: PaletteEntryDoc = { color };
  if (m.metallic !== MATTE.metallic) out.metallic = m.metallic;
  if (m.roughness !== MATTE.roughness) out.roughness = m.roughness;
  if (m.emissive !== MATTE.emissive) out.emissive = m.emissive;
  return out;
}

function dup(hex: string, i: number): number {
  const c = hex[i]!;
  return parseInt(c + c, 16);
}

function pair(hex: string, i: number): number {
  return parseInt(hex.slice(i, i + 2), 16);
}

function hex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0');
}
