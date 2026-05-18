import { err, ok, type Result } from '../result.js';
import type { Palette } from './palette.js';
import type { Pivot } from './pivot.js';
import type { Size } from './part.js';
import type { Socket } from './socket.js';
import { parseVoxelRow } from './voxel-row.js';
import type { RawVoxels } from './voxels.js';

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

// PartBuilder is the mutable accumulator used by PartParser + its sub-parsers
// (SizeParser, PivotParser, SocketParser, VoxelsParser). It is finalized into
// a PartDefinition during assembly (FileState.assemble).

export class PartBuilder {
  size: Size | null = null;
  sizeLineNo = 0;
  pivot: Pivot | null = null;
  pivotLineNo = 0;
  sockets: Socket[] = [];
  socketNames = new Set<string>();
  voxels: RawVoxels | null = null;

  constructor(
    public readonly name: string,
    public readonly headerLineNo: number,
  ) {}
}

// FileState holds the file-scope state shared across sub-parsers. Each parser
// reads and writes via its reference, isolating "what state belongs to whom"
// from the parsing logic. The assemble() method finalizes accumulated state
// into the public VoxelDefinition output.

export class FileState {
  palette: Palette | null = null;
  paletteLineNo = 0;
  parts: PartBuilder[] = [];
  partNames = new Set<string>();

  commitPart(builder: PartBuilder): void {
    this.parts.push(builder);
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
    for (const builder of this.parts) {
      const r = assemblePart(builder, palette);
      if (!r.ok) return r;
      finalParts.push(r.value);
    }
    return ok({ palette, parts: finalParts });
  }
}

function assemblePart(
  builder: PartBuilder,
  palette: Palette,
): Result<PartDefinition> {
  if (builder.size === null) {
    return err(
      'missing',
      `line ${builder.headerLineNo}: part '${builder.name}' missing size`,
    );
  }
  if (builder.voxels === null) {
    return err(
      'missing',
      `line ${builder.headerLineNo}: part '${builder.name}' missing voxels block`,
    );
  }
  const size = builder.size;
  const voxelsRaw = builder.voxels;

  if (voxelsRaw.sections.length !== size.h) {
    return err(
      'wrong-arity',
      `line ${voxelsRaw.voxelsLine}: voxels block for part '${builder.name}' has ${voxelsRaw.sections.length} layer-section(s), expected ${size.h}`,
    );
  }

  const pivot: Pivot = builder.pivot ?? {
    pos: { x: size.w / 2, y: 0, z: size.d / 2 },
  };

  const voxels: number[][][] = [];
  for (let y = 0; y < size.h; y++) {
    const section = voxelsRaw.sections[y]!;
    if (section.rows.length !== size.d) {
      return err(
        'wrong-arity',
        `line ${section.startLine}: voxels block for part '${builder.name}' layer ${y} has ${section.rows.length} row(s), expected ${size.d}`,
      );
    }
    const layerCells: number[][] = [];
    for (const row of section.rows) {
      const rowR = parseVoxelRow(row.text, size.w, palette.length);
      if (!rowR.ok) {
        return err(
          rowR.code,
          `line ${row.line}: part '${builder.name}' layer ${y}: ${rowR.message}`,
        );
      }
      layerCells.push(rowR.value);
    }
    voxels.push(layerCells);
  }

  return ok({
    name: builder.name,
    size,
    pivot,
    sockets: builder.sockets,
    voxels,
  });
}
