import { err, ok, type CuboidyErrorCode, type Result } from '../result.js';
import {
  KNOWN_KEYWORDS,
  VOXEL_ROW_RE,
  classifyLine,
  type CvoxLine,
} from './classify.js';
import { type Palette, parsePalette } from './palette.js';
import { parsePartHeader, parseSize, type Size } from './part.js';
import { parsePivot, type Pivot } from './pivot.js';
import { parseSocket, type Socket } from './socket.js';
import { parseLayerHeader, parseVoxelRow } from './layer.js';

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

interface RawLayer {
  index: number;
  rows: string[];
  indexLineNo: number;
}

class PartBuilder {
  size: Size | null = null;
  sizeLineNo = 0;
  pivot: Pivot | null = null;
  pivotLineNo = 0;
  sockets: Socket[] = [];
  socketNames = new Set<string>();
  layers = new Map<number, RawLayer>();
  active: RawLayer | null = null;

  constructor(
    public readonly name: string,
    public readonly headerLineNo: number,
  ) {}
}

class CvoxAssembler {
  private palette: Palette | null = null;
  private paletteLineNo = 0;
  private parts: PartBuilder[] = [];
  private partNames = new Set<string>();
  private cur: PartBuilder | null = null;
  private lineNo = 0;

  parse(text: string): Result<VoxelDefinition> {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      this.lineNo = i + 1;
      const line = classifyLine(lines[i]!);
      const r = this.processLine(line);
      if (!r.ok) return r;
    }
    const closeR = this.closeCurrentPart();
    if (!closeR.ok) return closeR;

    if (this.palette === null) {
      return err('E01', 'missing palette declaration');
    }
    if (this.parts.length === 0) {
      return err('E19', 'file contains palette but no parts');
    }

    const finalParts: PartDefinition[] = [];
    for (const builder of this.parts) {
      const a = this.assemblePart(builder, this.palette);
      if (!a.ok) return a;
      finalParts.push(a.value);
    }
    return ok({ palette: this.palette, parts: finalParts });
  }

  private processLine(line: CvoxLine): Result<void> {
    switch (line.kind) {
      case 'blank':
        return ok(undefined);
      case 'error':
        return this.fail(line.code, line.message);
      case 'voxel-row':
        return this.handleVoxelRow(line.text);
      case 'keyword':
        return this.handleKeyword(line.keyword, line.args);
    }
  }

  private handleVoxelRow(text: string): Result<void> {
    if (this.cur === null || this.cur.active === null) {
      return this.fail('E10', `voxel row outside any layer`);
    }
    this.cur.active.rows.push(text);
    return ok(undefined);
  }

  private handleKeyword(keyword: string, args: readonly string[]): Result<void> {
    // SPEC §7.9: a line whose first token is not a known keyword AND whose
    // tokens are all valid voxel-row shapes is treated as a continuation of
    // the active layer. This must be checked before flushing.
    if (!KNOWN_KEYWORDS.has(keyword)) {
      if (this.cur?.active) {
        const tokens = [keyword, ...args];
        if (tokens.every((t) => VOXEL_ROW_RE.test(t))) {
          for (const rowText of tokens) {
            this.cur.active.rows.push(rowText);
          }
          return ok(undefined);
        }
      }
      return this.fail('E04', `unknown keyword '${keyword}'`);
    }

    // Q(b): any known keyword line closes the active layer.
    // Q(a): `palette` is file-level and does NOT close the current part
    // section, but it does close the active layer (no rows belong to it).
    const flushR = this.flushActiveLayer();
    if (!flushR.ok) return flushR;

    if (keyword === 'palette') return this.handlePalette(args);
    if (keyword === 'part') return this.handlePart(args);

    if (this.cur === null) {
      return this.fail('E03', `'${keyword}' before any part declaration`);
    }

    switch (keyword) {
      case 'size':
        return this.handleSize(args);
      case 'pivot':
        return this.handlePivot(args);
      case 'socket':
        return this.handleSocket(args);
      case 'layer':
        return this.handleLayer(args);
    }
    return this.fail('E04', `unknown keyword '${keyword}'`);
  }

  private handlePalette(args: readonly string[]): Result<void> {
    if (this.palette !== null) {
      return this.fail(
        'E15',
        `duplicate palette declaration (first at line ${this.paletteLineNo})`,
      );
    }
    const r = parsePalette(args);
    if (!r.ok) return this.fail(r.code, r.message);
    this.palette = r.value;
    this.paletteLineNo = this.lineNo;
    return ok(undefined);
  }

  private handlePart(args: readonly string[]): Result<void> {
    const closeR = this.closeCurrentPart();
    if (!closeR.ok) return closeR;
    const r = parsePartHeader(args);
    if (!r.ok) return this.fail(r.code, r.message);
    if (this.partNames.has(r.value)) {
      return this.fail('E12', `duplicate part name '${r.value}'`);
    }
    this.partNames.add(r.value);
    this.cur = new PartBuilder(r.value, this.lineNo);
    return ok(undefined);
  }

  private handleSize(args: readonly string[]): Result<void> {
    const cur = this.cur!;
    if (cur.size !== null) {
      return this.fail(
        'E17',
        `duplicate size for part '${cur.name}' (first at line ${cur.sizeLineNo})`,
      );
    }
    const r = parseSize(args);
    if (!r.ok) return this.fail(r.code, r.message);
    cur.size = r.value;
    cur.sizeLineNo = this.lineNo;
    return ok(undefined);
  }

  private handlePivot(args: readonly string[]): Result<void> {
    const cur = this.cur!;
    if (cur.pivot !== null) {
      return this.fail(
        'E17',
        `duplicate pivot for part '${cur.name}' (first at line ${cur.pivotLineNo})`,
      );
    }
    const r = parsePivot(args);
    if (!r.ok) return this.fail(r.code, r.message);
    cur.pivot = r.value;
    cur.pivotLineNo = this.lineNo;
    return ok(undefined);
  }

  private handleSocket(args: readonly string[]): Result<void> {
    const cur = this.cur!;
    const r = parseSocket(args);
    if (!r.ok) return this.fail(r.code, r.message);
    if (cur.socketNames.has(r.value.name)) {
      return this.fail(
        'E14',
        `duplicate socket '${r.value.name}' in part '${cur.name}'`,
      );
    }
    cur.socketNames.add(r.value.name);
    cur.sockets.push(r.value);
    return ok(undefined);
  }

  private handleLayer(args: readonly string[]): Result<void> {
    const cur = this.cur!;
    const flushR = this.flushActiveLayer();
    if (!flushR.ok) return flushR;

    const indexR = parseLayerHeader(args);
    if (!indexR.ok) return this.fail(indexR.code, indexR.message);
    const idx = indexR.value;

    cur.active = {
      index: idx,
      rows: args.slice(1).map((s) => s),
      indexLineNo: this.lineNo,
    };
    return ok(undefined);
  }

  private flushActiveLayer(): Result<void> {
    const cur = this.cur;
    if (cur === null || cur.active === null) return ok(undefined);
    const layer = cur.active;
    if (cur.layers.has(layer.index)) {
      const prev = cur.layers.get(layer.index)!;
      return err(
        'E09',
        `line ${layer.indexLineNo}: duplicate layer index ${layer.index} in part '${cur.name}' (first at line ${prev.indexLineNo})`,
      );
    }
    cur.layers.set(layer.index, layer);
    cur.active = null;
    return ok(undefined);
  }

  private closeCurrentPart(): Result<void> {
    if (this.cur === null) return ok(undefined);
    const flushR = this.flushActiveLayer();
    if (!flushR.ok) return flushR;
    this.parts.push(this.cur);
    this.cur = null;
    return ok(undefined);
  }

  private assemblePart(
    builder: PartBuilder,
    palette: Palette,
  ): Result<PartDefinition> {
    if (builder.size === null) {
      return err(
        'E13',
        `line ${builder.headerLineNo}: part '${builder.name}' missing size`,
      );
    }
    const size = builder.size;

    for (const [idx, layer] of builder.layers) {
      if (idx >= size.h) {
        return err(
          'E09',
          `line ${layer.indexLineNo}: layer index ${idx} out of range [0..${size.h - 1}] for part '${builder.name}'`,
        );
      }
    }
    for (let y = 0; y < size.h; y++) {
      if (!builder.layers.has(y)) {
        return err(
          'E09',
          `part '${builder.name}' missing layer index ${y} (has ${builder.layers.size} of ${size.h})`,
        );
      }
    }

    const pivot: Pivot = builder.pivot ?? {
      x: size.w / 2,
      y: 0,
      z: size.d / 2,
    };

    const voxels: number[][][] = [];
    for (let y = 0; y < size.h; y++) {
      const layer = builder.layers.get(y)!;
      if (layer.rows.length !== size.d) {
        return err(
          'E10',
          `line ${layer.indexLineNo}: layer ${y} in part '${builder.name}' has ${layer.rows.length} row(s), expected ${size.d}`,
        );
      }
      const layerCells: number[][] = [];
      for (const rowText of layer.rows) {
        const rowR = parseVoxelRow(rowText, size.w, palette.length);
        if (!rowR.ok) {
          return err(
            rowR.code,
            `part '${builder.name}' layer ${y}: ${rowR.message}`,
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

  private fail<T>(code: CuboidyErrorCode, message: string): Result<T> {
    return err(code, `line ${this.lineNo}: ${message}`);
  }
}

export function parseCvox(text: string): Result<VoxelDefinition> {
  return new CvoxAssembler().parse(text);
}
