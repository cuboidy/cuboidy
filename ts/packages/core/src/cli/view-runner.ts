import { AIR, indexToChar } from '../geometry/voxel-row.js';
import {
  gridRotationWarnings,
  loadAndAssemble,
  parseCoordKey,
  type Assembly,
  type BBox,
} from './assemble.js';
import { formatPaletteBlock } from './palette-legend.js';

// cuboidy-view: assemble a model in rest pose, project to 2D from one or
// more cardinal view directions, and emit each view as a grid of palette
// index characters (the same alphabet used in voxels.json so a reader can
// directly compare the projection against source rows).
//
// Coordinate convention follows SPEC §4: +X right, +Y up, −Z forward
// (the model faces −Z). For each view we pick the camera position and
// the screen "up" axis so the output reads naturally:
//   - front  — camera at −Z looking +Z (we see the face)
//   - back   — camera at +Z looking −Z
//   - left   — camera at −X looking +X (model's left side)
//   - right  — camera at +X looking −X (model's right side)
//   - top    — camera at +Y looking −Y, screen-up = −Z (model's front on top)
//   - bottom — camera at −Y looking +Y, screen-up = +Z (model's back on top)
//
// Rest rotations (§6.2 manifest `rotation`, §7.7 `pivot.rot`) move each
// part's PIVOT to its true rig position, but the part's own voxels stay
// axis-aligned — an integer-lattice projection cannot draw a turned
// cube. Affected parts emit a warning pointing at cuboidy-snap, which
// renders the true orientation. Animation poses are never applied.
//
// Fractional world coordinates (which arise when a part's pivot or
// position contains 0.5-style offsets) are **snapped to the integer
// grid at projection time** via Math.round. Two voxels that round to
// the same screen cell collide; the front-most wins by depth. When
// this happens, the header carries a `half-voxel detected` notice so
// the LLM consumer can switch to cuboidy-query for exact lookups.

export const VIEW_NAMES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

export interface ViewOptions {
  views: readonly ViewName[];
}

export interface RunResult {
  text: string;
  exitCode: 0 | 1 | 2;
}

export async function runView(
  dir: string,
  opts: ViewOptions,
): Promise<RunResult> {
  const loaded = await loadAndAssemble(dir);
  if (!loaded.ok) {
    return fail(loaded.message, loaded.exitCode);
  }
  return renderModel(loaded.assembly, opts);
}

function fail(message: string, exitCode: 1 | 2): RunResult {
  return { text: `cuboidy-view: ${message}\n`, exitCode };
}

// --- assembly + projection -------------------------------------------------

interface WorldCell {
  X: number;
  Y: number;
  Z: number;
}

function renderModel(asm: Assembly, opts: ViewOptions): RunResult {
  if (asm.grid.size === 0) {
    return fail('model has no visible voxels (all AIR or no parts assembled)', 1);
  }

  // Snap the fractional bbox to the integer grid the projection works
  // on. minX/Y/Z floor, maxX/Y/Z ceil — this guarantees every voxel
  // after rounding lands inside the screen extent.
  const intBBox: BBox = {
    minX: Math.floor(asm.bbox.minX), maxX: Math.ceil(asm.bbox.maxX),
    minY: Math.floor(asm.bbox.minY), maxY: Math.ceil(asm.bbox.maxY),
    minZ: Math.floor(asm.bbox.minZ), maxZ: Math.ceil(asm.bbox.maxZ),
  };

  const out: string[] = [];
  out.push(`model: ${asm.manifest.name}`);
  out.push(`parts: ${asm.order.map((p) => p.name).join(' ')}`);
  out.push(formatBBox(intBBox));
  if (asm.hasFractional) {
    out.push(
      'note: half-voxel offsets present; this projection snaps to the integer grid (use cuboidy-query for exact lookups)',
    );
  }
  out.push('');
  // The header block printed here came from the text format's leading comments
  // (SPEC §7.11.1, retired). JSON geometry carries none, so there is nothing
  // left to echo.
  out.push(formatPaletteBlock(asm.palette));
  out.push('');
  out.push('voxel cell legend: each character is the palette index of the front-most voxel along the view direction; `.` = empty');
  out.push('');

  for (const view of opts.views) {
    out.push(`--- ${view} ---`);
    out.push(viewDescription(view));
    const grid2d = projectView(asm, intBBox, view);
    for (const row of grid2d) out.push(row);
    out.push('');
  }

  for (const w of asm.warnings) out.push(`warning: ${w}`);
  for (const w of gridRotationWarnings(asm)) out.push(`warning: ${w}`);

  return { text: out.join('\n'), exitCode: 0 };
}

// --- view projection -------------------------------------------------------
//
// Each view is defined by three functions over a world cell (X, Y, Z):
//   sx — horizontal screen coord (smaller = left)
//   sy — vertical screen coord (smaller = top of screen)
//   d  — depth (smaller = closer to camera; front-most voxel wins)
//
// Functions return raw signed values; the renderer offsets to 0-based
// indices after collecting all visible cells.

interface Projection {
  sx(c: WorldCell): number;
  sy(c: WorldCell): number;
  d(c: WorldCell): number;
}

const PROJECTIONS: Record<ViewName, Projection> = {
  // camera at −Z, looking +Z; up = +Y, right = +X
  front: {
    sx: (c) => c.X,
    sy: (c) => -c.Y,
    d: (c) => c.Z,
  },
  // camera at +Z, looking −Z; up = +Y, right = −X
  back: {
    sx: (c) => -c.X,
    sy: (c) => -c.Y,
    d: (c) => -c.Z,
  },
  // camera at −X, looking +X; up = +Y, right = +Z (model's back to screen-right)
  left: {
    sx: (c) => c.Z,
    sy: (c) => -c.Y,
    d: (c) => c.X,
  },
  // camera at +X, looking −X; up = +Y, right = −Z (model's front to screen-right)
  right: {
    sx: (c) => -c.Z,
    sy: (c) => -c.Y,
    d: (c) => -c.X,
  },
  // camera at +Y, looking −Y; up = −Z (model's front at screen-top), right = +X
  top: {
    sx: (c) => c.X,
    sy: (c) => c.Z,
    d: (c) => -c.Y,
  },
  // camera at −Y, looking +Y; up = +Z (model's back at screen-top), right = +X
  bottom: {
    sx: (c) => c.X,
    sy: (c) => -c.Z,
    d: (c) => c.Y,
  },
};

function viewDescription(view: ViewName): string {
  switch (view) {
    case 'front':  return 'camera at −Z looking +Z; screen X = world +X, screen Y top→bottom = world +Y → −Y';
    case 'back':   return 'camera at +Z looking −Z; screen X = world −X, screen Y top→bottom = world +Y → −Y';
    case 'left':   return "camera at −X looking +X (model's left side); screen X = world +Z, screen Y top→bottom = world +Y → −Y";
    case 'right':  return "camera at +X looking −X (model's right side); screen X = world −Z, screen Y top→bottom = world +Y → −Y";
    case 'top':    return "camera at +Y looking −Y (top down); screen X = world +X, screen Y top→bottom = world −Z → +Z (model's front on top)";
    case 'bottom': return "camera at −Y looking +Y (bottom up); screen X = world +X, screen Y top→bottom = world +Z → −Z (model's back on top)";
  }
}

function projectView(asm: Assembly, intBBox: BBox, view: ViewName): string[] {
  const proj = PROJECTIONS[view];

  // Screen bbox: project each of the 8 world bbox corners. The screen
  // bbox is rectangular, so corners suffice to find min/max in each
  // screen axis. We use the *integer* bbox so the screen extent is an
  // integer cell count even when assembly bbox is fractional.
  let minSx = Infinity, maxSx = -Infinity;
  let minSy = Infinity, maxSy = -Infinity;
  for (const X of [intBBox.minX, intBBox.maxX]) {
    for (const Y of [intBBox.minY, intBBox.maxY]) {
      for (const Z of [intBBox.minZ, intBBox.maxZ]) {
        const c = { X, Y, Z };
        const sx = proj.sx(c);
        const sy = proj.sy(c);
        if (sx < minSx) minSx = sx;
        if (sx > maxSx) maxSx = sx;
        if (sy < minSy) minSy = sy;
        if (sy > maxSy) maxSy = sy;
      }
    }
  }
  const width = maxSx - minSx + 1;
  const height = maxSy - minSy + 1;

  // Per-pixel: keep the voxel with smallest depth.
  const winners: number[] = new Array(width * height).fill(AIR);
  const depths: number[] = new Array(width * height).fill(Infinity);

  for (const [key, idx] of asm.grid) {
    const frac = parseCoordKey(key);
    // Snap fractional world coords to the integer grid. Math.round
    // rounds .5 toward +∞ (JS spec); deterministic and adequate for
    // visualization. The cost is collisions at half-voxel offsets,
    // which is exactly why cuboidy-query exists.
    const c: WorldCell = {
      X: Math.round(frac.x),
      Y: Math.round(frac.y),
      Z: Math.round(frac.z),
    };
    const sx = proj.sx(c) - minSx;
    const sy = proj.sy(c) - minSy;
    const d = proj.d(c);
    const i = sy * width + sx;
    if (d < depths[i]!) {
      depths[i] = d;
      winners[i] = idx;
    }
  }

  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let line = '';
    for (let x = 0; x < width; x++) {
      const idx = winners[y * width + x]!;
      line += idx === AIR ? '.' : indexToChar(idx);
    }
    rows.push(line);
  }
  return rows;
}

// --- helpers ---------------------------------------------------------------

function formatBBox(b: BBox): string {
  return (
    `world bounds: ` +
    `X=${b.minX}..${b.maxX} (width ${b.maxX - b.minX + 1}) ` +
    `Y=${b.minY}..${b.maxY} (height ${b.maxY - b.minY + 1}) ` +
    `Z=${b.minZ}..${b.maxZ} (depth ${b.maxZ - b.minZ + 1})`
  );
}

