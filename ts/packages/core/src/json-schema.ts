// Builds the standalone JSON Schema for cuboidy.json from the Zod
// ManifestSchema. Used by scripts/generate-schema.ts to produce the
// committed artifact, and by json-schema.test.ts for drift detection.
// Both consumers go through this single function so they can never
// drift from each other.

import { z } from 'zod';
import { IDENTIFIER_RE } from './identifier.js';
import { RESERVED_KEYWORDS } from './cvox/reserved.js';
import { ManifestSchema } from './manifest.js';
import { GeometrySchema } from './geometry/schema.js';

const IDENTIFIER_PATTERN = IDENTIFIER_RE.source;

// Walks the generated schema and injects `not.enum: RESERVED_KEYWORDS`
// onto any string property whose pattern matches the identifier regex.
// Zod's `.refine((s) => !RESERVED_KEYWORD_SET.has(s))` does not serialize
// to JSON Schema (refines are runtime-only), so without this injection
// the JSON Schema would be strictly weaker than the Zod runtime check —
// editors would accept `{"name": "palette"}` even though parseManifest
// rejects it. The walk is keyed on the unique IDENTIFIER_RE pattern so
// only identifier slots are touched.
function injectReservedRejection(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(injectReservedRejection);
  if (node === null || typeof node !== 'object') return node;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    result[k] = injectReservedRejection(v);
  }
  if (
    result.type === 'string' &&
    typeof result.pattern === 'string' &&
    result.pattern === IDENTIFIER_PATTERN
  ) {
    result.not = { enum: [...RESERVED_KEYWORDS] };
  }
  return result;
}

// Zod emits tuples (Vec3 positions, keyframe rot/pos/scale) as
// `prefixItems` WITHOUT length bounds, so a JSON Schema validator would
// accept [1,2] or [1,2,3,4] that parseManifest rejects. Pin every tuple
// to exactly its prefix length.
function constrainTuples(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(constrainTuples);
  if (node === null || typeof node !== 'object') return node;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    result[k] = constrainTuples(v);
  }
  if (
    result.type === 'array' &&
    Array.isArray(result.prefixItems) &&
    result.minItems === undefined &&
    result.maxItems === undefined
  ) {
    result.minItems = result.prefixItems.length;
    result.maxItems = result.prefixItems.length;
  }
  return result;
}

export function buildManifestJsonSchema(): Record<string, unknown> {
  const baseSchema = z.toJSONSchema(ManifestSchema, { target: 'draft-2020-12' });
  const constrained = constrainTuples(
    injectReservedRejection(baseSchema),
  ) as Record<string, unknown>;
  // Merge metadata on top of Zod's output. $id is cuboidy.com (owned
  // domain, future-proof); until cuboidy.com hosts the file, consumers
  // can still reference it from the GitHub raw URL.
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://cuboidy.com/schema/cuboidy.schema.json',
    title: 'Cuboidy Manifest',
    description:
      'Schema for cuboidy.json — the manifest file of a Cuboidy v0.9 model package (geometry list, palette binding, rig hierarchy + animation references). Generated from the Zod ManifestSchema in @cuboidy/core. SPEC §8 reference paths, tuple arity and geometry uniqueness are encoded; the remaining runtime-only rules (SPEC §11.5: duplicate part names, parent existence/cycles, animation duration/time-key semantics) need parseManifest or an equivalent validator.',
    ...constrained,
  };
}

export function buildGeometryJsonSchema(): Record<string, unknown> {
  const baseSchema = z.toJSONSchema(GeometrySchema, { target: 'draft-2020-12' });
  const constrained = constrainTuples(
    injectReservedRejection(baseSchema),
  ) as Record<string, unknown>;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://cuboidy.com/schema/cuboidy-geometry.schema.json',
    title: 'Cuboidy Geometry',
    description:
      'Schema for voxels.json — the voxel definition of a Cuboidy v0.9 model package (palette, parts, pivots, sockets, voxel grids). Generated from the Zod GeometrySchema in @cuboidy/core. Field shapes, size bounds, the voxel-row alphabet and identifier rules are encoded; the cross-field rules need parseGeometry or an equivalent validator, because they read more than one value at a time (SPEC §7.9 layer/row/width agreement with `size`, §7.4 palette index range, §7.8 socket-name uniqueness).',
    ...constrained,
  };
}
