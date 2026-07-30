// Regenerates the standalone JSON Schema artifacts from their Zod sources.
// Zod is the single source of truth for both file shapes; these derivations
// produce the artifacts consumers (editors, third-party validators, language
// servers) reference via $schema.
//
// Run via `npm run generate:schema` from packages/core. The committed schema
// files MUST equal the builders' output — drift is caught by
// json-schema.test.ts.

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildManifestJsonSchema,
  buildGeometryJsonSchema,
} from '../src/json-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = resolve(here, '../../../../schema');

for (const [file, build] of [
  ['cuboidy.schema.json', buildManifestJsonSchema],
  ['cuboidy-geometry.schema.json', buildGeometryJsonSchema],
] as const) {
  const out = resolve(schemaDir, file);
  const text = JSON.stringify(build(), null, 2) + '\n';
  writeFileSync(out, text, 'utf-8');
  console.log(`Wrote ${out} (${text.length} bytes)`);
}
