import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Palette } from '../cvox/types.js';
import { indexToChar } from '../cvox/voxel-row.js';
import { encodePng } from '../render/png.js';
import type { Rgb } from '../render/framebuffer.js';
import type { Angle } from '../render/camera.js';
import { STANDARD_IDS, ANGLES } from '../render/camera.js';
import { buildSceneFromParts, type Scene } from '../render/scene.js';
import {
  computeGlobalScale,
  renderContactSheet,
  renderTile,
  type ContactTile,
} from '../render/snapshot.js';
import { loadAndAssemble, type Assembly, type BBox } from './assemble.js';

// cuboidy-snap: assemble a model in rest pose and render it to PNG images
// from several angles — the raster counterpart to cuboidy-view's ASCII
// projection. The intended workflow is for a multimodal reader (Claude
// Code) to look at the images and propose edits to the model. Output is
// a contact sheet (all angles in one labeled image) plus one PNG per
// angle, written under <out>/.
//
// Unlike the grid-bound cuboidy-view / cuboidy-query, snap renders the
// full REST pose: rest rotations (§6.2 manifest `rotation`, §7.7
// `pivot.rot`) draw as true oriented cubes via the shared rig-transform
// layer. Animation poses are still not applied. Palette alpha is
// ignored (voxels render opaque).

export interface SnapOptions {
  angles: readonly Angle[];
  tileSize: number;
  ss: number; // supersample factor
  bg: Rgb;
  cols: number; // contact-sheet columns
  sheet: boolean; // emit the contact sheet
  individual: boolean; // emit per-angle PNGs
  outDir: string;
}

export interface RunResult {
  text: string;
  exitCode: 0 | 1 | 2;
}

export const DEFAULT_ANGLES: readonly Angle[] = STANDARD_IDS.map((id) => ANGLES[id]!);

export const DEFAULTS = {
  tileSize: 256,
  ss: 2,
  bg: [0.533, 0.553, 0.58] as Rgb, // neutral gray (#888e94-ish)
  cols: 4,
} as const;

// Pure render: assembly → encoded PNGs. No filesystem access, so tests
// can assert on bytes and counts directly.
export interface RenderedSnapshots {
  tiles: { id: string; label: string; png: Buffer }[];
  sheet: Buffer | null;
  scalePxPerVoxel: number;
  // World-space bounds of the rendered scene (rotation-aware, from the
  // oriented quads — the grid bbox can undershoot when parts rest
  // rotated). Reported in the summary and the contact-sheet title.
  bounds: BBox;
}

export function renderSnapshots(asm: Assembly, opts: SnapOptions): RenderedSnapshots {
  const scene = buildSceneFromParts(asm.resolvedParts, asm.palette);
  const scale = computeGlobalScale(scene, opts.angles, opts);

  const tiles: { id: string; label: string; png: Buffer }[] = [];
  const contactTiles: ContactTile[] = [];
  for (const angle of opts.angles) {
    const fb = renderTile(scene, angle, scale, opts);
    tiles.push({
      id: angle.id,
      label: angle.label,
      png: encodePng(fb.width, fb.height, fb.toRgba()),
    });
    contactTiles.push({ label: angle.label, fb });
  }

  const bounds = sceneBounds(scene);
  let sheet: Buffer | null = null;
  if (opts.sheet && contactTiles.length > 0) {
    const title = sheetTitle(asm, bounds, scale);
    const fb = renderContactSheet(contactTiles, title, opts.cols);
    sheet = encodePng(fb.width, fb.height, fb.toRgba());
  }

  return { tiles, sheet, scalePxPerVoxel: scale, bounds };
}

export async function runSnap(dir: string, opts: SnapOptions): Promise<RunResult> {
  const loaded = await loadAndAssemble(dir);
  if (!loaded.ok) {
    return { text: `cuboidy-snap: ${loaded.message}\n`, exitCode: loaded.exitCode };
  }
  const asm = loaded.assembly;
  if (asm.grid.size === 0) {
    return {
      text: 'cuboidy-snap: model has no visible voxels (all AIR or no parts assembled)\n',
      exitCode: 1,
    };
  }

  const rendered = renderSnapshots(asm, opts);
  const outDir = resolve(opts.outDir);
  await mkdir(outDir, { recursive: true });

  const written: string[] = [];
  if (opts.individual) {
    for (const tile of rendered.tiles) {
      const path = join(outDir, `${tile.id}.png`);
      await writeFile(path, tile.png);
      written.push(path);
    }
  }
  if (rendered.sheet) {
    const path = join(outDir, 'contact.png');
    await writeFile(path, rendered.sheet);
    written.push(path);
  }

  return {
    text: summary(asm, opts, rendered, outDir, written),
    exitCode: 0,
  };
}

// --- helpers ---------------------------------------------------------------

function sceneBounds(scene: Scene): BBox {
  return {
    minX: scene.min[0], maxX: scene.max[0],
    minY: scene.min[1], maxY: scene.max[1],
    minZ: scene.min[2], maxZ: scene.max[2],
  };
}

function intBBox(b: BBox): BBox {
  return {
    minX: Math.floor(b.minX), maxX: Math.ceil(b.maxX),
    minY: Math.floor(b.minY), maxY: Math.ceil(b.maxY),
    minZ: Math.floor(b.minZ), maxZ: Math.ceil(b.maxZ),
  };
}

function sheetTitle(asm: Assembly, bounds: BBox, scale: number): string {
  const b = intBBox(bounds);
  return (
    `${asm.manifest.name}  ` +
    `X${b.minX}..${b.maxX} Y${b.minY}..${b.maxY} Z${b.minZ}..${b.maxZ}  ` +
    `PX/VOX ${Math.round(scale)}`
  );
}

function summary(
  asm: Assembly,
  opts: SnapOptions,
  rendered: RenderedSnapshots,
  outDir: string,
  written: readonly string[],
): string {
  const b = intBBox(rendered.bounds);
  const out: string[] = [];
  out.push(`model: ${asm.manifest.name}`);
  out.push(`parts: ${asm.order.map((p) => p.name).join(' ')}`);
  out.push(
    `world bounds: X=${b.minX}..${b.maxX} Y=${b.minY}..${b.maxY} Z=${b.minZ}..${b.maxZ}`,
  );
  out.push(`pixels per voxel: ${Math.round(rendered.scalePxPerVoxel)} (tile ${opts.tileSize}px, ss ${opts.ss})`);
  if (asm.hasFractional) {
    out.push('note: half-voxel offsets present (geometry rendered at true position; use cuboidy-query for exact lookups)');
  }
  out.push('');
  out.push(formatPalette(asm.palette));
  out.push('');
  out.push('angles rendered:');
  for (const angle of opts.angles) {
    out.push(`  ${angle.id.padEnd(7)} ${angle.label.padEnd(7)} az=${angle.az} el=${angle.el}`);
  }
  out.push('');
  out.push(`output dir: ${outDir}`);
  for (const path of written) out.push(`  wrote ${path}`);
  if (written.length === 0) out.push('  (no files written: sheet and individual output both disabled)');
  for (const w of asm.warnings) out.push(`warning: ${w}`);
  return out.join('\n');
}

function formatPalette(palette: Palette): string {
  const lines = ['palette:'];
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]!;
    const hex =
      '#' + toHex(c.r) + toHex(c.g) + toHex(c.b) + (c.a === 255 ? '' : toHex(c.a));
    lines.push(`  ${indexToChar(i)} = ${hex}`);
  }
  return lines.join('\n');
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0').toUpperCase();
}
