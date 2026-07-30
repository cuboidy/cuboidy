// One-shot migration: rewrites every `.cvox` geometry file in the repo as
// `.json`, and updates each manifest's `geometry` list to match.
//
// Delete this script once the migration has landed — it exists to move the
// corpus across exactly once, not as ongoing tooling.
//
//   npx tsx scripts/migrate-cvox-to-json.ts --dry-run
//   npx tsx scripts/migrate-cvox-to-json.ts

import { readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCvox } from '../src/cvox/parse.js';
import { serializeGeometry } from '../src/geometry/serialize.js';
import { parseGeometryText } from '../src/geometry/parse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..');
const dryRun = process.argv.includes('--dry-run');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'out') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const all = walk(join(REPO, 'models'));
const geometryFiles = all.filter((f) => f.endsWith('.cvox'));
const manifests = all.filter((f) => f.endsWith('cuboidy.json'));

let converted = 0;
let headers = 0;
for (const file of geometryFiles) {
  const text = readFileSync(file, 'utf8');
  const parsed = parseCvox(text);
  if (!parsed.ok) throw new Error(`${relative(REPO, file)}: ${parsed.message}`);

  const json = serializeGeometry(parsed.value);

  // Never write a file the new reader cannot read back to the same model.
  const back = parseGeometryText(json);
  if (!back.ok) throw new Error(`${relative(REPO, file)}: re-read failed: ${back.message}`);
  const { header: _drop, ...expected } = parsed.value as typeof parsed.value & {
    header?: readonly string[];
  };
  if (JSON.stringify(back.value) !== JSON.stringify(expected)) {
    throw new Error(`${relative(REPO, file)}: round-trip changed the model`);
  }

  const target = file.replace(/\.cvox$/, '.json');
  console.log(`${relative(REPO, file)} → ${relative(REPO, target)}`);
  if (!dryRun) {
    writeFileSync(target, json, 'utf8');
    unlinkSync(file);
  }
  converted += 1;

  // Header comments are dropped, not relocated. They documented what each
  // palette index meant ("0=skin 1=hair"), which is recoverable from the file
  // itself — the colours are right there and so is where each index is used.
  if (parsed.value.header && parsed.value.header.length > 0) headers += 1;
}

let touched = 0;
for (const file of manifests) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('.cvox')) continue;
  const next = text.replace(/\.cvox"/g, '.json"');
  console.log(`${relative(REPO, file)}: geometry entries rewritten`);
  if (!dryRun) writeFileSync(file, next, 'utf8');
  touched += 1;
}

console.log(
  `\n${converted} geometry files, ${headers} headers dropped, ${touched} manifests` +
    (dryRun ? ' (dry run — nothing written)' : ''),
);
