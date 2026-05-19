import { isIdentifier } from '../identifier.js';
import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import type { CvoxParser, Part } from './parse.js';
import { PaletteParser, type Palette } from './palette.js';
import { PivotParser, type Pivot } from './pivot.js';
import { SizeParser, type Size } from './size.js';
import { SocketParser, type Socket } from './socket.js';
import type { Token } from './tokenize.js';
import { parseVoxelRow } from './voxel-row.js';
import { VoxelsParser, type RawVoxels } from './voxels.js';

// Internal intermediate type — PartParser's return value. Carries the part's
// parsed but not-yet-assembled state (voxels are raw text rows, palette
// indices not yet resolved). CvoxParser.assemble() converts this into the
// public Part type using the resolved palette.
export interface ParsedPart {
  name: string;
  headerLineNo: number;
  size: Size;
  pivot: Pivot | null;
  pivotLineNo: number;
  sockets: readonly Socket[];
  voxels: RawVoxels;
}

export function parsePartHeader(args: readonly string[]): Result<string> {
  if (args.length !== 1) {
    return err(
      'wrong-arity',
      `part header expects exactly 1 identifier, got ${args.length}`,
    );
  }
  const name = args[0]!;
  if (!isIdentifier(name)) {
    return err('invalid-value', `invalid part identifier '${name}'`);
  }
  return ok(name);
}

// Resolves a ParsedPart into the final immutable Part using the file's
// palette (which may have been declared after this part textually). Validates
// size.h × size.d × size.w against the collected voxel rows and converts
// palette-index characters into integer indices.
export function assemblePart(
  part: ParsedPart,
  palette: Palette,
): Result<Part> {
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

// SPEC §7.5: parses a `part` declaration including its full body. Owns its
// own inner loop dispatching to sub-parsers. Holds part-scope state in
// private fields. All duplicate checks for part-scoped declarations
// (size/pivot/socket/voxels) are done inline in the switch case before
// the sub-parser is invoked, so sub-parsers stay pure (no PartParser
// reference). Reads parent CvoxParser to detect duplicate part name at
// header time (preserves SPEC §11.8 forward-pass precedence).
export class PartParser {
  private size: Size | null = null;
  private sizeLineNo = 0;
  private pivot: Pivot | null = null;
  private pivotLineNo = 0;
  private sockets: Socket[] = [];
  private socketNames = new Set<string>();
  private voxels: RawVoxels | null = null;
  private voxelsLineNo = 0;

  constructor(
    private readonly cursor: TokenCursor,
    private readonly cvoxParser: CvoxParser,
  ) {}

  parse(partKw: Token): Result<ParsedPart> {
    // Header: read identifier
    const nameArgs = this.cursor.pullArgs(1);
    const nameR = parsePartHeader(nameArgs);
    if (!nameR.ok) return err(nameR.code, `line ${partKw.line}: ${nameR.message}`);
    const name = nameR.value;
    // Early duplicate check via parent CvoxParser (SPEC §11.8: header-time
    // detection, before body is parsed).
    if (this.cvoxParser.hasPartName(name)) {
      return err(
        'duplicate',
        `line ${partKw.line}: duplicate part name '${name}'`,
      );
    }

    // Inner loop: consume part-scoped declarations until the next 'part' or EOF.
    while (this.cursor.hasMore()) {
      const peek = this.cursor.peek()!;
      if (peek.text === 'part') break; // yield to CvoxParser for the next part
      const t = this.cursor.advance()!;
      switch (t.text) {
        case 'size': {
          if (this.size !== null) {
            return err(
              'duplicate',
              `line ${t.line}: duplicate size for part '${name}' (first at line ${this.sizeLineNo})`,
            );
          }
          const r = new SizeParser(this.cursor).parse(t);
          if (!r.ok) return r;
          this.size = r.value;
          this.sizeLineNo = t.line;
          break;
        }
        case 'pivot': {
          if (this.pivot !== null) {
            return err(
              'duplicate',
              `line ${t.line}: duplicate pivot for part '${name}' (first at line ${this.pivotLineNo})`,
            );
          }
          const r = new PivotParser(this.cursor).parse(t);
          if (!r.ok) return r;
          this.pivot = r.value;
          this.pivotLineNo = t.line;
          break;
        }
        case 'socket': {
          const r = new SocketParser(this.cursor).parse(t);
          if (!r.ok) return r;
          // Dup check after parse — name isn't known until parsed.
          if (this.socketNames.has(r.value.name)) {
            return err(
              'duplicate',
              `line ${t.line}: duplicate socket '${r.value.name}' in part '${name}'`,
            );
          }
          this.socketNames.add(r.value.name);
          this.sockets.push(r.value);
          break;
        }
        case 'voxels': {
          if (this.voxels !== null) {
            return err(
              'duplicate',
              `line ${t.line}: duplicate voxels block for part '${name}' (first at line ${this.voxelsLineNo})`,
            );
          }
          const r = new VoxelsParser(this.cursor).parse(t);
          if (!r.ok) return r;
          this.voxels = r.value;
          this.voxelsLineNo = t.line;
          break;
        }
        // File-level escape: palette may appear textually inside a part
        // without closing it (SPEC §7.2 palette mid-part rule).
        case 'palette': {
          const r = new PaletteParser(this.cursor, this.cvoxParser).parse(t);
          if (!r.ok) return r;
          this.cvoxParser.setPalette(r.value, t.line);
          break;
        }
        // Stray reserved tokens at part scope — their structurally valid
        // enclosing scope is missing per SPEC §7.3.3.
        case 'rot':
          return err(
            'missing',
            `line ${t.line}: 'rot' is only valid inside a pivot or socket declaration (after the position triple)`,
          );
        case '{':
          return err(
            'missing',
            `line ${t.line}: unexpected '{' (only valid immediately after a 'voxels' keyword)`,
          );
        case '}':
          return err(
            'missing',
            `line ${t.line}: unexpected '}' (no open voxels block to close)`,
          );
        case ',':
          return err(
            'missing',
            `line ${t.line}: unexpected ',' (only valid inside a voxels block as a layer-section separator)`,
          );
        default:
          return err('unknown', `line ${t.line}: unknown token '${t.text}'`);
      }
    }

    // Finalize: validate required fields and emit ParsedPart.
    if (this.size === null) {
      return err(
        'missing',
        `line ${partKw.line}: part '${name}' missing size`,
      );
    }
    if (this.voxels === null) {
      return err(
        'missing',
        `line ${partKw.line}: part '${name}' missing voxels block`,
      );
    }
    return ok({
      name,
      headerLineNo: partKw.line,
      size: this.size,
      pivot: this.pivot,
      pivotLineNo: this.pivotLineNo,
      sockets: this.sockets,
      voxels: this.voxels,
    });
  }
}
