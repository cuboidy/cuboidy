// Regenerates schema/cuboidy.schema.json from the Zod ManifestSchema.
// Zod is the single source of truth for the cuboidy.json shape; this
// derivation produces the standalone JSON Schema artifact that consumers
// (editors, third-party validators, language servers) reference via $schema.
//
// Run via `npm run generate:schema` from packages/core. The committed
// schema file MUST equal `buildManifestJsonSchema()`'s output — drift is
// caught by json-schema.test.ts.

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifestJsonSchema } from '../src/json-schema.js';

const schema = buildManifestJsonSchema();

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../../schema/cuboidy.schema.json');
const text = JSON.stringify(schema, null, 2) + '\n';
writeFileSync(out, text, 'utf-8');
console.log(`Wrote ${out} (${text.length} bytes)`);
