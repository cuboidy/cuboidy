import { isIdentifier } from '../identifier.js';
import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import type { CvoxState } from './cvox-state.js';
import { parseNonNegInt } from './numbers.js';
import { PaletteParser } from './palette.js';
import { PivotParser } from './pivot.js';
import type { Pivot } from './pivot.js';
import { SocketParser } from './socket.js';
import type { Socket } from './socket.js';
import type { Token } from './tokenize.js';
import { VoxelsParser } from './voxels.js';
import type { RawVoxels } from './voxels.js';

export interface Size {
  w: number;
  h: number;
  d: number;
}

// PartState is the mutable accumulator for a part scope, holding part-level
// state (size, pivot, sockets, voxels) and the tracking sets used by
// sub-parsers for duplicate detection. It is finalized into a PartDefinition
// during assembly (CvoxState.assemble).
export class PartState {
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

// SPEC §7.6: parses a `size` declaration. Reads parent PartState to detect
// duplicate size declaration (at most one per part). Returns the parsed Size
// value; the caller is responsible for writing it back to PartState.
export class SizeParser {
  constructor(
    private readonly cursor: TokenCursor,
    private readonly partState: PartState,
  ) {}

  parse(kw: Token): Result<Size> {
    if (this.partState.size !== null) {
      return err(
        'duplicate',
        `line ${kw.line}: duplicate size for part '${this.partState.name}' (first at line ${this.partState.sizeLineNo})`,
      );
    }
    const args = this.cursor.pullArgs(3);
    const r = parseSize(args);
    if (!r.ok) return err(r.code, `line ${kw.line}: ${r.message}`);
    return r;
  }
}

// SPEC §7.5: parses a `part` declaration including its full body (all
// part-scoped metadata: size, pivot, socket*, voxels, in any order). Owns
// its own inner loop, dispatching each part-scoped reserved token to its
// sub-parser. Reads parent CvoxState for duplicate part-name detection at
// header time. Returns the populated PartState; the caller commits it.
export class PartParser {
  constructor(
    private readonly cursor: TokenCursor,
    private readonly cvoxState: CvoxState,
  ) {}

  parse(partKw: Token): Result<PartState> {
    // Header: read identifier
    const nameArgs = this.cursor.pullArgs(1);
    const nameR = parsePartHeader(nameArgs);
    if (!nameR.ok) return err(nameR.code, `line ${partKw.line}: ${nameR.message}`);
    const name = nameR.value;
    // Duplicate check at header time (preserves SPEC §11.8 forward-pass
    // precedence — duplicate name is reported before any body errors).
    if (this.cvoxState.partNames.has(name)) {
      return err(
        'duplicate',
        `line ${partKw.line}: duplicate part name '${name}'`,
      );
    }
    const partState = new PartState(name, partKw.line);

    // Inner loop: consume part-scoped declarations until the next 'part' or EOF.
    while (this.cursor.hasMore()) {
      const peek = this.cursor.peek()!;
      if (peek.text === 'part') break; // yield to CvoxParser for the next part
      const t = this.cursor.advance()!;
      switch (t.text) {
        case 'size': {
          const r = new SizeParser(this.cursor, partState).parse(t);
          if (!r.ok) return r;
          partState.size = r.value;
          partState.sizeLineNo = t.line;
          break;
        }
        case 'pivot': {
          const r = new PivotParser(this.cursor, partState).parse(t);
          if (!r.ok) return r;
          partState.pivot = r.value;
          partState.pivotLineNo = t.line;
          break;
        }
        case 'socket': {
          const r = new SocketParser(this.cursor, partState).parse(t);
          if (!r.ok) return r;
          partState.socketNames.add(r.value.name);
          partState.sockets.push(r.value);
          break;
        }
        case 'voxels': {
          const r = new VoxelsParser(this.cursor, partState).parse(t);
          if (!r.ok) return r;
          partState.voxels = r.value;
          break;
        }
        // File-level escape: palette may appear textually inside a part
        // without closing it (SPEC §7.2 palette mid-part rule).
        case 'palette': {
          const r = new PaletteParser(this.cursor, this.cvoxState).parse(t);
          if (!r.ok) return r;
          this.cvoxState.palette = r.value;
          this.cvoxState.paletteLineNo = t.line;
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

    return ok(partState);
  }
}
