import { err, ok, type Result } from '../result.js';
import type { TokenCursor } from './cursor.js';
import { expectIdentifier } from './expect.js';
import type { CvoxParser } from './parse.js';
import { PaletteParser } from './palette.js';
import { PivotParser } from './pivot.js';
import { SizeParser } from './size.js';
import { SocketParser } from './socket.js';
import type { Token } from './tokenize.js';
import type { Palette, Part, PartRef, Pivot, Size, Socket, Vec3 } from './types.js';
import { resolveVoxels, VoxelsParser, type RawVoxels } from './voxels.js';

// Internal intermediate type — PartParser's return value. Carries the part's
// parsed but not-yet-assembled state (voxels are raw text rows, palette
// indices not yet resolved). CvoxParser.assemble() converts this into the
// public Part type using the resolved palette.
//
// A reuse part (SPEC §7.5.1: `clone`/`mirror`) carries `from` and leaves
// size/voxels null — its geometry is derived from the referent at assembly.
export interface ParsedPart {
  name: string;
  from?: PartRef;
  size: Size | null;
  pivot: Pivot | null;
  sockets: readonly Socket[];
  voxels: RawVoxels | null;
}

// Resolves a ParsedPart into the final immutable Part using the file's
// palette (which may have been declared after this part textually). Thin
// orchestrator: delegates voxel structural validation + decode to
// resolveVoxels, then computes the default pivot if one wasn't declared,
// and assembles the public Part shape.
export function assemblePart(
  part: ParsedPart,
  palette: Palette,
): Result<Part> {
  // Reuse parts (from set) are resolved separately by reusePart(); a concrete
  // part always has size + voxels (the finalize step below enforces it). This
  // guard is defensive and narrows the nullable fields.
  if (part.size === null || part.voxels === null) {
    return err('missing', `part "${part.name}" missing size or voxels`);
  }
  const voxelsR = resolveVoxels(part.voxels, part.size, palette, part.name);
  if (!voxelsR.ok) return voxelsR;
  const pivot: Pivot = part.pivot ?? {
    pos: { x: part.size.w / 2, y: 0, z: part.size.d / 2 },
  };
  return ok({
    name: part.name,
    size: part.size,
    pivot,
    sockets: part.sockets,
    voxels: voxelsR.value,
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

  // Accessor used by SocketParser for early duplicate detection (the dup
  // condition depends on the socket name, which is mid-parse — see
  // socket.ts). Other sub-parsers do their duplicate check inline in the
  // PartParser switch case and don't need accessors.
  hasSocketName(name: string): boolean { return this.socketNames.has(name); }

  parse(partKw: Token): Result<ParsedPart> {
    // Header: pull the part name (bare identifier per SPEC §7.5). The
    // §5 identifier rule (strengthened to reject reserved keywords) is
    // what handles disambiguation — `part part` errors as "invalid
    // identifier 'part'", not parses as a part named `part`.
    const nameR = expectIdentifier(this.cursor, partKw, 'part name');
    if (!nameR.ok) return nameR;
    const { value: name, token: nameTok } = nameR.value;
    // Early duplicate check via parent CvoxParser (SPEC §11.8: header-time
    // detection, before body is parsed).
    if (this.cvoxParser.hasPartName(name)) {
      return err(
        'duplicate',
        `line ${nameTok.line}: duplicate part name "${name}"`,
      );
    }

    // SPEC §7.5.1: an optional reuse-clause immediately after the name —
    // `clone <ref>` (verbatim) or `mirror <ref> [x|y|z]` (reflected). A
    // reuse part has no body; its geometry is derived from the referent at
    // assembly. Anything other than clone/mirror falls through to the normal
    // body loop below.
    const peek0 = this.cursor.peek();
    if (
      peek0 !== null &&
      peek0.kind === 'bare' &&
      (peek0.text === 'clone' || peek0.text === 'mirror')
    ) {
      return this.parseReuse(name, this.cursor.advance()!);
    }

    // Inner loop: consume part-scoped declarations until the next bare
    // `part` keyword or EOF. A string-kind token with text='part' (i.e.
    // `"part"`) is NOT a statement starter — it falls through to the
    // default case which surfaces the misplaced quoted string.
    while (this.cursor.hasMore()) {
      const peek = this.cursor.peek()!;
      if (peek.kind === 'bare' && peek.text === 'part') break;
      const t = this.cursor.advance()!;
      if (t.kind !== 'bare') {
        return err(
          'unknown',
          `line ${t.line}: unexpected quoted string "${t.text}" at part scope (no statement starts with a string)`,
        );
      }
      switch (t.text) {
        case 'size': {
          if (this.size !== null) {
            return err(
              'duplicate',
              `line ${t.line}: duplicate size for part "${name}" (first at line ${this.sizeLineNo})`,
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
              `line ${t.line}: duplicate pivot for part "${name}" (first at line ${this.pivotLineNo})`,
            );
          }
          const r = new PivotParser(this.cursor).parse(t);
          if (!r.ok) return r;
          this.pivot = r.value;
          this.pivotLineNo = t.line;
          break;
        }
        case 'socket': {
          // SocketParser does the early duplicate check itself via this
          // PartParser's hasSocketName() accessor (the dup condition
          // depends on the socket name, which is mid-parse).
          const r = new SocketParser(this.cursor, this).parse(t);
          if (!r.ok) return r;
          this.socketNames.add(r.value.name);
          this.sockets.push(r.value);
          break;
        }
        case 'voxels': {
          if (this.voxels !== null) {
            return err(
              'duplicate',
              `line ${t.line}: duplicate voxels block for part "${name}" (first at line ${this.voxelsLineNo})`,
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
        // SPEC §7.5.1: a reuse-clause is only valid in the header, right
        // after the part name — never mixed into a body.
        case 'clone':
        case 'mirror':
          return err(
            'invalid-value',
            `line ${t.line}: '${t.text}' must immediately follow the part name (reuse-clause), not appear in the part body`,
          );
        default:
          return err('unknown', `line ${t.line}: unknown token '${t.text}'`);
      }
    }

    // Finalize: validate required fields and emit ParsedPart.
    if (this.size === null) {
      return err(
        'missing',
        `line ${partKw.line}: part "${name}" missing size`,
      );
    }
    if (this.voxels === null) {
      return err(
        'missing',
        `line ${partKw.line}: part "${name}" missing voxels block`,
      );
    }
    return ok({
      name,
      size: this.size,
      pivot: this.pivot,
      sockets: this.sockets,
      voxels: this.voxels,
    });
  }

  // SPEC §7.5.1: parse the reuse-clause body. `kw` is the already-consumed
  // `clone`/`mirror` token; pulls the referent identifier and (for `mirror`)
  // an optional axis (x|y|z, default x), then asserts no body follows.
  private parseReuse(name: string, kw: Token): Result<ParsedPart> {
    const refR = expectIdentifier(this.cursor, kw, `${kw.text} referent`);
    if (!refR.ok) return refR;
    const refName = refR.value.value;
    if (refName === name) {
      return err(
        'invalid-value',
        `line ${kw.line}: part "${name}" cannot ${kw.text} itself`,
      );
    }
    let from: PartRef;
    if (kw.text === 'mirror') {
      let axis: 'x' | 'y' | 'z' = 'x';
      const ax = this.cursor.peek();
      if (
        ax !== null &&
        ax.kind === 'bare' &&
        (ax.text === 'x' || ax.text === 'y' || ax.text === 'z')
      ) {
        this.cursor.advance();
        axis = ax.text as 'x' | 'y' | 'z';
      }
      from = { part: refName, mirror: axis };
    } else {
      from = { part: refName };
    }
    // A reuse part has no body: the next token must start the next part
    // (bare `part`) or be EOF.
    const after = this.cursor.peek();
    if (after !== null && !(after.kind === 'bare' && after.text === 'part')) {
      const got =
        after.kind === 'string' ? `"${after.text}"` : `'${after.text}'`;
      return err(
        'invalid-value',
        `line ${after.line}: part "${name}" uses ${kw.text} and must not declare a body (got ${got})`,
      );
    }
    return ok({ name, from, size: null, pivot: null, sockets: [], voxels: null });
  }
}

// SPEC §7.5.1: resolve a reuse part into a concrete Part by cloning (and
// optionally reflecting) an already-assembled referent. Pure; the caller
// (CvoxParser.assemble) guarantees `ref` is a concrete (non-reuse) part.
export function reusePart(name: string, from: PartRef, ref: Part): Part {
  if (from.mirror === undefined) {
    return {
      name,
      from,
      size: ref.size,
      pivot: ref.pivot,
      sockets: ref.sockets,
      voxels: ref.voxels,
    };
  }
  const axis = from.mirror;
  return {
    name,
    from,
    size: ref.size,
    pivot: mirrorPivot(ref.pivot, ref.size, axis),
    sockets: ref.sockets.map((s) => mirrorSocket(s, ref.size, axis)),
    voxels: mirrorVoxels(ref.voxels, ref.size, axis),
  };
}

type Axis = 'x' | 'y' | 'z';

// Reflect a position (continuous, range [0, dim]) across the axis midplane:
// the chosen-axis component becomes dim - value; the others are unchanged.
function mirrorPos(v: Vec3, size: Size, axis: Axis): Vec3 {
  return {
    x: axis === 'x' ? size.w - v.x : v.x,
    y: axis === 'y' ? size.h - v.y : v.y,
    z: axis === 'z' ? size.d - v.z : v.z,
  };
}

// Reflect an Euler rotation: a mirror flips handedness, so the two angle
// components NOT around the mirror axis are negated (the around-axis one is
// kept). Matches the standard rig-mirror convention (e.g. Blender X-mirror).
function mirrorRot(rot: Vec3, axis: Axis): Vec3 {
  return {
    x: axis === 'x' ? rot.x : -rot.x,
    y: axis === 'y' ? rot.y : -rot.y,
    z: axis === 'z' ? rot.z : -rot.z,
  };
}

function mirrorPivot(p: Pivot, size: Size, axis: Axis): Pivot {
  const pos = mirrorPos(p.pos, size, axis);
  return p.rot !== undefined ? { pos, rot: mirrorRot(p.rot, axis) } : { pos };
}

function mirrorSocket(s: Socket, size: Size, axis: Axis): Socket {
  const pos = mirrorPos(s.pos, size, axis);
  return s.rot !== undefined
    ? { name: s.name, pos, rot: mirrorRot(s.rot, axis) }
    : { name: s.name, pos };
}

// Reflect the voxel grid (indexed voxels[y][z][x]) across the chosen axis.
function mirrorVoxels(
  voxels: Part['voxels'],
  size: Size,
  axis: Axis,
): number[][][] {
  const out: number[][][] = [];
  for (let y = 0; y < size.h; y++) {
    const sy = axis === 'y' ? size.h - 1 - y : y;
    const layer: number[][] = [];
    for (let z = 0; z < size.d; z++) {
      const sz = axis === 'z' ? size.d - 1 - z : z;
      const srcRow = voxels[sy]![sz]!;
      const row: number[] = [];
      for (let x = 0; x < size.w; x++) {
        const sx = axis === 'x' ? size.w - 1 - x : x;
        row.push(srcRow[sx]!);
      }
      layer.push(row);
    }
    out.push(layer);
  }
  return out;
}
