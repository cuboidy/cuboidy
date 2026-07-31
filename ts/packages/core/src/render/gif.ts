// Animated GIF89a encoder. Dependency-free, the same policy as png.ts:
// a model should render without a browser, a native binding or an npm
// tree, because the CLIs are what an agent reaches for.
//
// GIF is the target because it plays inline in a GitHub README, which
// neither a video nor a canvas does. Its constraint is 256 colours per
// frame from one table, and that is comfortable here: the renderer
// shades a face by its normal alone, so a model draws in at most
// `palette x 6 + background` colours. Measured on the shipped models,
// a frame uses 37-82. When a large palette does overflow 256, the
// quantiser keeps the most frequent colours and maps the rest to their
// nearest neighbour rather than failing.

export interface GifFrame {
  /** Row-major RGBA, 4 bytes per pixel — `Framebuffer.toRgba()`. */
  rgba: Uint8Array;
}

export interface GifOptions {
  width: number;
  height: number;
  /** Delay between frames in hundredths of a second (GIF's unit). */
  delayCs: number;
  /** 0 = forever. */
  loopCount?: number;
}

const MAX_COLORS = 256;

export function encodeGif(
  frames: readonly GifFrame[],
  opts: GifOptions,
): Buffer {
  if (frames.length === 0) throw new Error('encodeGif: no frames');
  const { width, height } = opts;

  const { table, indexOf } = buildColorTable(frames);
  // A GIF colour table is a power of two, at least 2 entries.
  let tableBits = 1;
  while (1 << tableBits < table.length) tableBits++;
  const tableSize = 1 << tableBits;

  const out: number[] = [];
  const byte = (b: number) => out.push(b & 0xff);
  const short = (v: number) => { byte(v); byte(v >> 8); };

  // Header + logical screen descriptor.
  for (const c of 'GIF89a') byte(c.charCodeAt(0));
  short(width);
  short(height);
  byte(0x80 | (tableBits - 1)); // global table present, N bits per entry
  byte(0); // background colour index
  byte(0); // pixel aspect ratio: unspecified

  for (let i = 0; i < tableSize; i++) {
    const c = table[i] ?? 0;
    byte(c >> 16); byte(c >> 8); byte(c);
  }

  // Netscape 2.0 application extension — the de-facto loop control.
  // Without it a viewer plays the animation exactly once.
  byte(0x21); byte(0xff); byte(11);
  for (const c of 'NETSCAPE2.0') byte(c.charCodeAt(0));
  byte(3); byte(1); short(opts.loopCount ?? 0);
  byte(0);

  for (const frame of frames) {
    // Graphic control extension: per-frame delay. Disposal method 1
    // ("do not dispose") is right because every frame is full-size and
    // opaque — there is nothing underneath to restore.
    byte(0x21); byte(0xf9); byte(4);
    byte(0x04);
    short(opts.delayCs);
    byte(0); // transparent colour index (unused)
    byte(0);

    // Image descriptor: one full-canvas image, no local colour table.
    byte(0x2c);
    short(0); short(0);
    short(width); short(height);
    byte(0);

    const indices = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < indices.length; i++, p += 4) {
      indices[i] = indexOf(
        (frame.rgba[p]! << 16) | (frame.rgba[p + 1]! << 8) | frame.rgba[p + 2]!,
      );
    }
    writeLzw(out, indices, Math.max(2, tableBits));
  }

  byte(0x3b); // trailer
  return Buffer.from(out);
}

// ----- colour table -------------------------------------------------

function buildColorTable(frames: readonly GifFrame[]): {
  table: number[];
  indexOf: (rgb: number) => number;
} {
  const freq = new Map<number, number>();
  for (const f of frames) {
    for (let p = 0; p < f.rgba.length; p += 4) {
      const key = (f.rgba[p]! << 16) | (f.rgba[p + 1]! << 8) | f.rgba[p + 2]!;
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }

  const exact = new Map<number, number>();
  let table: number[];
  if (freq.size <= MAX_COLORS) {
    // The common case: every colour survives, so the GIF is lossless.
    table = [...freq.keys()];
  } else {
    // Keep the most-used colours; everything else snaps to its nearest
    // survivor. Frequency beats median-cut here because the colours are
    // not a photographic cloud — they are a small set of flat fills plus
    // a thin tail of antialiased edge pixels, and the fills are exactly
    // what must stay exact.
    table = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_COLORS)
      .map(([c]) => c);
  }
  table.forEach((c, i) => exact.set(c, i));

  const cache = new Map<number, number>();
  const indexOf = (rgb: number): number => {
    const hit = exact.get(rgb);
    if (hit !== undefined) return hit;
    const cached = cache.get(rgb);
    if (cached !== undefined) return cached;
    const r = rgb >> 16, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < table.length; i++) {
      const t = table[i]!;
      const dr = r - (t >> 16), dg = g - ((t >> 8) & 0xff), db = b - (t & 0xff);
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    cache.set(rgb, best);
    return best;
  };

  return { table, indexOf };
}

// ----- LZW ----------------------------------------------------------

// GIF's variable-code-width LZW. Codes start one bit wider than the
// colour depth to leave room for the two control codes, grow as the
// dictionary fills, and reset when it reaches 4096 entries.
function writeLzw(out: number[], indices: Uint8Array, minCodeSize: number): void {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  let dict = new Map<string, number>();

  const chunk: number[] = [];
  let bitBuf = 0;
  let bitCount = 0;
  const emit = (code: number) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      chunk.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitCount -= 8;
    }
  };

  const resetDict = () => {
    dict = new Map();
    nextCode = endCode + 1;
    codeSize = minCodeSize + 1;
  };

  out.push(minCodeSize);
  emit(clearCode);
  resetDict();

  let prefix = '';
  for (const idx of indices) {
    const candidate = prefix === '' ? String(idx) : `${prefix},${idx}`;
    if (prefix !== '' && !dict.has(candidate)) {
      emit(dict.get(prefix) ?? Number(prefix));
      if (nextCode < 4096) {
        dict.set(candidate, nextCode++);
        if (nextCode - 1 === (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(clearCode);
        resetDict();
      }
      prefix = String(idx);
    } else {
      prefix = candidate;
    }
  }
  if (prefix !== '') emit(dict.get(prefix) ?? Number(prefix));
  emit(endCode);
  if (bitCount > 0) chunk.push(bitBuf & 0xff);

  // Sub-blocks: at most 255 data bytes each, terminated by a zero byte.
  for (let i = 0; i < chunk.length; i += 255) {
    const slice = chunk.slice(i, i + 255);
    out.push(slice.length, ...slice);
  }
  out.push(0);
}
