import { err, ok, type Result } from '../result.js';
import type { Palette } from './palette.js';
import type { Pivot } from './pivot.js';
import type { PartState, Size } from './part.js';
import type { Socket } from './socket.js';
import { parseVoxelRow } from './voxel-row.js';

// Output types — the result of a successful parseCvox call.

export interface VoxelDefinition {
  palette: Palette;
  parts: PartDefinition[];
}

export interface PartDefinition {
  name: string;
  size: Size;
  pivot: Pivot;
  sockets: readonly Socket[];
  voxels: readonly (readonly (readonly number[])[])[];
}

// CvoxState holds file-scope state shared across sub-parsers. Each parser
// reads its parent state (this for top-level parsers, PartState for
// part-scoped parsers) for duplicate detection; the caller of each parser
// commits the returned value back to this state. The assemble() method
// finalizes accumulated state into the public VoxelDefinition output.

export class CvoxState {
  palette: Palette | null = null;
  paletteLineNo = 0;
  parts: PartState[] = [];
  partNames = new Set<string>();

  commitPart(state: PartState): void {
    this.partNames.add(state.name);
    this.parts.push(state);
  }

  assemble(): Result<VoxelDefinition> {
    if (this.palette === null) {
      return err('missing', 'missing palette declaration');
    }
    if (this.parts.length === 0) {
      return err('missing', 'file contains palette but no parts');
    }

    const palette = this.palette;
    const finalParts: PartDefinition[] = [];
    for (const part of this.parts) {
      const r = assemblePart(part, palette);
      if (!r.ok) return r;
      finalParts.push(r.value);
    }
    return ok({ palette, parts: finalParts });
  }
}

function assemblePart(
  part: PartState,
  palette: Palette,
): Result<PartDefinition> {
  if (part.size === null) {
    return err(
      'missing',
      `line ${part.headerLineNo}: part '${part.name}' missing size`,
    );
  }
  if (part.voxels === null) {
    return err(
      'missing',
      `line ${part.headerLineNo}: part '${part.name}' missing voxels block`,
    );
  }
  const size = part.size;
  const voxelsRaw = part.voxels;

  if (voxelsRaw.sections.length !== size.h) {
    return err(
      'wrong-arity',
      `line ${voxelsRaw.voxelsLine}: voxels block for part '${part.name}' has ${voxelsRaw.sections.length} layer-section(s), expected ${size.h}`,
    );
  }

  const pivot: Pivot = part.pivot ?? {
    pos: { x: size.w / 2, y: 0, z: size.d / 2 },
  };

  const voxels: number[][][] = [];
  for (let y = 0; y < size.h; y++) {
    const section = voxelsRaw.sections[y]!;
    if (section.rows.length !== size.d) {
      return err(
        'wrong-arity',
        `line ${section.startLine}: voxels block for part '${part.name}' layer ${y} has ${section.rows.length} row(s), expected ${size.d}`,
      );
    }
    const layerCells: number[][] = [];
    for (const row of section.rows) {
      const rowR = parseVoxelRow(row.text, size.w, palette.length);
      if (!rowR.ok) {
        return err(
          rowR.code,
          `line ${row.line}: part '${part.name}' layer ${y}: ${rowR.message}`,
        );
      }
      layerCells.push(rowR.value);
    }
    voxels.push(layerCells);
  }

  return ok({
    name: part.name,
    size,
    pivot,
    sockets: part.sockets,
    voxels,
  });
}
