import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseManifest, type Manifest } from '../manifest.js';
import { expandProjectReuse } from '../migrate.js';
import { projectFilePaths } from '../project.js';

// `cuboidy-migrate <dir>`: expand a package's clone/mirror parts into
// concrete geometry, in place. A one-shot upgrade step — after it runs a
// model no longer depends on the reuse grammar. All work is here; the bin is
// a thin arg shell.

export interface RunResult {
  text: string;
  exitCode: number;
}

export async function runMigrate(dir: string): Promise<RunResult> {
  // Manifest is optional (a lone voxels.cvox with same-file reuse is a valid
  // default package); when present it must parse.
  let manifest: Manifest | null = null;
  let manifestText: string | undefined;
  try {
    manifestText = await readFile(join(dir, 'cuboidy.json'), 'utf8');
  } catch {
    manifestText = undefined;
  }
  if (manifestText !== undefined) {
    let json: unknown;
    try {
      json = JSON.parse(manifestText);
    } catch (e) {
      return {
        text: `cuboidy.json: JSON parse: ${(e as Error).message}`,
        exitCode: 1,
      };
    }
    const r = parseManifest(json);
    if (!r.ok) return { text: `cuboidy.json: ${r.message}`, exitCode: 1 };
    manifest = r.value;
  }

  // Read every referenced file so resolveProject can fully resolve (a
  // missing palette/animation would otherwise abort the migration).
  const paths = projectFilePaths(manifest);
  const refs = [
    ...paths.geometry,
    ...(paths.palette !== undefined ? [paths.palette] : []),
    ...paths.animations,
  ];
  const files = new Map<string, string>();
  for (const ref of refs) {
    try {
      files.set(ref, await readFile(join(dir, ref), 'utf8'));
    } catch {
      // resolveProject reports the missing file as a diagnostic.
    }
  }

  const result = expandProjectReuse(manifest, files);
  if (!result.complete) {
    const msg = result.diagnostics
      .map((d) => `  ${d.file}: ${d.diag.message}`)
      .join('\n');
    return {
      text: `cannot migrate — model did not resolve:\n${msg}`,
      exitCode: 1,
    };
  }
  if (result.files.size === 0) {
    return { text: 'no clone/mirror parts to expand — nothing to do', exitCode: 0 };
  }

  const written: string[] = [];
  for (const [path, text] of result.files) {
    try {
      await writeFile(join(dir, path), text);
    } catch (e) {
      return {
        text: `cannot write ${path}: ${(e as Error).message}`,
        exitCode: 2,
      };
    }
    written.push(path);
  }
  return { text: `expanded reuse in: ${written.join(', ')}`, exitCode: 0 };
}
