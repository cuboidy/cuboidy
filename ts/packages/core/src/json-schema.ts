// Builds the standalone JSON Schema for cuboidy.json from the Zod
// ManifestSchema. Used by scripts/generate-schema.ts to produce the
// committed artifact, and by json-schema.test.ts for drift detection.
// Both consumers go through this single function so they can never
// drift from each other.

import { z } from 'zod';
import { IDENTIFIER_RE } from './identifier.js';
import { RESERVED_KEYWORDS } from './cvox/reserved.js';
import { ManifestSchema } from './manifest.js';

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

export function buildManifestJsonSchema(): Record<string, unknown> {
  const baseSchema = z.toJSONSchema(ManifestSchema, { target: 'draft-2020-12' });
  const constrained = injectReservedRejection(baseSchema) as Record<string, unknown>;
  // Merge metadata on top of Zod's output. $id is cuboidy.com (owned
  // domain, future-proof); until cuboidy.com hosts the file, consumers
  // can still reference it from the GitHub raw URL.
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://cuboidy.com/schema/cuboidy.schema.json',
    title: 'Cuboidy Manifest',
    description:
      'Schema for cuboidy.json — the manifest file of a Cuboidy v0.5 model package (rig hierarchy + animation references). Generated from the Zod ManifestSchema in @cuboidy/core.',
    ...constrained,
  };
}
