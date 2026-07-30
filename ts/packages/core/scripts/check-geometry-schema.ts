// Corpus check: every geometry file that ships under models/ validates against
// GeometrySchema — the same schema the published artifact is generated from.
// A schema that rejects the corpus it was written for is not a schema.
//
//   npx tsx scripts/check-geometry-schema.ts
//
// The test suite covers this too (geometry-parse.test.ts asserts a byte-level
// fixed point on the same files); this script exists so the check can be run
// against a working tree without booting vitest, e.g. after hand-editing a
// model.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeometrySchema } from '../src/geometry/schema.js';
import { formatGeometryDoc } from '../src/geometry/serialize.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, '..', '..', '..', '..', 'models');

// Everything in a model directory is .json now, so the manifest and any
// palette/animation file have to be skipped by shape rather than by name:
// a geometry file is the one with a `parts` array of objects carrying `size`.
function looksLikeGeometry(json: unknown): boolean {
  if (typeof json !== 'object' || json === null) return false;
  const parts = (json as { parts?: unknown }).parts;
  return (
    Array.isArray(parts) &&
    parts.length > 0 &&
    typeof parts[0] === 'object' &&
    parts[0] !== null &&
    'size' in (parts[0] as object)
  );
}

let total = 0;
let failed = 0;

for (const dir of readdirSync(MODELS)) {
  for (const file of readdirSync(join(MODELS, dir))) {
    if (!file.endsWith('.json')) continue;
    const text = readFileSync(join(MODELS, dir, file), 'utf8');
    const json: unknown = JSON.parse(text);
    if (!looksLikeGeometry(json)) continue;

    total += 1;
    const result = GeometrySchema.safeParse(json);
    if (!result.success) {
      failed += 1;
      const issue = result.error.issues[0]!;
      console.log(`FAIL ${dir}/${file}: ${issue.path.join('.')}: ${issue.message}`);
      continue;
    }

    // The writer hand-builds its output, so a stray comma would only show up
    // by re-reading what it emitted.
    const reparsed = GeometrySchema.safeParse(
      JSON.parse(formatGeometryDoc(result.data)),
    );
    if (!reparsed.success) {
      failed += 1;
      console.log(`FAIL ${dir}/${file}: formatted output does not re-validate`);
    }
  }
}

console.log(`GeometrySchema: ${total - failed}/${total} shipped geometry files validate`);
process.exit(failed === 0 ? 0 : 1);
