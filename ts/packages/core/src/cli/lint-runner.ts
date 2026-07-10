import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseManifest } from '../manifest.js';
import type { Manifest } from '../manifest.js';
import { projectFilePaths, resolveProject } from '../project.js';
import { validateProject } from '../lint/cross-file.js';
import { lintCvox } from '../lint/voxel-rules.js';
import type { Diagnostic } from '../diagnostic.js';

// Pure (modulo fs read) lint runner for a cuboidy model directory.
// Extracted from the CLI shell so it can be unit-tested without spawning
// child processes or capturing stdout. The CLI (cuboidy-lint.ts) is a
// thin layer over this: argv → RunOptions, runLint(), format → stdout,
// process.exit(exitCode).
//
// v0.7 project shape: the manifest's `geometry` list (default
// ["voxels.cvox"]) names the model's cvox files, and its `palette`
// reference binds an external palette (SPEC §6.9 / §6.10). A directory
// with no manifest still lints its voxels.cvox alone (shape preview).
//
// Exit code policy:
//   0  no errors (warnings/hints may be present)
//   1  one or more errors, OR --strict and any warning. A geometry /
//      palette file that the manifest references but that can't be read
//      is a broken reference — a model error, not a setup failure
//   2  IO / setup failure (no manifest AND no voxels.cvox — nothing to
//      lint) — distinct from "model has errors" so CI can tell "we
//      failed to run" from "we ran and found problems"

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

const MANIFEST_FILE = 'cuboidy.json';
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

  // Manifest is optional. A voxel-only directory (`voxels.cvox` without a
  // sibling `cuboidy.json`) is a valid input — useful for previewing a
  // shape before wiring up rig hierarchy.
  const manifestPath = join(root, MANIFEST_FILE);
  const manifestText = await tryReadText(manifestPath);
  let manifest: Manifest | null = null;
  if (manifestText !== null) {
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
  }

  // Referenced files (§6.9 geometry list with default, §6.10 palette)
  // are read here and resolved through the shared project layer — the
  // same layer view/query/snap and the editor use, so lint agrees with
  // them about what the model contains. Unreadable files stay OUT of the
  // map; resolveProject reports them as `missing` diagnostics.
  const paths = projectFilePaths(manifest);
  const refs =
    paths.palette !== undefined
      ? [...paths.geometry, paths.palette]
      : paths.geometry;
  const files = new Map<string, string>();
  for (const ref of refs) {
    const text = await tryReadText(join(root, ref));
    if (text !== null) files.set(ref, text);
  }

  // Nothing to lint at all: no manifest and no readable voxels.cvox is a
  // setup failure (exit 2), not a model error.
  const anyGeometryRead = paths.geometry.some((ref) => files.has(ref));
  if (manifestText === null && !anyGeometryRead) {
    for (const ref of paths.geometry) {
      diagnostics.push({
        file: join(root, ref),
        diag: {
          code: 'missing',
          severity: 'error',
          message: `cannot read ${ref}`,
        },
      });
    }
    return { diagnostics, exitCode: 2 };
  }

  const project = resolveProject(manifest, files);
  for (const d of project.diagnostics) {
    diagnostics.push({ file: join(root, d.file), diag: d.diag });
  }
  for (const g of project.geometries) {
    for (const d of lintCvox(g.cvox)) {
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
      ...(project.externalPalette !== undefined && {
        externalPalette: project.externalPalette,
      }),
      packageCvoxPaths: await enumerateCvoxFiles(root),
    })) {
      diagnostics.push({ file: CROSS_FILE_LABEL, diag: d });
    }
  }

  return { diagnostics, exitCode: computeExitCode(diagnostics, opts) };
}

// All .cvox files in the package (recursive), as /-separated paths
// relative to the root — the same shape as normalized geometry refs, so
// W07 can compare them verbatim.
async function enumerateCvoxFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { recursive: true });
    return entries
      .filter((p) => p.toLowerCase().endsWith('.cvox'))
      .map((p) => p.replaceAll('\\', '/'));
  } catch {
    return [];
  }
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

async function tryReadText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

// Formatter for SPEC §11.7. Lint diagnostics carry no source position
// (line numbers are lost during AST construction), so the `:<line>:<col>`
// span is omitted. Parse errors include line info in their message text;
// this is left as-is rather than re-extracted.
export function formatDiagnostic(fd: FileDiagnostic): string {
  const id = fd.diag.ruleId ?? fd.diag.code;
  return `${fd.file}: ${fd.diag.severity}: ${fd.diag.message} [${id}]`;
}
