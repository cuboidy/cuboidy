// Phase 0 acceptance check: every real model, converted to the JSON shape,
// validates against GeometrySchema. Run before wiring anything to it —
// a schema that rejects the corpus it was written for is not a schema.
//
//   npx tsx scripts/check-geometry-schema.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeometrySchema } from '../src/geometry/schema.js';
import { toGeometryDoc, formatGeometryDoc } from '../src/geometry/serialize.js';
import { parseCvox } from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, '..', '..', '..', '..', 'models');

let total = 0;
let failed = 0;

for (const dir of readdirSync(MODELS)) {
  const files = readdirSync(join(MODELS, dir)).filter((f) => f.endsWith('.cvox'));
  for (const file of files) {
    const text = readFileSync(join(MODELS, dir, file), 'utf8');
    const parsed = parseCvox(text);
    if (!parsed.ok) throw new Error(`${dir}/${file}: ${parsed.message}`);

    const doc = toGeometryDoc(parsed.value);
    total += 1;

    const result = GeometrySchema.safeParse(doc);
    if (!result.success) {
      failed += 1;
      const issue = result.error.issues[0]!;
      console.log(`FAIL ${dir}/${file}: ${issue.path.join('.')}: ${issue.message}`);
      continue;
    }

    // The formatted text must also survive a plain JSON.parse and validate —
    // the emitter hand-builds its output, so a stray comma would only show up
    // here.
    const reparsed = GeometrySchema.safeParse(JSON.parse(formatGeometryDoc(doc)));
    if (!reparsed.success) {
      failed += 1;
      console.log(`FAIL ${dir}/${file}: formatted output does not re-validate`);
    }
  }
}

console.log(`GeometrySchema: ${total - failed}/${total} real models validate`);
process.exit(failed === 0 ? 0 : 1);
