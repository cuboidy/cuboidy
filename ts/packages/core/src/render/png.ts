import { deflateSync } from 'node:zlib';

// Minimal, dependency-free PNG encoder (8-bit RGBA, color type 6). Uses
// only Node's built-in zlib for the IDAT deflate stream so @cuboidy/core
// stays free of native/image dependencies — the same "pure Node" stance
// as cuboidy-view (text projection) and cuboidy-query.
//
// The output is a baseline, non-interlaced PNG with a single IDAT chunk
// and filter type 0 (None) on every scanline. That is the simplest
// spec-conformant encoding; readers (browsers, image libraries, and the
// multimodal model that consumes these renders) all accept it.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Encode width×height pixels. `rgba` is row-major, 4 bytes per pixel
// (R,G,B,A), length must equal width*height*4.
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(
      `encodePng: dimensions must be positive integers; got ${width}x${height}`,
    );
  }
  if (rgba.length !== width * height * 4) {
    throw new RangeError(
      `encodePng: rgba length ${rgba.length} != ${width}*${height}*4 (${width * height * 4})`,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive (only type 0 used per scanline)
  ihdr[12] = 0; // interlace: none

  // Prepend a filter byte (0 = None) to each scanline, then deflate.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Standard PNG/zlib CRC-32 (polynomial 0xEDB88320), lazily-built table.
let CRC_TABLE: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (CRC_TABLE === null) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    CRC_TABLE = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
