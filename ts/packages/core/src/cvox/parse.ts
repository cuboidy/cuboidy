import { err, ok, type Result } from '../result.js';
import { type Palette, parsePalette } from './palette.js';
import { parsePartHeader, parseSize, type Size } from './part.js';
import { parsePivot, type Pivot } from './pivot.js';
import { parseSocket, type Socket } from './socket.js';
import { parseVoxelRow } from './voxel-row.js';
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

// SPEC §7.3: the full flat reserved-word set. Structural validity (where
// each may appear) is enforced by the parser, not by the lexical category.
// `rot` is a reserved word with structural validity constrained to pivot
// and socket declarations.
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'palette',
  'part',
  'size',
  'pivot',
  'socket',
  'voxels',
  'rot',
]);

interface RawRow {
  text: string;
  line: number;
  col: number;
}

interface RawSection {
  rows: RawRow[];
  startLine: number;
}

interface RawVoxels {
  sections: RawSection[];
  voxelsLine: number;
}

class PartBuilder {
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
      this.pos++;
      switch (t.text) {
        case 'palette': {
          const r = this.consumePalette(t);
          if (!r.ok) return r;
          break;
        }
        case 'part': {
          const r = this.consumePart(t);
          if (!r.ok) return r;
          break;
        }
        case 'size': {
          const r = this.consumeSize(t);
          if (!r.ok) return r;
          break;
        }
        case 'pivot': {
          const r = this.consumePivot(t);
          if (!r.ok) return r;
          break;
        }
        case 'socket': {
          const r = this.consumeSocket(t);
          if (!r.ok) return r;
          break;
        }
        case 'voxels': {
          const r = this.consumeVoxels(t);
          if (!r.ok) return r;
          break;
        }
        case 'rot':
          return err(
            'missing',
            `line ${t.line}: 'rot' is only valid inside a pivot or socket declaration`,
          );
        case '{':
        case '}':
        case ',':
          return err(
            'unknown',
            `line ${t.line}: unexpected '${t.text}' at top level`,
          );
        default:
          return err(
            'unknown',
            `line ${t.line}: unknown token '${t.text}'`,
          );
      }
    }

    // EOF
    this.closeCurrentPart();

    if (this.palette === null) {
      return err('missing', 'missing palette declaration');
    }
    if (this.parts.length === 0) {
      return err('missing', 'file contains palette but no parts');
    }

    const finalParts: PartDefinition[] = [];
    for (const builder of this.parts) {
      const a = this.assemblePart(builder, this.palette);
      if (!a.ok) return a;
      finalParts.push(a.value);
    }
    return ok({ palette: this.palette, parts: finalParts });
  }

  // Pull up to `max` tokens, stopping at the next reserved word or
  // universal punctuation ({ } ,) or end of stream.
  private pullArgs(max: number): string[] {
    const args: string[] = [];
    while (args.length < max && this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!;
      if (RESERVED_WORDS.has(t.text)) break;
      if (t.text === '{' || t.text === '}' || t.text === ',') break;
      args.push(t.text);
      this.pos++;
    }
    return args;
  }

  private consumePalette(kw: Token): Result<void> {
    const args = this.pullArgs(Number.POSITIVE_INFINITY);
    if (this.palette !== null) {
      return err(
        'duplicate',
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
      return err('duplicate', `line ${kw.line}: duplicate part name '${r.value}'`);
    }
    this.closeCurrentPart();
    this.partNames.add(r.value);
    this.cur = new PartBuilder(r.value, kw.line);
    return ok(undefined);
  }

  private consumeSize(kw: Token): Result<void> {
    if (this.cur === null) {
      return err('missing', `line ${kw.line}: 'size' before any part declaration`);
    }
    if (this.cur.size !== null) {
      return err(
        'duplicate',
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
      return err('missing', `line ${kw.line}: 'pivot' before any part declaration`);
    }
    if (this.cur.pivot !== null) {
      return err(
        'duplicate',
        `line ${kw.line}: duplicate pivot for part '${this.cur.name}' (first at line ${this.cur.pivotLineNo})`,
      );
    }
    // SPEC §7.7: pivot has 3 args (pos only) or 7 args (pos + rot + 3
    // rot values). Pull 3 first, then peek for the `rot` keyword.
    const args = this.pullArgs(3);
    if (
      this.pos < this.tokens.length &&
      this.tokens[this.pos]!.text === 'rot'
    ) {
      args.push(this.tokens[this.pos]!.text);
      this.pos++;
      args.push(...this.pullArgs(3));
    }
    const r = parsePivot(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    this.cur.pivot = r.value;
    this.cur.pivotLineNo = kw.line;
    return ok(undefined);
  }

  private consumeSocket(kw: Token): Result<void> {
    if (this.cur === null) {
      return err('missing', `line ${kw.line}: 'socket' before any part declaration`);
    }
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
        'duplicate',
        `line ${kw.line}: duplicate socket '${r.value.name}' in part '${this.cur.name}'`,
      );
    }
    this.cur.socketNames.add(r.value.name);
    this.cur.sockets.push(r.value);
    return ok(undefined);
  }

  private consumeVoxels(kw: Token): Result<void> {
    if (this.cur === null) {
      return err('missing', `line ${kw.line}: 'voxels' before any part declaration`);
    }
    if (this.cur.voxels !== null) {
      return err(
        'duplicate',
        `line ${kw.line}: duplicate voxels block for part '${this.cur.name}' (first at line ${this.cur.voxels.voxelsLine})`,
      );
    }
    // Expect opening `{`
    if (this.pos >= this.tokens.length) {
      return err(
        'wrong-arity',
        `line ${kw.line}: 'voxels' must be followed by '{' (got end of file)`,
      );
    }
    const open = this.tokens[this.pos]!;
    if (open.text !== '{') {
      return err(
        'wrong-arity',
        `line ${open.line}: 'voxels' must be followed by '{' (got '${open.text}')`,
      );
    }
    this.pos++;

    // SPEC §7.1 Layer 2: inside voxels {} no reserved words are recognized.
    // Every token except `,` and `}` is a voxel-row candidate. `{` inside
    // is unexpected (no nesting).
    const sections: RawSection[] = [];
    let current: RawSection = { rows: [], startLine: kw.line };
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!;
      if (t.text === '}') {
        this.pos++;
        sections.push(current);
        this.cur.voxels = { sections, voxelsLine: kw.line };
        return ok(undefined);
      }
      if (t.text === ',') {
        sections.push(current);
        this.pos++;
        current = { rows: [], startLine: t.line };
        continue;
      }
      if (t.text === '{') {
        return err(
          'invalid-value',
          `line ${t.line}: unexpected '{' inside voxels block`,
        );
      }
      current.rows.push({ text: t.text, line: t.line, col: t.col });
      this.pos++;
    }
    return err(
      'missing',
      `line ${kw.line}: unclosed voxels block (missing '}')`,
    );
  }

  private closeCurrentPart(): void {
    if (this.cur === null) return;
    this.parts.push(this.cur);
    this.cur = null;
  }

  private assemblePart(
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
}

export function parseCvox(text: string): Result<VoxelDefinition> {
  return new CvoxParser(tokenize(text)).parse();
}
