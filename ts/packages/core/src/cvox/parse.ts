import { err, ok, type Result } from '../result.js';
import { TokenCursor } from './cursor.js';
import {
  CvoxState,
  type PartDefinition,
  type VoxelDefinition,
} from './cvox-state.js';
import { PaletteParser } from './palette.js';
import { PartParser } from './part.js';
import { tokenize } from './tokenize.js';

// Re-export public output types (the shape returned by parseCvox).
export type { PartDefinition, VoxelDefinition } from './cvox-state.js';

// SPEC §7.2: top-level parser. Dispatches each file-scope token to its
// production parser (PaletteParser, PartParser) or returns a structural
// error for tokens that have no valid grammatical role at file scope.
//
// Per-production parsers (Palette/Part/Size/Pivot/Socket/Voxels) own their
// own stream advancement via a shared TokenCursor. PartParser additionally
// owns an inner loop for part-scoped declarations. See SPEC §7.3.3 for the
// structural validity table.
export class CvoxParser {
  private readonly state = new CvoxState();

  constructor(private readonly cursor: TokenCursor) {}

  parse(): Result<VoxelDefinition> {
    while (this.cursor.hasMore()) {
      const t = this.cursor.advance()!;
      switch (t.text) {
        case 'palette': {
          const r = new PaletteParser(this.cursor, this.state).parse(t);
          if (!r.ok) return r;
          this.state.palette = r.value;
          this.state.paletteLineNo = t.line;
          break;
        }
        case 'part': {
          const r = new PartParser(this.cursor, this.state).parse(t);
          if (!r.ok) return r;
          this.state.commitPart(r.value);
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
    return this.state.assemble();
  }
}

export function parseCvox(text: string): Result<VoxelDefinition> {
  return new CvoxParser(new TokenCursor(tokenize(text))).parse();
}
