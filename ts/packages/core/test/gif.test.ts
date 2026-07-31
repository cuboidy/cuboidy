import { describe, expect, it } from 'vitest';
import { encodeGif, type GifFrame } from '../src/render/gif.js';

// The encoder is hand-rolled (no dependency is allowed to creep into the
// CLIs), so these tests decode what it produces with an independent LZW
// implementation written here. Asserting on the container bytes alone
// would pass for a structurally valid GIF full of garbage pixels.

function rgbaOf(pixels: readonly (readonly [number, number, number])[]): Uint8Array {
  const out = new Uint8Array(pixels.length * 4);
  pixels.forEach((p, i) => {
    out[i * 4] = p[0];
    out[i * 4 + 1] = p[1];
    out[i * 4 + 2] = p[2];
    out[i * 4 + 3] = 255;
  });
  return out;
}

/** Minimal GIF89a reader: global table + every frame's pixels, as RGB triples. */
function decodeGif(buf: Buffer): {
  width: number;
  height: number;
  loop: number | null;
  delays: number[];
  frames: number[][][]; // frame -> pixel -> [r,g,b]
  rawIndices: number[][];
  transparentIndex: number | null;
  disposal: number | null;
} {
  let p = 0;
  const u8 = () => buf[p++]!;
  const u16 = () => { const v = buf.readUInt16LE(p); p += 2; return v; };

  expect(buf.subarray(0, 6).toString('latin1')).toBe('GIF89a');
  p = 6;
  const width = u16();
  const height = u16();
  const flags = u8();
  u8(); // background index
  u8(); // aspect ratio
  const table: [number, number, number][] = [];
  if (flags & 0x80) {
    const n = 1 << ((flags & 7) + 1);
    for (let i = 0; i < n; i++) table.push([u8(), u8(), u8()]);
  }

  const readBlocks = (): number[] => {
    const bytes: number[] = [];
    for (;;) {
      const len = u8();
      if (len === 0) return bytes;
      for (let i = 0; i < len; i++) bytes.push(u8());
    }
  };

  const lzwDecode = (minCodeSize: number, data: readonly number[]): number[] => {
    const clear = 1 << minCodeSize;
    const end = clear + 1;
    let codeSize = minCodeSize + 1;
    let dict: number[][] = [];
    const reset = () => {
      dict = [];
      for (let i = 0; i < clear; i++) dict.push([i]);
      dict.push([], []); // clear, end
      codeSize = minCodeSize + 1;
    };
    reset();

    const out: number[] = [];
    let bit = 0;
    let prev: number[] | null = null;
    const readCode = (): number | null => {
      let v = 0;
      for (let i = 0; i < codeSize; i++) {
        const byteIdx = (bit / 8) | 0;
        if (byteIdx >= data.length) return null;
        v |= ((data[byteIdx]! >> (bit % 8)) & 1) << i;
        bit++;
      }
      return v;
    };
    for (;;) {
      const code = readCode();
      if (code === null || code === end) break;
      if (code === clear) { reset(); prev = null; continue; }
      let entry: number[];
      if (code < dict.length && dict[code]!.length > 0) entry = dict[code]!;
      else if (prev !== null) entry = [...prev, prev[0]!];
      else throw new Error(`lzw: bad code ${code}`);
      out.push(...entry);
      if (prev !== null) {
        dict.push([...prev, entry[0]!]);
        if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
      }
      prev = entry;
    }
    return out;
  };

  let loop: number | null = null;
  const delays: number[] = [];
  const frames: number[][][] = [];
  const rawIndices: number[][] = [];
  let transparentIndex: number | null = null;
  let disposal: number | null = null;
  let pendingDelay = 0;

  for (;;) {
    const marker = u8();
    if (marker === 0x3b) break; // trailer
    if (marker === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        u8(); // block size (4)
        const packed = u8();
        disposal = (packed >> 2) & 7;
        pendingDelay = u16();
        const idx = u8();
        transparentIndex = (packed & 1) === 1 ? idx : null;
        u8(); // terminator
      } else if (label === 0xff) {
        const n = u8();
        const name = buf.subarray(p, p + n).toString('latin1');
        p += n;
        const sub = readBlocks();
        if (name === 'NETSCAPE2.0') loop = sub[1]! | (sub[2]! << 8);
      } else {
        readBlocks();
      }
      continue;
    }
    if (marker !== 0x2c) throw new Error(`unexpected block 0x${marker.toString(16)}`);
    u16(); u16(); // left, top
    const fw = u16();
    const fh = u16();
    const lflags = u8();
    expect(lflags & 0x80).toBe(0); // no local colour table expected
    const minCodeSize = u8();
    const indices = lzwDecode(minCodeSize, readBlocks());
    expect(indices).toHaveLength(fw * fh);
    frames.push(indices.map((i) => table[i] ?? [0, 0, 0]));
    rawIndices.push(indices);
    delays.push(pendingDelay);
  }
  return {
    width, height, loop, delays, frames, rawIndices, transparentIndex, disposal,
  };
}

describe('encodeGif', () => {
  it('round-trips exact pixels for a small multi-frame animation', () => {
    // A 4x4 checker that inverts between frames: forces the LZW to encode
    // real runs and real dictionary growth rather than one flat colour.
    const A: [number, number, number] = [0xff, 0x00, 0x00];
    const B: [number, number, number] = [0x00, 0x40, 0xff];
    const mk = (swap: boolean): GifFrame => {
      const px: [number, number, number][] = [];
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          px.push(((x + y) % 2 === 0) !== swap ? A : B);
        }
      }
      return { rgba: rgbaOf(px) };
    };
    const frames = [mk(false), mk(true)];
    const gif = encodeGif(frames, { width: 4, height: 4, delayCs: 7 });

    const d = decodeGif(gif);
    expect(d.width).toBe(4);
    expect(d.height).toBe(4);
    expect(d.frames).toHaveLength(2);
    expect(d.delays).toEqual([7, 7]);
    expect(d.loop).toBe(0); // forever

    for (let f = 0; f < 2; f++) {
      const want = frames[f]!.rgba;
      d.frames[f]!.forEach((rgb, i) => {
        expect(rgb).toEqual([want[i * 4], want[i * 4 + 1], want[i * 4 + 2]]);
      });
    }
  });

  it('is lossless while the frames hold at most 256 distinct colours', () => {
    // 256 unique colours exactly — the boundary where the table is full
    // and no quantisation should happen yet.
    const px: [number, number, number][] = [];
    for (let i = 0; i < 256; i++) px.push([i, (i * 7) & 0xff, (i * 13) & 0xff]);
    const gif = encodeGif([{ rgba: rgbaOf(px) }], {
      width: 16,
      height: 16,
      delayCs: 10,
    });
    const d = decodeGif(gif);
    expect(new Set(d.frames[0]!.map((c) => c.join(','))).size).toBe(256);
    d.frames[0]!.forEach((rgb, i) => expect(rgb).toEqual(px[i]));
  });

  it('quantises to the most frequent colours when a frame overflows the table', () => {
    // 300 distinct colours, but one of them covers most of the image. The
    // dominant colour must survive exactly; the rest snap to neighbours.
    const px: [number, number, number][] = [];
    const dominant: [number, number, number] = [10, 200, 30];
    for (let i = 0; i < 300; i++) px.push([i & 0xff, (i >> 1) & 0xff, 255 - (i & 0xff)]);
    for (let i = 0; i < 724; i++) px.push(dominant);
    expect(px).toHaveLength(1024); // 32x32

    const gif = encodeGif([{ rgba: rgbaOf(px) }], {
      width: 32,
      height: 32,
      delayCs: 10,
    });
    const d = decodeGif(gif);
    const colours = new Set(d.frames[0]!.map((c) => c.join(',')));
    expect(colours.size).toBeLessThanOrEqual(256);
    // The dominant fill is untouched.
    expect(colours.has(dominant.join(','))).toBe(true);
    for (let i = 300; i < 1024; i++) expect(d.frames[0]![i]).toEqual(dominant);
  });

  it('writes masked pixels as the transparent index, with disposal 2', () => {
    const C: [number, number, number] = [0x20, 0x80, 0xc0];
    const px: [number, number, number][] = Array.from({ length: 16 }, () => C);
    // Cover only the middle two pixels of a 4x4.
    const mask = new Uint8Array(16);
    mask[5] = 1;
    mask[6] = 1;
    const gif = encodeGif([{ rgba: rgbaOf(px), mask }], {
      width: 4,
      height: 4,
      delayCs: 8,
    });
    const d = decodeGif(gif);
    expect(d.transparentIndex).not.toBeNull();
    // Disposal MUST be 2 ("restore to background"). With 1 the
    // transparent pixels would show the previous frame and the
    // animation would smear a trail.
    expect(d.disposal).toBe(2);
    const raw = d.rawIndices[0]!;
    raw.forEach((idx, i) => {
      if (mask[i] === 1) expect(idx).not.toBe(d.transparentIndex);
      else expect(idx).toBe(d.transparentIndex);
    });
  });

  it('does not punch holes when the model uses the background colour', () => {
    // The reason the mask comes from the depth buffer instead of matching
    // the background colour: here they are the SAME colour, and the
    // covered pixels must survive anyway.
    const SAME: [number, number, number] = [0x6b, 0x70, 0x78];
    const px: [number, number, number][] = Array.from({ length: 9 }, () => SAME);
    const mask = new Uint8Array(9).fill(0);
    mask[4] = 1; // centre pixel is real geometry that happens to match bg
    const gif = encodeGif([{ rgba: rgbaOf(px), mask }], {
      width: 3,
      height: 3,
      delayCs: 10,
    });
    const d = decodeGif(gif);
    const raw = d.rawIndices[0]!;
    expect(raw[4]).not.toBe(d.transparentIndex);
    expect(d.frames[0]![4]).toEqual([...SAME]);
    for (const i of [0, 1, 2, 3, 5, 6, 7, 8]) {
      expect(raw[i]).toBe(d.transparentIndex);
    }
  });

  it('stays opaque with disposal 1 when no frame carries a mask', () => {
    const gif = encodeGif([{ rgba: rgbaOf([[9, 9, 9]]) }], {
      width: 1, height: 1, delayCs: 5,
    });
    const d = decodeGif(gif);
    expect(d.transparentIndex).toBeNull();
    expect(d.disposal).toBe(1);
  });

  it('honours an explicit loop count and refuses an empty animation', () => {
    const gif = encodeGif([{ rgba: rgbaOf([[1, 2, 3]]) }], {
      width: 1,
      height: 1,
      delayCs: 5,
      loopCount: 3,
    });
    expect(decodeGif(gif).loop).toBe(3);
    expect(() => encodeGif([], { width: 1, height: 1, delayCs: 5 })).toThrow(
      /no frames/,
    );
  });
});
