import { z } from 'zod';
import { Identifier } from '../identifier-schema.js';
import { MAX_PALETTE } from '../cvox/palette.js';

// SPEC §7: the Zod schema for a geometry file (`voxels.json`). Single source of
// truth for both the runtime reader and the published JSON Schema artifact, so
// the two cannot drift — the same arrangement manifest.ts and json-schema.ts
// already use.
//
// Structural rules live here. The cross-field rules that need more than one
// value at a time — voxel dimensions agreeing with `size`, palette indices
// being in range — are in the superRefine below, which means they are enforced
// at runtime but do NOT serialize into the JSON Schema. That is the same
// limitation the manifest schema documents for §11.5, and the artifact's
// description says so.

const SIZE_MAX = 1024;

// Matches parseHexColor: #RGB, #RGBA, #RRGGBB, #RRGGBBAA (sRGB).
const HexColor = z
  .string()
  .regex(
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    'must be #RGB, #RGBA, #RRGGBB or #RRGGBBAA',
  );

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

// SPEC §7.6: positive integers per axis, capped for tractability.
const Dim = z.number().int().min(1).max(SIZE_MAX);
const Size = z.tuple([Dim, Dim, Dim]);

// SPEC §7.10: `.` is air, every other character is a palette index in the
// 0-9a-zA-Z alphabet. Width and index range are checked in the superRefine,
// which needs `size` and the palette length.
const VoxelRow = z
  .string()
  .regex(/^[.0-9a-zA-Z]*$/, 'voxel rows use only [.0-9a-zA-Z]');

// SPEC §7.7 / §7.8: a point in part-local space with an optional ZXY Euler
// rotation in degrees. Fractional values are allowed; out-of-bounds positions
// are a lint warning (W01), not a schema error.
const Placement = z
  .object({
    pos: Vec3,
    rot: Vec3.optional(),
  })
  .strict();

const Socket = z
  .object({
    name: Identifier,
    pos: Vec3,
    rot: Vec3.optional(),
  })
  .strict();

export const GeometryPartSchema = z
  .object({
    name: Identifier,
    size: Size,
    // Absent → the §7.7 default, bottom-center of the bounding box.
    pivot: Placement.optional(),
    sockets: z.array(Socket).optional(),
    // [Y][Z] — H layers of D rows, each row W characters. Arity is checked
    // against `size` below.
    voxels: z.array(z.array(VoxelRow)),
  })
  .strict();

export const GeometrySchema = z
  .object({
    // Spec version string, same field and semantics as the manifest's.
    version: z.string().optional(),
    // Absent → the model binds an external palette via the manifest (§6.10),
    // or every voxel is air.
    palette: z.array(HexColor).min(1).max(MAX_PALETTE).optional(),
    parts: z.array(GeometryPartSchema).min(1),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const paletteSize = doc.palette?.length ?? null;
    const names = new Set<string>();

    for (const [i, part] of doc.parts.entries()) {
      // SPEC §5: part names are unique across the whole model; within one
      // file we can at least catch the local collision.
      if (names.has(part.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parts', i, 'name'],
          message: `duplicate part name "${part.name}"`,
          params: { cuboidyCode: 'duplicate' },
        });
      }
      names.add(part.name);

      const [w, h, d] = part.size;

      // SPEC §7.9: H layers of D rows of W characters, positionally indexed.
      if (part.voxels.length !== h) {
        ctx.addIssue({
          code: 'custom',
          path: ['parts', i, 'voxels'],
          message: `${part.voxels.length} layers, expected H=${h}`,
          params: { cuboidyCode: 'wrong-arity' },
        });
      }
      for (const [y, layer] of part.voxels.entries()) {
        if (layer.length !== d) {
          ctx.addIssue({
            code: 'custom',
            path: ['parts', i, 'voxels', y],
            message: `${layer.length} rows, expected D=${d}`,
            params: { cuboidyCode: 'wrong-arity' },
          });
          continue;
        }
        for (const [z, row] of layer.entries()) {
          if (row.length !== w) {
            ctx.addIssue({
              code: 'custom',
              path: ['parts', i, 'voxels', y, z],
              message: `row length ${row.length}, expected W=${w}`,
              params: { cuboidyCode: 'wrong-arity' },
            });
            continue;
          }
          // SPEC §7.4: index-range validation is skipped when the file
          // declares no palette — it moves to cross-file validation against
          // the manifest-bound palette (§11.6).
          if (paletteSize === null) continue;
          for (const ch of row) {
            if (ch === '.') continue;
            const idx = charIndex(ch);
            if (idx >= paletteSize) {
              ctx.addIssue({
                code: 'custom',
                path: ['parts', i, 'voxels', y, z],
                message: `'${ch}' is palette index ${idx}, palette has ${paletteSize}`,
                params: { cuboidyCode: 'invalid-value' },
              });
              break; // one report per row is enough
            }
          }
        }
      }

      // SPEC §7.8: socket names unique within a part.
      const socketNames = new Set<string>();
      for (const [s, socket] of (part.sockets ?? []).entries()) {
        if (socketNames.has(socket.name)) {
          ctx.addIssue({
            code: 'custom',
            path: ['parts', i, 'sockets', s, 'name'],
            message: `duplicate socket "${socket.name}"`,
            params: { cuboidyCode: 'duplicate' },
          });
        }
        socketNames.add(socket.name);
      }
    }
  });

// The §7.4 alphabet: 0-9 → 0-9, a-z → 10-35, A-Z → 36-61. The row regex has
// already rejected anything outside it, so this needs no failure case.
function charIndex(c: string): number {
  const code = c.charCodeAt(0);
  if (code <= 57) return code - 48; // '0'-'9'
  if (code >= 97) return code - 97 + 10; // 'a'-'z'
  return code - 65 + 36; // 'A'-'Z'
}

export type GeometryDoc = z.infer<typeof GeometrySchema>;
export type GeometryDocPart = z.infer<typeof GeometryPartSchema>;
