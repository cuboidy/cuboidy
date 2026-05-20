import { err, ok, type Result } from '../result.js';
import { TokenCursor } from './cursor.js';
import { extractHeader } from './header.js';
import { PaletteParser } from './palette.js';
import { assemblePart, PartParser, type ParsedPart } from './part.js';
import { tokenize } from './tokenize.js';
import type { Cvox, Palette, Part } from './types.js';

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

  constructor(private readonly cursor: TokenCursor) {}

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
        default:
          return err('unknown', `line ${t.line}: unknown token '${t.text}'`);
      }
    }
    return this.assemble();
  }

  private assemble(): Result<Cvox> {
    if (this.palette === null) {
      return err('missing', 'missing palette declaration');
    }
    if (this.parts.length === 0) {
      return err('missing', 'file contains palette but no parts');
    }
    const palette = this.palette;
    const finalParts: Part[] = [];
    for (const parsed of this.parts) {
      const r = assemblePart(parsed, palette);
      if (!r.ok) return r;
      finalParts.push(r.value);
    }
    return ok({ palette, parts: finalParts });
  }
}

export function parseCvox(text: string): Result<Cvox> {
  // SPEC §7.X: the file header is a pure pre-pass over raw text. It runs
  // before tokenize/parse and never affects either — comment lines are
  // already silent-stripped by tokenize, so capturing the header
  // separately doesn't interfere with token line numbers or parse state.
  const header = extractHeader(text);
  const tokensR = tokenize(text);
  if (!tokensR.ok) return tokensR;
  const r = new CvoxParser(new TokenCursor(tokensR.value)).parse();
  if (!r.ok) return r;
  if (header.length === 0) return r;
  return ok({ ...r.value, header });
}
