// Software framebuffer: an RGBA color buffer plus a parallel depth
// buffer, with just enough rasterization to draw a voxel model — filled
// triangles with z-test (the 3D pass) and flat 2D lines/rects (labels,
// the axis gnomon, contact-sheet matte). Everything is deterministic
// integer/float math with no platform dependencies, so a given model +
// camera always produces byte-identical pixels.

export type Rgb = readonly [number, number, number]; // 0..1 per channel

export interface ScreenVert {
  x: number; // pixel-space x (sub-pixel ok)
  y: number; // pixel-space y (sub-pixel ok)
  depth: number; // view-space depth; smaller = nearer the camera
}

export class Framebuffer {
  readonly width: number;
  readonly height: number;
  readonly color: Uint8Array; // RGBA, row-major, length w*h*4
  readonly depth: Float32Array; // length w*h, +Infinity = empty

  constructor(width: number, height: number, bg: Rgb) {
    this.width = width;
    this.height = height;
    this.color = new Uint8Array(width * height * 4);
    this.depth = new Float32Array(width * height).fill(Infinity);
    const r = to8(bg[0]);
    const g = to8(bg[1]);
    const b = to8(bg[2]);
    for (let i = 0; i < width * height; i++) {
      this.color[i * 4] = r;
      this.color[i * 4 + 1] = g;
      this.color[i * 4 + 2] = b;
      this.color[i * 4 + 3] = 255;
    }
  }

  // Fill a depth-tested triangle with a single flat color. Pixels are
  // sampled at their centers (x+0.5, y+0.5). Depth is interpolated with
  // screen-space barycentrics — adequate for orthographic projection,
  // where depth is linear in screen space.
  fillTriangle(a: ScreenVert, b: ScreenVert, c: ScreenVert, rgb: Rgb): void {
    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    if (minX > maxX || minY > maxY) return;

    // Signed area * 2 (orientation-independent: we accept either winding
    // so back-face culling is the renderer's job, not the rasterizer's).
    const area = edge(a, b, c);
    if (area === 0) return; // degenerate
    const inv = 1 / area;

    const r = to8(rgb[0]);
    const g = to8(rgb[1]);
    const bch = to8(rgb[2]);

    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const p = { x: px, y: py, depth: 0 };
        // Barycentric weights via edge functions.
        let w0 = edge(b, c, p) * inv;
        let w1 = edge(c, a, p) * inv;
        let w2 = edge(a, b, p) * inv;
        // Inside test tolerant of either winding.
        if ((w0 < 0 || w1 < 0 || w2 < 0) && (w0 > 0 || w1 > 0 || w2 > 0)) {
          continue;
        }
        const d = w0 * a.depth + w1 * b.depth + w2 * c.depth;
        const i = y * this.width + x;
        if (d < this.depth[i]!) {
          this.depth[i] = d;
          const o = i * 4;
          this.color[o] = r;
          this.color[o + 1] = g;
          this.color[o + 2] = bch;
          this.color[o + 3] = 255;
        }
      }
    }
  }

  // Opaque 2D pixel, ignoring depth (overlays: labels, gnomon, borders).
  setPixel(x: number, y: number, rgb: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 4;
    this.color[o] = to8(rgb[0]);
    this.color[o + 1] = to8(rgb[1]);
    this.color[o + 2] = to8(rgb[2]);
    this.color[o + 3] = 255;
  }

  // Filled axis-aligned rectangle (2D overlay).
  fillRect(x0: number, y0: number, w: number, h: number, rgb: Rgb): void {
    const xs = Math.max(0, x0);
    const ys = Math.max(0, y0);
    const xe = Math.min(this.width, x0 + w);
    const ye = Math.min(this.height, y0 + h);
    for (let y = ys; y < ye; y++) {
      for (let x = xs; x < xe; x++) this.setPixel(x, y, rgb);
    }
  }

  // Bresenham line (2D overlay, depth-ignored). Used for the gnomon.
  drawLine(x0: number, y0: number, x1: number, y1: number, rgb: Rgb): void {
    let ax = Math.round(x0);
    let ay = Math.round(y0);
    const bx = Math.round(x1);
    const by = Math.round(y1);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let errAcc = dx + dy;
    for (;;) {
      this.setPixel(ax, ay, rgb);
      if (ax === bx && ay === by) break;
      const e2 = 2 * errAcc;
      if (e2 >= dy) {
        errAcc += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        errAcc += dx;
        ay += sy;
      }
    }
  }

  // Blit another framebuffer's color (opaque) at (dx, dy). Used to tile
  // per-angle renders into the contact sheet.
  blit(src: Framebuffer, dx: number, dy: number): void {
    for (let y = 0; y < src.height; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= this.height) continue;
      for (let x = 0; x < src.width; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= this.width) continue;
        const so = (y * src.width + x) * 4;
        const to = (ty * this.width + tx) * 4;
        this.color[to] = src.color[so]!;
        this.color[to + 1] = src.color[so + 1]!;
        this.color[to + 2] = src.color[so + 2]!;
        this.color[to + 3] = 255;
      }
    }
  }

  // Box-downsample by an integer factor, averaging color in 8-bit space.
  // Anti-aliases the supersampled 3D pass before overlays are drawn.
  //
  // Output dims floor width/height by the factor, so every output pixel's
  // factor×factor source block lies fully in bounds (w*factor ≤ width) and
  // averages exactly factor² samples — no edge bias. Any remainder row/
  // column is dropped; the supersample pipeline always passes exact
  // multiples (tileSize*ss ÷ ss), so no remainder occurs in practice.
  downsample(factor: number): Framebuffer {
    if (factor <= 1) return this;
    const w = Math.floor(this.width / factor);
    const h = Math.floor(this.height / factor);
    const out = new Framebuffer(w, h, [0, 0, 0]);
    const n = factor * factor;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < factor; sy++) {
          for (let sx = 0; sx < factor; sx++) {
            const o = ((y * factor + sy) * this.width + (x * factor + sx)) * 4;
            r += this.color[o]!;
            g += this.color[o + 1]!;
            b += this.color[o + 2]!;
          }
        }
        const o = (y * w + x) * 4;
        out.color[o] = Math.round(r / n);
        out.color[o + 1] = Math.round(g / n);
        out.color[o + 2] = Math.round(b / n);
        out.color[o + 3] = 255;
      }
    }
    return out;
  }

  toRgba(): Uint8Array {
    return this.color;
  }
}

// Twice the signed area of triangle (a, b, p); sign encodes which side
// of edge a→b the point p lies on.
function edge(a: ScreenVert, b: ScreenVert, p: { x: number; y: number }): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function to8(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 255;
  return Math.round(c * 255);
}
