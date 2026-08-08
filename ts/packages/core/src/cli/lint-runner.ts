import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseManifest } from '../manifest.js';
import type { Manifest } from '../manifest.js';
import {
  MANIFEST_FILE,
  palettePathsOf,
  projectFilePaths,
  resolveGeometries,
  resolveProject,
} from '../project.js';
import { tryReadText } from './fs.js';
import { validateProject } from '../lint/cross-file.js';
import { lintGeometry } from '../lint/voxel-rules.js';
import { parseGeometryText } from '../geometry/parse.js';
import type { Diagnostic } from '../diagnostic.js';

// Pure (modulo fs read) lint runner for a cuboidy model directory.
// Extracted from the CLI shell so it can be unit-tested without spawning
// child processes or capturing stdout. The CLI (cuboidy-lint.ts) is a
// thin layer over this: argv → RunOptions, runLint(), format → stdout,
// process.exit(exitCode).
//
// The manifest anchors everything: its `geometry` list and each part's
// own `geometry` (SPEC §6.9 / §6.13) name the model's geometry files, and
// palette references resolve from there.
//
// `cuboidy.json` is REQUIRED (§3). This runner used to lint a directory
// holding only `voxels.json` as a shape preview, which the specification
// never allowed — a lone geometry file has shape but no rig, no
// animations and no name, so there is nothing to lint it *as*, and half
// the rules (every cross-file one) could not run. The case that leniency
// served is now covered properly by inline geometry: one `cuboidy.json`
// with every part written into it is a complete model (§6.13).
//
// Exit code policy:
//   0  no errors (warnings/hints may be present)
//   1  one or more errors, OR --strict and any warning. A geometry /
//      palette file that the manifest references but that can't be read
//      is a broken reference — a model error, not a setup failure
//   2  IO / setup failure (no readable `cuboidy.json` — there is no model
//      here) — distinct from "model has errors" so CI can tell "we failed
//      to run" from "we ran and found problems"

export interface RunOptions {
  strict?: boolean;
}

export interface FileDiagnostic {
  file: string;
  diag: Diagnostic;
}

export interface RunResult {
  diagnostics: FileDiagnostic[];
  exitCode: 0 | 1 | 2;
}

// Pseudo-file label for diagnostics that span files (cross-file lint).
// Cross-file rules don't belong to a single source location, so we tag
// them with a sentinel rather than picking one file arbitrarily.
const CROSS_FILE_LABEL = '<cross-file>';

export async function runLint(
  dir: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const root = resolve(dir);
  const diagnostics: FileDiagnostic[] = [];

  // SPEC §3: the manifest is the package's anchor and is required. Its
  // absence is a setup failure, not a model finding — there is no model
  // to have findings about.
  const manifestPath = join(root, MANIFEST_FILE);
  const manifestText = await tryReadText(manifestPath);
  if (manifestText === null) {
    diagnostics.push({
      file: manifestPath,
      diag: {
        code: 'missing',
        severity: 'error',
        message: `cannot read ${MANIFEST_FILE} — a Cuboidy model is anchored by its manifest (§3). A lone geometry file is not a model; write its parts inline instead (§6.13)`,
      },
    });
    return { diagnostics, exitCode: 2 };
  }
  // A manifest that is present but broken IS a model finding: something is
  // here and it is wrong, which is the difference from the branch above.
  let manifest: Manifest | null = null;
  let json: unknown = null;
  let jsonOk = false;
  try {
    json = JSON.parse(manifestText);
    jsonOk = true;
  } catch (e) {
    diagnostics.push({
      file: manifestPath,
      diag: {
        code: 'invalid-value',
        severity: 'error',
        message: `JSON parse: ${(e as Error).message}`,
      },
    });
  }
  if (jsonOk) {
    const mR = parseManifest(json);
    if (!mR.ok) {
      diagnostics.push({
        file: manifestPath,
        diag: { code: mR.code, severity: 'error', message: mR.message },
      });
    } else {
      manifest = mR.value;
    }
  }

  // Referenced files (§6.9 geometry list with default, §7.4 palettes,
  // §6.3 external animations) are read here and resolved through the
  // shared project layer — the same layer view/query/snap and the editor
  // use, so lint agrees with them about what the model contains.
  // Unreadable files stay OUT of the map; resolveProject reports them as
  // `missing` diagnostics.
  //
  // Nothing is read when the manifest itself did not parse. §11.8 runs
  // validation in phases and forbids reporting a later one over an earlier
  // one, and `geometryPaths(null)` returns the §6.9 default — so a manifest
  // with an unknown top-level field used to be reported alongside a phase-4
  // `cannot read voxels.json`, for a file §6.9 says a reader "MUST NOT
  // demand" from a model that does not use it. There is no model here to
  // ask what it references.
  const paths =
    manifest === null
      ? { geometry: [], animations: [] }
      : projectFilePaths(manifest);
  const files = new Map<string, string>();
  for (const ref of [...paths.geometry, ...paths.animations]) {
    const text = await tryReadText(join(root, ref));
    if (text !== null) files.set(ref, text);
  }
  // §7.4 palette references live inside the geometry files, so they only
  // become visible once those are read — hence a second round. Unreadable
  // ones stay out of the map and resolveProject reports them as `missing`.
  for (const ref of palettePathsOf(resolveGeometries(manifest, files).geometries)) {
    if (files.has(ref)) continue;
    const text = await tryReadText(join(root, ref));
    if (text !== null) files.set(ref, text);
  }

  const project = resolveProject(manifest, files);
  for (const d of project.diagnostics) {
    diagnostics.push({ file: join(root, d.file), diag: d.diag });
  }
  for (const g of project.geometries) {
    for (const d of lintGeometry(g.geometry)) {
      diagnostics.push({ file: join(root, g.path), diag: d });
    }
  }

  // Cross-file validation runs only when every input loaded, parsed and
  // resolved cleanly — running it on partially-resolved projects would
  // just emit noise on top of the existing diagnostics.
  if (manifest !== null && project.complete) {
    for (const d of validateProject({
      manifest,
      geometries: project.geometries,
      parts: project.parts,
      unresolved: project.unresolved,
      externalAnims: project.externalAnims,
      packageGeometryPaths: await enumerateGeometryFiles(root),
    })) {
      diagnostics.push({ file: CROSS_FILE_LABEL, diag: d });
    }
  }

  return { diagnostics, exitCode: computeExitCode(diagnostics, opts) };
}

// Every geometry file in the package (recursive), as /-separated paths
// relative to the root — the same shape as normalized geometry refs, so W07
// can compare them verbatim.
//
// The extension no longer settles this. When geometry was `.geometry`, the suffix
// alone identified it; now the manifest, the palette binding, the animation
// clips and the geometry are all `.json`, so W07 would fire on `cuboidy.json`
// itself. Content decides instead: a file is geometry if the geometry reader
// accepts it. That is also the more honest test of what W07 means — "this
// parses as geometry and nothing references it".
async function enumerateGeometryFiles(root: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    const rel = entry.replaceAll('\\', '/');
    if (!rel.toLowerCase().endsWith('.json')) continue;
    if (rel === MANIFEST_FILE) continue;
    const text = await tryReadText(resolve(root, entry));
    // null: a directory, or unreadable — neither is a geometry file.
    if (text !== null && parseGeometryText(text).ok) found.push(rel);
  }
  return found;
}

function computeExitCode(
  diagnostics: FileDiagnostic[],
  opts: RunOptions,
): 0 | 1 {
  let hasError = false;
  let hasWarning = false;
  for (const { diag } of diagnostics) {
    if (diag.severity === 'error') hasError = true;
    else if (diag.severity === 'warning') hasWarning = true;
  }
  if (hasError) return 1;
  if (opts.strict === true && hasWarning) return 1;
  return 0;
}

// Formatter for SPEC §11.7. Lint diagnostics carry no source position
// (line numbers are lost during AST construction), so the `:<line>:<col>`
// span is omitted. Parse errors include line info in their message text;
// this is left as-is rather than re-extracted.
export function formatDiagnostic(fd: FileDiagnostic): string {
  const id = fd.diag.ruleId ?? fd.diag.code;
  return `${fd.file}: ${fd.diag.severity}: ${fd.diag.message} [${id}]`;
}
