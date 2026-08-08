import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { encodePng } from '../src/render/png.js';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Ihdr {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

function readIhdr(buf: Buffer): Ihdr {
  // IHDR is the first chunk: 8-byte signature, 4-byte length, 'IHDR', data.
  const type = buf.toString('ascii', 12, 16);
  if (type !== 'IHDR') throw new Error(`first chunk is ${type}, not IHDR`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24]!,
    colorType: buf[25]!,
  };
}

// Concatenate every IDAT chunk's payload and inflate it.
function inflateIdat(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') parts.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  return inflateSync(Buffer.concat(parts));
}

describe('encodePng', () => {
  it('emits a valid signature and IHDR for an RGBA image', () => {
    const png = encodePng(2, 3, new Uint8Array(2 * 3 * 4));
    expect([...png.subarray(0, 8)]).toEqual(SIGNATURE);
    const ihdr = readIhdr(png);
    expect(ihdr).toEqual({ width: 2, height: 3, bitDepth: 8, colorType: 6 });
  });

  it('ends with an IEND chunk', () => {
    const png = encodePng(1, 1, new Uint8Array(4));
    expect(png.toString('ascii', png.length - 8, png.length - 4)).toBe('IEND');
  });

  it('round-trips pixels through the deflate stream', () => {
    // 2×1 image: red opaque, then green half-alpha.
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]);
    const png = encodePng(2, 1, rgba);
    const raw = inflateIdat(png);
    // One scanline: filter byte (0) + 8 color bytes.
    expect(raw.length).toBe(1 + 2 * 4);
    expect(raw[0]).toBe(0); // filter type None
    expect([...raw.subarray(1)]).toEqual([255, 0, 0, 255, 0, 255, 0, 128]);
  });

  it('rejects a mismatched buffer length', () => {
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow(/length/);
  });

  it('rejects non-positive dimensions (PNG forbids 0-size)', () => {
    expect(() => encodePng(0, 0, new Uint8Array(0))).toThrow(/dimensions/);
    expect(() => encodePng(0, 4, new Uint8Array(0))).toThrow(/dimensions/);
    expect(() => encodePng(-1, 1, new Uint8Array(0))).toThrow(/dimensions/);
  });

  it('is deterministic for identical input', () => {
    const rgba = new Uint8Array(4 * 4 * 4).map((_, i) => (i * 37) % 256);
    expect(encodePng(4, 4, rgba).equals(encodePng(4, 4, rgba))).toBe(true);
  });
});

