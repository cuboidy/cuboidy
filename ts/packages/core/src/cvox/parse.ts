import { err, ok, type Result } from '../result.js';
import { KNOWN_KEYWORDS, VOXEL_ROW_RE } from './classify.js';
import { type Palette, parsePalette } from './palette.js';
import { parsePartHeader, parseSize, type Size } from './part.js';
import { parsePivot, type Pivot } from './pivot.js';
import { parseSocket, type Socket } from './socket.js';
import { parseLayerHeader, parseVoxelRow } from './layer.js';
import { tokenize, type Token } from './tokenize.js';

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

class CvoxParser {
  private readonly tokens: Token[];
  private pos = 0;
  private palette: Palette | null = null;
  private paletteLineNo = 0;
  private parts: PartBuilder[] = [];
  private partNames = new Set<string>();
  private cur: PartBuilder | null = null;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Result<VoxelDefinition> {
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!;

      if (KNOWN_KEYWORDS.has(t.text)) {
        // SPEC §7.9: any known keyword closes the active layer (row stream
        // ends). palette also closes the active layer but does NOT close
        // the surrounding part section (§7.5).
        const flushR = this.flushActiveLayer();
        if (!flushR.ok) return flushR;

        this.pos++;
        const r = this.dispatchKeyword(t);
        if (!r.ok) return r;
        continue;
      }

      // Not a keyword: either voxel-row continuation or an error.
      if (VOXEL_ROW_RE.test(t.text)) {
        if (this.cur?.active) {
          this.cur.active.rows.push(t.text);
          this.pos++;
          continue;
        }
        return err('E10', `line ${t.line}: voxel row outside any layer`);
      }

      return err('E04', `line ${t.line}: unknown token '${t.text}'`);
    }

    // EOF
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

  // Pull up to `max` tokens (stops at next known keyword OR end of stream)
  private pullArgs(max: number): string[] {
    const args: string[] = [];
    while (args.length < max && this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!;
      if (KNOWN_KEYWORDS.has(t.text)) break;
      args.push(t.text);
      this.pos++;
    }
    return args;
  }

  private dispatchKeyword(kw: Token): Result<void> {
    switch (kw.text) {
      case 'palette':
        return this.consumePalette(kw);
      case 'part':
        return this.consumePart(kw);
      case 'size':
        return this.consumeSize(kw);
      case 'pivot':
        return this.consumePivot(kw);
      case 'socket':
        return this.consumeSocket(kw);
      case 'layer':
        return this.consumeLayer(kw);
    }
    return ok(undefined);
  }

  private consumePalette(kw: Token): Result<void> {
    // Palette args run until the next known keyword.
    const args = this.pullArgs(Number.POSITIVE_INFINITY);
    if (this.palette !== null) {
      return err(
        'E15',
        `line ${kw.line}: duplicate palette declaration (first at line ${this.paletteLineNo})`,
      );
    }
    const r = parsePalette(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    this.palette = r.value;
    this.paletteLineNo = kw.line;
    return ok(undefined);
  }

  private consumePart(kw: Token): Result<void> {
    const args = this.pullArgs(1);
    const r = parsePartHeader(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    if (this.partNames.has(r.value)) {
      return err('E12', `line ${kw.line}: duplicate part name '${r.value}'`);
    }
    const closeR = this.closeCurrentPart();
    if (!closeR.ok) return closeR;
    this.partNames.add(r.value);
    this.cur = new PartBuilder(r.value, kw.line);
    return ok(undefined);
  }

  private consumeSize(kw: Token): Result<void> {
    if (this.cur === null) {
      return err('E03', `line ${kw.line}: 'size' before any part declaration`);
    }
    if (this.cur.size !== null) {
      return err(
        'E17',
        `line ${kw.line}: duplicate size for part '${this.cur.name}' (first at line ${this.cur.sizeLineNo})`,
      );
    }
    const args = this.pullArgs(3);
    const r = parseSize(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    this.cur.size = r.value;
    this.cur.sizeLineNo = kw.line;
    return ok(undefined);
  }

  private consumePivot(kw: Token): Result<void> {
    if (this.cur === null) {
      return err('E03', `line ${kw.line}: 'pivot' before any part declaration`);
    }
    if (this.cur.pivot !== null) {
      return err(
        'E17',
        `line ${kw.line}: duplicate pivot for part '${this.cur.name}' (first at line ${this.cur.pivotLineNo})`,
      );
    }
    const args = this.pullArgs(3);
    const r = parsePivot(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    this.cur.pivot = r.value;
    this.cur.pivotLineNo = kw.line;
    return ok(undefined);
  }

  private consumeSocket(kw: Token): Result<void> {
    if (this.cur === null) {
      return err('E03', `line ${kw.line}: 'socket' before any part declaration`);
    }
    // Socket has 4 args (name x y z) or 8 args (name x y z rot rx ry rz).
    // Pull 4 first, then peek for the `rot` sub-keyword before pulling more.
    // This prevents stealing voxel-row tokens that follow a no-rot socket.
    const args = this.pullArgs(4);
    if (
      this.pos < this.tokens.length &&
      this.tokens[this.pos]!.text === 'rot'
    ) {
      args.push(this.tokens[this.pos]!.text);
      this.pos++;
      args.push(...this.pullArgs(3));
    }
    const r = parseSocket(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    if (this.cur.socketNames.has(r.value.name)) {
      return err(
        'E14',
        `line ${kw.line}: duplicate socket '${r.value.name}' in part '${this.cur.name}'`,
      );
    }
    this.cur.socketNames.add(r.value.name);
    this.cur.sockets.push(r.value);
    return ok(undefined);
  }

  private consumeLayer(kw: Token): Result<void> {
    if (this.cur === null) {
      return err('E03', `line ${kw.line}: 'layer' before any part declaration`);
    }
    const args = this.pullArgs(1);
    const indexR = parseLayerHeader(args);
    if (!indexR.ok) return err(indexR.code, `line ${kw.line}: ${indexR.message}`);
    // Rows are collected by the main loop as voxel-row continuation tokens.
    this.cur.active = {
      index: indexR.value,
      rows: [],
      indexLineNo: kw.line,
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
}

export function parseCvox(text: string): Result<VoxelDefinition> {
  return new CvoxParser(tokenize(text)).parse();
}
