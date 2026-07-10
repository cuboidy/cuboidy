import { err, ok, type Result } from '../result.js';
import { TokenCursor } from './cursor.js';
import { extractHeader } from './header.js';
import { PaletteParser } from './palette.js';
import { assemblePart, PartParser, reusePart, type ParsedPart } from './part.js';
import { tokenize } from './tokenize.js';
import type { Cvox, Palette, Part, PendingReuse } from './types.js';

export interface ParseCvoxOptions {
  // SPEC §6.9: clone/mirror referents resolve model-wide. When true, a
  // reuse reference whose referent is not defined in THIS file is not a
  // parse error — it is recorded in `Cvox.pending` for the project layer
  // (resolveCrossFileReuse) to resolve against all geometry files.
  // Default false: an unresolved referent errors (single-file behavior).
  deferUnresolvedReuse?: boolean;
}

// SPEC §7.2: top-level parser. Holds file-scope state in private fields
// (palette, parts, partNames) and dispatches each file-scope token to its
// production parser (PaletteParser, PartParser). Sub-parsers receive this
// CvoxParser instance and read state via the read-only accessor methods
// (hasPalette, hasPartName) for early duplicate detection. State mutation
// is done by this parser itself in the dispatch loop.
//
// At EOF, assemble() validates structural completeness and resolves each
// ParsedPart into the final Part by applying the palette to its raw voxel
// data.
export class CvoxParser {
  private palette: Palette | null = null;
  private paletteLineNo = 0;
  private parts: ParsedPart[] = [];
  private partNames = new Set<string>();

  constructor(
    private readonly cursor: TokenCursor,
    private readonly options: ParseCvoxOptions = {},
  ) {}

  // Read-only accessors for sub-parsers.
  hasPalette(): boolean { return this.palette !== null; }
  getPaletteLineNo(): number { return this.paletteLineNo; }
  hasPartName(name: string): boolean { return this.partNames.has(name); }

  // Called by PartParser when it processes a mid-part `palette` declaration
  // (the file-level escape per SPEC §7.5). PartParser cannot directly
  // mutate the CvoxParser's private fields, so this method exposes the
  // single write operation it needs.
  setPalette(palette: Palette, line: number): void {
    this.palette = palette;
    this.paletteLineNo = line;
  }

  parse(): Result<Cvox> {
    while (this.cursor.hasMore()) {
      const t = this.cursor.advance()!;
      if (t.kind !== 'bare') {
        return err(
          'unknown',
          `line ${t.line}: unexpected quoted string "${t.text}" at top level (no statement starts with a string)`,
        );
      }
      switch (t.text) {
        case 'palette': {
          const r = new PaletteParser(this.cursor, this).parse(t);
          if (!r.ok) return r;
          this.palette = r.value;
          this.paletteLineNo = t.line;
          break;
        }
        case 'part': {
          const r = new PartParser(this.cursor, this).parse(t);
          if (!r.ok) return r;
          this.partNames.add(r.value.name);
          this.parts.push(r.value);
          break;
        }
        // stray reserved tokens at file scope — their structurally valid
        // enclosing scope is missing (SPEC §7.3.3)
        case 'size':
        case 'pivot':
        case 'socket':
        case 'voxels':
          return err(
            'missing',
            `line ${t.line}: '${t.text}' before any part declaration`,
          );
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
        // SPEC §7.5.1: reuse keywords are only valid in a part header, right
        // after a part name — never at file scope.
        case 'clone':
        case 'mirror':
          return err(
            'missing',
            `line ${t.line}: '${t.text}' is only valid in a part header (after a part name), not at file scope`,
          );
        default:
          return err('unknown', `line ${t.line}: unknown token '${t.text}'`);
      }
    }
    return this.assemble();
  }

  private assemble(): Result<Cvox> {
    if (this.parts.length === 0) {
      return err(
        'missing',
        this.palette !== null
          ? 'file contains palette but no parts'
          : 'file contains no part declarations',
      );
    }
    // SPEC §7.4 (v0.7): the palette declaration is optional ("at most
    // one"). No declaration → empty palette; voxel index-range validation
    // is deferred to cross-file lint against the manifest-bound palette.
    const palette = this.palette ?? [];

    // Phase 1: assemble all concrete (non-reuse) parts into a lookup map.
    // Reuse parts (clone/mirror, SPEC §7.5.1) resolve against this map in
    // phase 2, so the referent may be declared in any order (free-order).
    const concrete = new Map<string, Part>();
    for (const parsed of this.parts) {
      if (parsed.from !== undefined) continue;
      const r = assemblePart(parsed, palette);
      if (!r.ok) return r;
      concrete.set(parsed.name, r.value);
    }

    // Phase 2: produce final parts in source order, resolving reuse refs.
    const finalParts: Part[] = [];
    const pending: PendingReuse[] = [];
    for (const [index, parsed] of this.parts.entries()) {
      const from = parsed.from;
      if (from === undefined) {
        finalParts.push(concrete.get(parsed.name)!);
        continue;
      }
      const ref = concrete.get(from.part);
      const verb = from.mirror !== undefined ? 'mirror' : 'clone';
      if (ref === undefined) {
        // Referent is not a concrete part in this file: either it is a
        // same-file reuse part (chains are forbidden — resolution stays a
        // single leaf reference per SPEC §7.5.1), or it isn't defined here.
        const isReuse = this.parts.some(
          (p) => p.name === from.part && p.from !== undefined,
        );
        if (isReuse) {
          return err(
            'invalid-value',
            `part "${parsed.name}" ${verb}s "${from.part}", which is itself a clone/mirror (reuse chains are not allowed)`,
          );
        }
        // SPEC §6.9: not defined in this file. In deferred mode the project
        // layer resolves it against the other geometry files; standalone
        // parsing keeps this a hard error.
        if (this.options.deferUnresolvedReuse === true) {
          pending.push({ name: parsed.name, from, index });
          continue;
        }
        return err(
          'missing',
          `part "${parsed.name}" ${verb}s unknown part "${from.part}"`,
        );
      }
      finalParts.push(reusePart(parsed.name, from, ref));
    }
    return ok({
      palette,
      parts: finalParts,
      ...(pending.length > 0 && { pending }),
    });
  }
}

export function parseCvox(
  text: string,
  options: ParseCvoxOptions = {},
): Result<Cvox> {
  // SPEC §7.X: the file header is a pure pre-pass over raw text. It runs
  // before tokenize/parse and never affects either — comment lines are
  // already silent-stripped by tokenize, so capturing the header
  // separately doesn't interfere with token line numbers or parse state.
  const header = extractHeader(text);
  const tokensR = tokenize(text);
  if (!tokensR.ok) return tokensR;
  const r = new CvoxParser(new TokenCursor(tokensR.value), options).parse();
  if (!r.ok) return r;
  if (header.length === 0) return r;
  return ok({ ...r.value, header });
}
