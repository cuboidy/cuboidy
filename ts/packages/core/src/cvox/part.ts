import { isIdentifier } from '../identifier.js';
import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import { FileState, PartBuilder } from './file-state.js';
import { parseNonNegInt } from './numbers.js';
import { PaletteParser } from './palette.js';
import { PivotParser } from './pivot.js';
import { SocketParser } from './socket.js';
import type { Token } from './tokenize.js';
import { VoxelsParser } from './voxels.js';

export interface Size {
  w: number;
  h: number;
  d: number;
}

const SIZE_MIN = 1;
const SIZE_MAX = 1024;

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

export function parseSize(args: readonly string[]): Result<Size> {
  if (args.length !== 3) {
    return err(
      'wrong-arity',
      `size expects 3 args (W H D), got ${args.length}`,
    );
  }
  const parsed: number[] = [];
  for (const arg of args) {
    const n = parseNonNegInt(arg);
    if (n === null) {
      return err(
        'invalid-value',
        `size dimension '${arg}' is not a non-negative integer`,
      );
    }
    if (n < SIZE_MIN || n > SIZE_MAX) {
      return err(
        'invalid-value',
        `size dimension ${n} is out of range [${SIZE_MIN}..${SIZE_MAX}]`,
      );
    }
    parsed.push(n);
  }
  return ok({ w: parsed[0]!, h: parsed[1]!, d: parsed[2]! });
}

// SPEC §7.6: parses a `size` declaration and writes to the active
// PartBuilder. Pulls 3 args (W H D) per §7.2.
export class SizeParser {
  constructor(
    private readonly cursor: TokenCursor,
    private readonly builder: PartBuilder,
  ) {}

  parse(kw: Token): Result<void> {
    if (this.builder.size !== null) {
      return err(
        'duplicate',
        `line ${kw.line}: duplicate size for part '${this.builder.name}' (first at line ${this.builder.sizeLineNo})`,
      );
    }
    const args = this.cursor.pullArgs(3);
    const r = parseSize(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    this.builder.size = r.value;
    this.builder.sizeLineNo = kw.line;
    return ok(undefined);
  }
}

// SPEC §7.5: parses a `part` declaration including its full body (all
// part-scoped metadata: size, pivot, socket*, voxels, in any order). Owns
// its own inner loop, dispatching each part-scoped reserved token to its
// sub-parser. Yields control back to FileParser when the next `part` token
// is peeked or EOF is reached.
export class PartParser {
  constructor(
    private readonly cursor: TokenCursor,
    private readonly fileState: FileState,
  ) {}

  parse(partKw: Token): Result<void> {
    // Header: read identifier
    const nameArgs = this.cursor.pullArgs(1);
    const nameR = parsePartHeader(nameArgs);
    if (!nameR.ok) return err(nameR.code, `line ${partKw.line}: ${nameR.message}`);
    const name = nameR.value;
    if (this.fileState.partNames.has(name)) {
      return err(
        'duplicate',
        `line ${partKw.line}: duplicate part name '${name}'`,
      );
    }
    this.fileState.partNames.add(name);
    const builder = new PartBuilder(name, partKw.line);

    // Inner loop: consume part-scoped declarations until the next 'part' or EOF.
    while (this.cursor.hasMore()) {
      const peek = this.cursor.peek()!;
      if (peek.text === 'part') break; // yield to FileParser for the next part
      const t = this.cursor.advance()!;
      let r: Result<void>;
      switch (t.text) {
        case 'size':    r = new SizeParser(this.cursor, builder).parse(t); break;
        case 'pivot':   r = new PivotParser(this.cursor, builder).parse(t); break;
        case 'socket':  r = new SocketParser(this.cursor, builder).parse(t); break;
        case 'voxels':  r = new VoxelsParser(this.cursor, builder).parse(t); break;
        // file-level escape: palette may appear textually inside a part
        // without closing it (SPEC §7.2 palette mid-part rule)
        case 'palette': r = new PaletteParser(this.cursor, this.fileState).parse(t); break;
        // stray reserved tokens at part scope (invalid here, structurally
        // their valid scope is missing per SPEC §7.3.3)
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
      if (!r.ok) return r;
    }

    this.fileState.commitPart(builder);
    return ok(undefined);
  }
}
