import { Framebuffer, type Rgb } from './framebuffer.js';
import { drawText, textHeight, textWidth } from './font.js';
import { makeProjector, type Angle } from './camera.js';
import type { Scene } from './scene.js';
import { dot, normalize, type Vec3 } from './vec.js';

// Compose scene + camera + framebuffer + font into finished per-angle
// tiles and a contact sheet. Shading is a deterministic two-light flat
// model in sRGB space: a key light defines the brightest (top) faces, a
// dim fill keeps shadowed sides legible, and ambient lifts everything
// off the background. Legibility for a model reviewer — not photoreal —
// is the goal, so each cube face reads as one of a few distinct levels.

const AMBIENT = 0.42;
const KEY = 0.42;
const FILL = 0.22;
const KEY_DIR = normalize([-0.5, 1, -0.7]); // toward key light
const FILL_DIR = normalize([0.9, 0.3, 0.3]); // toward fill light

const MATTE: Rgb = [0.227, 0.239, 0.259]; // contact-sheet background
const LABEL_FG: Rgb = [0.96, 0.97, 0.98];
const LABEL_BG: Rgb = [0.08, 0.09, 0.1];
const AXIS_X: Rgb = [0.95, 0.35, 0.35];
const AXIS_Y: Rgb = [0.45, 0.85, 0.4];
const AXIS_Z: Rgb = [0.45, 0.6, 0.95];

export interface RenderOptions {
  tileSize: number; // final per-tile pixel size (square)
  ss: number; // supersample factor for the 3D pass
  bg: Rgb; // per-tile background
  // Angle label + axis gnomon baked into the tile. On for stills, where
  // the reader needs to know which way they are looking; off for
  // animation frames, where it would flicker and the viewer already has
  // motion to orient by. Default true.
  overlay?: boolean;
}

const PAD_FRAC = 0.08; // fraction of the tile left empty around the model

// Final pixels-per-world-unit shared by every angle, so tiles are
// mutually comparable: fit the most demanding projected span into all
// tiles. renderTile multiplies this by the supersample factor for the
// off-screen pass, so the scale here is in final (downsampled) pixels.
export function computeGlobalScale(
  scene: Scene,
  angles: readonly Angle[],
  opts: RenderOptions,
): number {
  const inner = opts.tileSize * (1 - 2 * PAD_FRAC);
  const corners = extentCorners(scene);
  let scale = Infinity;
  for (const angle of angles) {
    const proj = makeProjector(angle, scene.center);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of corners) {
      const p = proj.project(c);
      if (p.sx < minX) minX = p.sx;
      if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy;
      if (p.sy > maxY) maxY = p.sy;
    }
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    scale = Math.min(scale, inner / spanX, inner / spanY);
  }
  return Number.isFinite(scale) ? scale : 1;
}

export function renderTile(
  scene: Scene,
  angle: Angle,
  scale: number,
  opts: RenderOptions,
): Framebuffer {
  const dim = opts.tileSize * opts.ss;
  const fb = new Framebuffer(dim, dim, opts.bg);
  const proj = makeProjector(angle, scene.center);
  const cx = dim / 2;
  const cy = dim / 2;
  const s = scale * opts.ss;

  const toScreen = (p: Vec3) => {
    const pr = proj.project(p);
    return { x: cx + pr.sx * s, y: cy - pr.sy * s, depth: pr.depth };
  };

  for (const quad of scene.quads) {
    // Back-face cull: keep faces whose normal points toward the camera.
    if (dot(quad.normal, proj.viewDir) >= 0) continue;
    const intensity = shade(quad.normal);
    const rgb: Rgb = [
      quad.color[0] * intensity,
      quad.color[1] * intensity,
      quad.color[2] * intensity,
    ];
    const v = quad.corners.map(toScreen) as [
      { x: number; y: number; depth: number },
      { x: number; y: number; depth: number },
      { x: number; y: number; depth: number },
      { x: number; y: number; depth: number },
    ];
    fb.fillTriangle(v[0], v[1], v[2], rgb);
    fb.fillTriangle(v[0], v[2], v[3], rgb);
  }

  const tile = fb.downsample(opts.ss);
  if (opts.overlay !== false) {
    drawGnomon(tile, angle);
    drawLabel(tile, `${angle.label} AZ${angle.az} EL${angle.el}`);
  }
  return tile;
}

function shade(normal: Vec3): number {
  const i =
    AMBIENT +
    KEY * Math.max(0, dot(normal, KEY_DIR)) +
    FILL * Math.max(0, dot(normal, FILL_DIR));
  return Math.min(1, i);
}

// Outlined label at top-left so it stays readable over any model/bg.
function drawLabel(fb: Framebuffer, text: string): void {
  const scale = Math.max(1, Math.round(fb.width / 128));
  const x = Math.round(fb.width * 0.04);
  const y = x;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    drawText(fb, x + dx, y + dy, text, scale, LABEL_BG);
  }
  drawText(fb, x, y, text, scale, LABEL_FG);
}

// Small XYZ axis indicator (gnomon) in the bottom-left corner, drawn on
// a dark chip. Projects the three world axes through the same camera so
// the reader can orient any view at a glance.
function drawGnomon(fb: Framebuffer, angle: Angle): void {
  const proj = makeProjector(angle, [0, 0, 0]);
  const r = Math.round(fb.width * 0.1);
  const margin = Math.round(fb.width * 0.04);
  const ox = margin + r;
  const oy = fb.height - margin - r;
  const chip = r + Math.round(fb.width * 0.05);
  fb.fillRect(ox - chip, oy - chip, chip * 2, chip * 2, LABEL_BG);

  const axes: ReadonlyArray<readonly [Vec3, Rgb, string]> = [
    [[1, 0, 0], AXIS_X, 'X'],
    [[0, 1, 0], AXIS_Y, 'Y'],
    [[0, 0, 1], AXIS_Z, 'Z'],
  ];
  const labelScale = Math.max(1, Math.round(fb.width / 200));
  for (const [dir, color, name] of axes) {
    const p = proj.project(dir);
    const ex = ox + p.sx * r;
    const ey = oy - p.sy * r;
    fb.drawLine(ox, oy, ex, ey, color);
    drawText(
      fb,
      Math.round(ex - (textWidth(name, labelScale) / 2)),
      Math.round(ey - textHeight(labelScale) / 2),
      name,
      labelScale,
      color,
    );
  }
}

function extentCorners(scene: Scene): Vec3[] {
  const { min, max } = scene;
  const corners: Vec3[] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        corners.push([x, y, z]);
      }
    }
  }
  return corners;
}

export interface ContactTile {
  label: string;
  fb: Framebuffer;
}

// Arrange finished tiles into a single labeled sheet (reading order,
// left-to-right, top-to-bottom). `title` is drawn as a header strip.
export function renderContactSheet(
  tiles: readonly ContactTile[],
  title: string,
  cols: number,
): Framebuffer {
  const tileSize = tiles[0]?.fb.width ?? 256;
  const n = tiles.length;
  const columns = Math.min(cols, Math.max(1, n));
  const rows = Math.ceil(n / columns);
  const pad = Math.round(tileSize * 0.04);
  const titleScale = Math.max(1, Math.round(tileSize / 110));
  const headerH = textHeight(titleScale) + pad * 2;

  const width = columns * tileSize + (columns + 1) * pad;
  const height = headerH + rows * tileSize + (rows + 1) * pad;
  const sheet = new Framebuffer(width, height, MATTE);

  drawText(sheet, pad, pad, title, titleScale, LABEL_FG);

  for (let i = 0; i < n; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = pad + col * (tileSize + pad);
    const y = headerH + pad + row * (tileSize + pad);
    sheet.blit(tiles[i]!.fb, x, y);
  }
  return sheet;
}
