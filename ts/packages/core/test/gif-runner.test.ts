import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { ANGLES } from '../src/render/camera.js';
import { DEFAULT_BG, renderGif, runGif } from '../src/cli/gif-runner.js';
import { loadAndAssemble } from '../src/cli/assemble.js';
import { MIRRORED, MULTIFILE, RIGGED } from './helpers/corpus.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const opts = (over: Partial<Parameters<typeof renderGif>[2]> = {}) => ({
  angle: ANGLES['front']!,
  size: 48,
  ss: 1,
  fps: 10,
  bg: DEFAULT_BG,
  ...over,
});

async function assemblyOf(rel: string) {
  const r = await loadAndAssemble(resolve(REPO_ROOT, rel));
  if (!r.ok) throw new Error(r.message);
  return r.assembly;
}

/** Decode a GIF far enough to get each frame's palette indices. */
function frameIndices(buf: Buffer): number[][] {
  let p = 13;
  const flags = buf[10]!;
  if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
  const u8 = () => buf[p++]!;
  const blocks = (): number[] => {
    const out: number[] = [];
    for (;;) {
      const n = u8();
      if (n === 0) return out;
      for (let i = 0; i < n; i++) out.push(u8());
    }
  };
  const frames: number[][] = [];
  for (;;) {
    const marker = u8();
    if (marker === 0x3b) break;
    if (marker === 0x21) { u8(); if (buf[p] !== undefined) { const n = u8(); p += n === 4 ? 5 : 0; if (n !== 4) { p -= 1; blocks(); } else { /* GCE consumed */ } } continue; }
    if (marker !== 0x2c) throw new Error(`bad marker ${marker}`);
    p += 8; // left, top, w, h
    const lflags = u8();
    if (lflags & 0x80) p += 3 * (1 << ((lflags & 7) + 1));
    const min = u8();
    const data = blocks();
    frames.push(lzw(min, data));
  }
  return frames;
}

function lzw(minCodeSize: number, data: readonly number[]): number[] {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let size = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push([], []);
    size = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let bit = 0;
  let prev: number[] | null = null;
  for (;;) {
    let code = 0;
    let got = true;
    for (let i = 0; i < size; i++) {
      const b = (bit / 8) | 0;
      if (b >= data.length) { got = false; break; }
      code |= ((data[b]! >> (bit % 8)) & 1) << i;
      bit++;
    }
    if (!got || code === end) break;
    if (code === clear) { reset(); prev = null; continue; }
    const entry: number[] =
      code < dict.length && dict[code]!.length > 0
        ? dict[code]!
        : [...prev!, prev![0]!];
    out.push(...entry);
    if (prev !== null) {
      dict.push([...prev, entry[0]!]);
      if (dict.length === 1 << size && size < 12) size++;
    }
    prev = entry;
  }
  return out;
}

describe('renderGif', () => {
  it('produces one frame per sample and the frames actually differ', async () => {
    const asm = await assemblyOf(RIGGED);
    // Three-quarter view on purpose: from the FRONT the tail is hidden
    // behind the body, leaving only the head yaw, which revisits 4.0
    // degrees twice in this clip and would make two frames identical.
    const { gif, frames, duration } = renderGif(
      asm,
      'idle',
      opts({ frames: 8, angle: ANGLES['fr-up']!, size: 96 }),
    );
    expect(frames).toBe(8);
    expect(duration).toBe(2);

    const decoded = frameIndices(gif);
    expect(decoded).toHaveLength(8);
    const distinct = new Set(decoded.map((f) => f.join(',')));
    // The head yaws and the tail swings, so no two of these eight poses
    // should land on identical pixels.
    expect(distinct.size).toBe(8);
  });

  it('holds the camera still across the clip', async () => {
    // THE property this tool exists for. `step` animates only the legs,
    // so every pixel above them must be byte-identical in every frame.
    // Auto-framing per frame — what you get by snapping baked poses one
    // at a time — would shift the whole image as the bounds changed.
    const asm = await assemblyOf(RIGGED);
    const size = 48;
    const { gif } = renderGif(asm, 'step', opts({ size, frames: 6 }));
    const frames = frameIndices(gif);
    expect(frames).toHaveLength(6);

    const topHalf = (f: number[]) => f.slice(0, size * Math.floor(size / 2));
    const reference = topHalf(frames[0]!).join(',');
    for (let i = 1; i < frames.length; i++) {
      expect(topHalf(frames[i]!).join(','), `frame ${i} top half moved`).toBe(
        reference,
      );
    }
    // …while the bottom half, where the legs are, does move.
    const bottom = (f: number[]) => f.slice(size * Math.floor(size / 2)).join(',');
    expect(new Set(frames.map(bottom)).size).toBeGreaterThan(1);
  });

  it('samples [0, duration) so the loop does not hold the first pose twice', async () => {
    const asm = await assemblyOf(RIGGED);
    const { gif } = renderGif(asm, 'idle', opts({ frames: 4 }));
    const frames = frameIndices(gif);
    // A clip sampled inclusively would render t=duration, which §6.7
    // makes identical to t=0 — a visible stall once per loop.
    expect(frames[0]!.join(',')).not.toBe(frames[frames.length - 1]!.join(','));
  });

  it('resolves an external clip the same as an inline one', async () => {
    // `step` is a §6.3 string reference; `idle` is inline. Both must be
    // renderable without the caller knowing which is which.
    const asm = await assemblyOf(RIGGED);
    expect(() => renderGif(asm, 'step', opts({ frames: 3 }))).not.toThrow();
    expect(() => renderGif(asm, 'idle', opts({ frames: 3 }))).not.toThrow();
    expect(() => renderGif(asm, 'nope', opts({ frames: 3 }))).toThrow(/unknown clip/);
  });
});

describe('renderGif — orbit', () => {
  it('turns a model that has no animation at all', async () => {
    // `mirrored` defines no clips. An orbit is the only thing that can
    // move, and it must be enough on its own.
    const asm = await assemblyOf(MIRRORED);
    const { gif, frames } = renderGif(
      asm,
      null,
      opts({ orbit: true, frames: 8, size: 64 }),
    );
    expect(frames).toBe(8);
    const decoded = frameIndices(gif);
    expect(new Set(decoded.map((f) => f.join(','))).size).toBe(8);
  });

  it('refuses a still model when nothing would move', async () => {
    const asm = await assemblyOf(MIRRORED);
    expect(() => renderGif(asm, null, opts())).toThrow(/nothing would move/);
  });

  it('fits the scale to every viewpoint, so no frame is clipped', async () => {
    // The reason computeGlobalScale is fed all the angles rather than
    // one: a model deeper than it is wide would overflow the tile as it
    // turned side-on if the scale had been fitted to the start angle.
    const size = 64;
    const asm = await assemblyOf(RIGGED);
    const { gif } = renderGif(
      asm,
      'idle',
      opts({ orbit: true, frames: 12, size }),
    );
    const bgIndex = frameIndices(gif)[0]![0]!; // corner pixel is background
    frameIndices(gif).forEach((f, n) => {
      for (let x = 0; x < size; x++) {
        expect(f[x], `frame ${n} touches the top edge`).toBe(bgIndex);
        expect(f[(size - 1) * size + x], `frame ${n} touches the bottom`).toBe(bgIndex);
      }
      for (let y = 0; y < size; y++) {
        expect(f[y * size], `frame ${n} touches the left edge`).toBe(bgIndex);
        expect(f[y * size + size - 1], `frame ${n} touches the right`).toBe(bgIndex);
      }
    });
  });

  it('marks the uncovered pixels transparent when asked', async () => {
    const size = 48;
    const asm = await assemblyOf(RIGGED);
    const { gif } = renderGif(
      asm,
      'idle',
      opts({ orbit: true, frames: 4, size, transparent: true }),
    );
    // The GCE must declare transparency and disposal 2; a corner pixel of
    // a centred model is always uncovered, so it must carry that index.
    const i = gif.indexOf(Buffer.from([0x21, 0xf9, 0x04]));
    const packed = gif[i + 3]!;
    expect(packed & 1, 'transparency flag').toBe(1);
    expect((packed >> 2) & 7, 'disposal method').toBe(2);
    const transparentIndex = gif[i + 6]!;
    for (const f of frameIndices(gif)) {
      expect(f[0]).toBe(transparentIndex);
      expect(f[size - 1]).toBe(transparentIndex);
      // …and the model itself is still drawn.
      expect(new Set(f).size).toBeGreaterThan(1);
    }
  });

  it('repeats the clip under one revolution with --loops', async () => {
    const asm = await assemblyOf(RIGGED);
    const perLoop = 6;
    const { frames } = renderGif(
      asm,
      'idle',
      opts({ orbit: true, frames: perLoop, loops: 3 }),
    );
    expect(frames).toBe(perLoop * 3);
  });

  it('reuses the pose cycle exactly — a still camera repeats pixel for pixel', async () => {
    // loops without orbit is a plain repeat, which pins the cycling
    // index: frame i and frame i+perLoop are the same pose AND the same
    // camera, so they must be byte-identical.
    const asm = await assemblyOf(RIGGED);
    const perLoop = 5;
    const { gif } = renderGif(asm, 'idle', opts({ frames: perLoop, loops: 2 }));
    const f = frameIndices(gif);
    expect(f).toHaveLength(perLoop * 2);
    for (let i = 0; i < perLoop; i++) {
      expect(f[i]!.join(',')).toBe(f[i + perLoop]!.join(','));
    }
  });
});

describe('runGif', () => {
  it('writes a GIF and reports what it rendered', async () => {
    const out = resolve(await mkdtemp(resolve(tmpdir(), 'cuboidy-gif-')), 'a.gif');
    const r = await runGif(resolve(REPO_ROOT, MULTIFILE), opts({ outFile: out }));
    expect(r.exitCode).toBe(0);
    expect(r.text).toMatch(/clip: wave/);
    const bytes = await readFile(out);
    expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  it('defaults to the model\'s first clip', async () => {
    const r = await runGif(resolve(REPO_ROOT, RIGGED), opts({
      outFile: resolve(await mkdtemp(resolve(tmpdir(), 'cuboidy-gif-')), 'b.gif'),
    }));
    expect(r.exitCode).toBe(0);
    expect(r.text).toMatch(/clip: idle/);
  });

  it('names the available clips when asked for one that does not exist', async () => {
    const r = await runGif(resolve(REPO_ROOT, RIGGED), opts({ clip: 'sprint' }));
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/unknown clip 'sprint'/);
    expect(r.text).toMatch(/'idle'/);
    expect(r.text).toMatch(/'step'/);
  });

  it('says so when a model has no animations at all, and points at --orbit', async () => {
    const r = await runGif(resolve(REPO_ROOT, MIRRORED), opts());
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/defines no animations/);
    expect(r.text).toMatch(/--orbit/);
  });

  it('writes a turntable for an animation-less model given --orbit', async () => {
    const out = resolve(await mkdtemp(resolve(tmpdir(), 'cuboidy-gif-')), 't.gif');
    const r = await runGif(
      resolve(REPO_ROOT, MIRRORED),
      opts({ orbit: true, frames: 6, outFile: out }),
    );
    expect(r.exitCode).toBe(0);
    expect(r.text).toMatch(/turntable \(6 frames, orbit from/);
    expect((await readFile(out)).subarray(0, 6).toString('latin1')).toBe('GIF89a');
  });

  it('reports a missing model directory as a usage error', async () => {
    const r = await runGif(resolve(REPO_ROOT, 'ts/testdata/nope'), opts());
    expect(r.exitCode).toBe(2);
  });
});
