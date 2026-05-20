// Sanity check: every generated .cvox in the dataset must parse cleanly with
// the reference parser. If any fails, the comparison would be unfair (we'd
// be measuring an invalid format).

import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET = join(__dirname, 'dataset');
const CORE = resolve(__dirname, '../ts/packages/core/dist/index.js');

const { parseCvox } = await import(pathToFileURL(CORE).href);

const files = readdirSync(DATASET).filter((f) => f.endsWith('.cvox')).sort();
let failed = 0;
for (const f of files) {
  const text = readFileSync(join(DATASET, f), 'utf8');
  const r = parseCvox(text);
  if (r.ok) {
    console.log(`  OK   ${f}  (${r.value.parts.length} parts)`);
  } else {
    console.log(`  FAIL ${f}  [${r.code}] ${r.message}`);
    failed++;
  }
}
if (failed > 0) {
  console.error(`\n${failed} file(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${files.length} CBOX files parsed cleanly.`);
