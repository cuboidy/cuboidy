import { z } from 'zod';
import { AnimationsSchema } from './animation.js';
import {
  GeometryPartSchema,
  PaletteFieldSchema,
  checkPartFields,
} from './geometry/schema.js';
import { Identifier } from './identifier-schema.js';
import { BOUNDARY_FACES } from './open-boundary.js';
import { refPath } from './ref-path.js';
import { ok, type Result } from './result.js';
import { resultFromZodError } from './zod-diagnostic.js';

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

// SPEC §6.2: a rest-scale factor. Strictly positive and finite — zero
// collapses the part to nothing and a negative value mirrors it, which
// reverses face winding. Both are `invalid-value` rather than a mesh that
// differs from what the author wrote without saying so.
const Factor = z.number().positive().finite();
const Scale3 = z.tuple([Factor, Factor, Factor]);

// SPEC §6.14: the planes of a bounds that are open — a seam another package is
// expected to sit against. One field, two scopes (the manifest's own bounds,
// or a part's), so the shape is declared once here.
const OpenBoundaries = z
  .array(z.enum(BOUNDARY_FACES))
  .min(1)
  .refine((a) => new Set(a).size === a.length, {
    message: 'duplicate open boundary',
  })
  // The refine is runtime-only; `.meta()` carries the equivalent constraint
  // into the generated JSON Schema, the same way `geometry` does.
  .meta({ uniqueItems: true });

// SPEC §6.15: one line of plain text in which a model says what it is and
// what it looks like. The bound is enforced by the reader rather than linted,
// because a consumer can rely on it only if every reader does: a game handing
// the text to an agent, or a list showing it in a row, must never have to
// decide where to cut it.
//
// Counted in CODE POINTS as written, without normalization. Not `.length`,
// which counts UTF-16 units here and in C# alike, and would give a sentence
// with an emoji in it less room than one without; that is also why this is a
// walk and not Zod's `.max()`, which counts units.
export const DESCRIPTION_MAX = 200;

// The characters that are not one line of text: Unicode category Cc, which is
// exactly U+0000-U+001F and U+007F-U+009F (tab, LF, CR and NEL among them),
// and the two line breaks outside it, U+2028 and U+2029.
function breaksTheLine(unit: number): boolean {
  return (
    unit <= 0x1f ||
    (unit >= 0x7f && unit <= 0x9f) ||
    unit === 0x2028 ||
    unit === 0x2029
  );
}

// The same set for the generated JSON Schema. The half-surrogate rule is NOT
// in it: a schema validator that matches by UTF-16 unit (.NET's Regex, or any
// engine without Unicode mode) would read `[^\uD800-\uDFFF]` as excluding both
// halves of every valid pair and reject an emoji. The schema stays looser
// than the reader on that one input rather than stricter on valid ones.
const DESCRIPTION_PATTERN = '^[^\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029]*$';

const hex = (unit: number): string =>
  `U+${unit.toString(16).toUpperCase().padStart(4, '0')}`;

const Description = z
  .string()
  // One walk, in the order both readers report in: nothing to walk, then a
  // character that cannot be in a line, then the count.
  .superRefine((text, ctx) => {
    if (text.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'a description says something; leave the field out to say nothing',
        params: { cuboidyCode: 'wrong-arity' },
      });
      return;
    }
    let codePoints = 0;
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          i++;
          codePoints++;
          continue;
        }
      }
      // JSON lets an escape spell half of a pair ("\uD800"). It is not a
      // character: it has no UTF-8 form to be written out in, and
      // System.Text.Json will not hand one back as a string at all.
      if (unit >= 0xd800 && unit <= 0xdfff) {
        ctx.addIssue({
          code: 'custom',
          message: `a description is text, and ${hex(unit)} is half of a surrogate pair`,
          params: { cuboidyCode: 'invalid-value' },
        });
        return;
      }
      if (breaksTheLine(unit)) {
        ctx.addIssue({
          code: 'custom',
          message: `a description is one line, and ${hex(unit)} is a line break or a control character`,
          params: { cuboidyCode: 'invalid-value' },
        });
        return;
      }
      codePoints++;
    }
    // §11.2 counts characters as an arity where a voxel row's width is one;
    // the empty case above is the same count, at zero.
    if (codePoints > DESCRIPTION_MAX) {
      ctx.addIssue({
        code: 'custom',
        message: `a description is at most ${DESCRIPTION_MAX} code points, and this one is ${codePoints}`,
        params: { cuboidyCode: 'wrong-arity' },
      });
    }
  })
  // The walk is runtime-only. JSON Schema's `minLength` / `maxLength` count
  // code points too, so the bound travels into the generated schema as is.
  .meta({ minLength: 1, maxLength: DESCRIPTION_MAX, pattern: DESCRIPTION_PATTERN });

// SPEC §6.13: where a part's shape comes from. Two forms in one object,
// told apart by whether `path` is present:
//
//   { "path": "voxels.json" }                    a part in a file
//   { "path": "caps.json", "part": "beret" }     …under a different name
//   { "size": …, "voxels": …, … }                written out here
//
// Modelled as ONE object rather than a z.union so the diagnostics stay
// precise. A union reports `invalid_union` with both branches' failures
// nested, which would land every mistake on the catch-all `invalid-value`;
// the SPEC asks for `missing` on an incomplete inline object and `unknown`
// on a field belonging to the other form, and superRefine can say exactly
// that. Strictness still comes from the schema: a field in NEITHER form is
// an unrecognized key.
//
// The inline half is `GeometryPartSchema` minus `name` (the enclosing part
// already has one — a second copy is a field that can disagree with
// another) plus §7.4's palette, with `size` / `voxels` relaxed to optional
// here and required back in the refinement, since they are required only
// when the form is inline.
export const PartGeometrySchema = GeometryPartSchema
  .omit({ name: true })
  .extend({
    palette: PaletteFieldSchema.optional(),
    path: refPath('.json').optional(),
    part: Identifier.optional(),
  })
  .partial({ size: true, voxels: true })
  .strict()
  .superRefine((g, ctx) => {
    if (g.path !== undefined) {
      for (const key of ['size', 'pivot', 'sockets', 'voxels', 'palette'] as const) {
        if (g[key] === undefined) continue;
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `\`${key}\` belongs to inline geometry; a reference has only \`path\` and \`part\``,
          params: { cuboidyCode: 'unknown' },
        });
      }
      return;
    }
    // Inline form. The mirror of the branch above, and it was missing:
    // `part` names which part of a REFERENCED file to bind, so it is
    // meaningless without `path` — SPEC §6.13 says the inline object is
    // exactly a §7.5 part minus `name` plus `palette`, and §11.5 codes
    // anything else `unknown`. Written without `path` it parsed, and
    // `project.ts` then destructured it away in silence. That is also the
    // shape of the actual authoring slip: naming the part and forgetting
    // the file.
    if (g.part !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['part'],
        message:
          '`part` names a part inside a referenced file; inline geometry has no file to name (did you mean to add `path`?)',
        params: { cuboidyCode: 'unknown' },
      });
    }
    for (const key of ['size', 'voxels'] as const) {
      if (g[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'required field is missing',
          params: { cuboidyCode: 'missing' },
        });
      }
    }
    // Everything above is §11.8 phase 2 — each field considered on its own.
    // The cross-field rules for an inline part (voxel arity against `size`,
    // palette index range, socket-name uniqueness) are phase 3, and a phase
    // runs only if every earlier one passed. They therefore CANNOT live
    // here: a refinement on this field runs during the document's own
    // structural parse, so a bad row width on one part would be reported
    // ahead of an absent `name` on the next. They run from ManifestSchema's
    // refinement instead, which Zod reaches only once every part parsed.
  });

export const ManifestPartSchema = z
  .object({
    name: Identifier,
    parent: Identifier.optional(),
    position: Vec3.optional(),
    // SPEC §6.2 (v0.9): rest rotation in parent space, Euler degrees ZXY
    // (§4), applied around the part's pivot on top of the geometry-side
    // pivot.rot (q_rest = q_rotation · q_pivot, §7.7). Absent → identity.
    rotation: Vec3.optional(),
    // SPEC §6.2 (v0.9): rest scale, per-axis multipliers on this part's own
    // voxels around its pivot. Multiplies with the keyframe `scale` of §6.5
    // (S_total = scale ⊙ anim.scale) and, like that one, does NOT reach the
    // part's children (§7.7). Absent → [1, 1, 1].
    scale: Scale3.optional(),
    // SPEC §6.14: planes of THIS PART's bounds that are open — the faces on
    // them are a seam and are not baked. Scoped to the part, so a package
    // whose open side belongs to one component says so there instead of
    // opening the whole package's plane. Absent → the part is closed.
    openBoundaries: OpenBoundaries.optional(),
    // SPEC §6.13. Absent → the by-`name` lookup among the files in the
    // top-level `geometry` list, which is what every pre-v0.9 model uses.
    geometry: PartGeometrySchema.optional(),
  })
  .strict();

// SPEC §6.12: one entry of the manifest's `sockets` map — a published name
// (the map key) aliasing a socket declared on a part in geometry (§7.8).
// Pure aliasing: no offset of its own, so the frame is exactly §7.8's.
export const PublishedSocketSchema = z
  .object({
    part: Identifier,
    socket: Identifier,
  })
  .strict();

export const ManifestSchema = z
  .object({
    name: Identifier,
    version: z.string().optional(),
    // SPEC §6.15: one line saying what the model is and looks like, for
    // whoever is shown the model or handed it in place of a picture. Nothing
    // drawn reads it. Absent → the model says nothing about itself.
    description: Description.optional(),
    // SPEC §6.9: the model's geometry files. Absent → the default
    // ["voxels.json"] (use manifestGeometry() to read with the default
    // applied). Part names are unique across ALL listed files.
    geometry: z
      .array(refPath('.json'))
      .min(1)
      .refine((a) => new Set(a).size === a.length, {
        message: 'duplicate geometry entry',
      })
      // The refine is runtime-only; `.meta()` carries the equivalent
      // constraint into the generated JSON Schema.
      .meta({ uniqueItems: true })
      .optional(),
    // SPEC §6.1 / §6.13: the palette INLINE part geometry falls back to.
    // Scoped, unlike v0.7's field of the same name: it never reaches into
    // a geometry file, so a referenced part still means what its own file
    // says (§7.4) and there is nothing to shadow. That precedence — not
    // the existence of a second palette — is what v0.9 removed along with
    // hint H03. A binding no inline part uses lints as W08 (§11.6), which
    // is exactly the shape a leftover v0.7 manifest has.
    palette: PaletteFieldSchema.optional(),
    // SPEC §6.14: planes of the PACKAGE's bounds that are open. Every part
    // takes part — an interior one simply has no face on the plane. Absent →
    // the package is closed, which is what every model before this field was.
    openBoundaries: OpenBoundaries.optional(),
    parts: z.array(ManifestPartSchema).min(1),
    // SPEC §6.12: the attachment points this model offers to consumers.
    // Keys are §5 identifiers and are unique model-wide by virtue of being
    // object keys — a socket name is only unique WITHIN its part (§7.8),
    // so publication is what gives an attachment point an unambiguous name.
    // Absent → the model publishes none.
    sockets: z.record(Identifier, PublishedSocketSchema).optional(),
    animations: AnimationsSchema.optional(),
  })
  .strict()
  // SPEC §11.5 hierarchy rules: duplicate part names, parents that name
  // no part, and parent cycles are manifest errors. `params.cuboidyCode`
  // carries the structural code (§11.2) so parseManifest can map custom
  // issues to `duplicate` where the SPEC calls for it.
  .superRefine((m, ctx) => {
    // §11.8 phase 3: "parts are examined in document order; within a part"
    // duplicate name, then the arity levels, then palette indices, then
    // sockets — which is why the inline-geometry check sits inside this
    // loop rather than after it, and is the order a geometry file's parts
    // are already examined in (GeometrySchema's refinement).
    const names = new Set<string>();
    for (const [i, p] of m.parts.entries()) {
      if (names.has(p.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parts', i, 'name'],
          message: `duplicate part name "${p.name}"`,
          params: { cuboidyCode: 'duplicate' },
        });
      }
      names.add(p.name);

      // SPEC §6.13 inline geometry, by the same code a geometry file's part
      // goes through. The index range is checked only against a palette
      // written out HERE; a reference — or the manifest's default — defers
      // to §11.6 "even when the manifest's palette is an array in the same
      // document, so that where the colors are written never changes when
      // an error is reported" (§11.8).
      const g = p.geometry;
      if (g !== undefined && g.size !== undefined && g.voxels !== undefined) {
        checkPartFields(
          { size: g.size, voxels: g.voxels, sockets: g.sockets },
          ['parts', i, 'geometry'],
          Array.isArray(g.palette) ? g.palette.length : null,
          ctx,
        );
      }
    }
    for (const [i, p] of m.parts.entries()) {
      if (p.parent !== undefined && !names.has(p.parent)) {
        ctx.addIssue({
          code: 'custom',
          path: ['parts', i, 'parent'],
          message: `parent "${p.parent}" is not a part in this manifest`,
        });
      }
    }
    // §6.12: a published socket's host part must be a part of this model.
    // The other half of the contract — that the part actually DECLARES a
    // socket by that name — needs the geometry files, so it lives in
    // cross-file validation (§11.6). No cuboidyCode: the fallback maps this
    // to `invalid-value`, the same code a dangling `parent` gets (§11.5).
    for (const [pub, target] of Object.entries(m.sockets ?? {})) {
      if (!names.has(target.part)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sockets', pub, 'part'],
          message: `published socket "${pub}" names part "${target.part}", which is not a part in this manifest`,
        });
      }
    }
    // Cycle check: walk each part's parent chain. With duplicate names
    // the chain is ambiguous, so only run on a clean name set.
    if (names.size !== m.parts.length) return;
    const parentOf = new Map(m.parts.map((p) => [p.name, p.parent]));
    const cleared = new Set<string>();
    for (const [i, p] of m.parts.entries()) {
      const seen = new Set<string>();
      let cur: string | undefined = p.name;
      while (cur !== undefined && !cleared.has(cur)) {
        if (seen.has(cur)) {
          ctx.addIssue({
            code: 'custom',
            path: ['parts', i, 'parent'],
            message: `parent chain of "${p.name}" contains a cycle`,
          });
          return; // one report per manifest is enough
        }
        seen.add(cur);
        cur = parentOf.get(cur);
      }
      for (const s of seen) cleared.add(s);
    }
  });

// SPEC §6.9: `geometry` with its default applied.
export function manifestGeometry(m: Manifest): readonly string[] {
  return m.geometry ?? ['voxels.json'];
}

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestPart = z.infer<typeof ManifestPartSchema>;
export type PublishedSocket = z.infer<typeof PublishedSocketSchema>;

export function parseManifest(json: unknown): Result<Manifest> {
  const result = ManifestSchema.safeParse(json);
  if (result.success) return ok(result.data);
  return resultFromZodError(result.error, json);
}
