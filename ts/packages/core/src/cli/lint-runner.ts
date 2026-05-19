import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseCvox } from '../cvox/parse.js';
import { parseManifest } from '../manifest.js';
import type { Manifest } from '../manifest.js';
import { validateCrossFile } from '../lint/cross-file.js';
import { lintCvox } from '../lint/voxel-rules.js';
import type { Diagnostic } from '../diagnostic.js';

// Pure (modulo fs read) lint runner for a cuboidy model directory.
// Extracted from the CLI shell so it can be unit-tested without spawning
// child processes or capturing stdout. The CLI (cuboidy-lint.ts) is a
// thin layer over this: argv → RunOptions, runLint(), format → stdout,
// process.exit(exitCode).
//
// Exit code policy:
//   0  no errors (warnings/hints may be present)
//   1  one or more errors, OR --strict and any warning
//   2  IO / setup failure (e.g. voxels.cvox missing) — distinct from
//      "model has errors" so CI can tell "we failed to run" from "we ran
//      and found problems"

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

const VOXELS_FILE = 'voxels.cvox';
const MANIFEST_FILE = 'cuboidy.json';
// Pseudo-file label for diagnostics that span both files (cross-file lint).
// Cross-file rules don't belong to a single source location, so we tag
// them with a sentinel rather than picking one file arbitrarily.
const CROSS_FILE_LABEL = '<cross-file>';

export async function runLint(
  dir: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const root = resolve(dir);
  const voxelsPath = join(root, VOXELS_FILE);
  const manifestPath = join(root, MANIFEST_FILE);

  const voxelsText = await tryReadText(voxelsPath);
  if (voxelsText === null) {
    return {
      diagnostics: [
        {
          file: voxelsPath,
          diag: {
            code: 'missing',
            severity: 'error',
            message: `cannot read ${VOXELS_FILE}`,
          },
        },
      ],
      exitCode: 2,
    };
  }

  const diagnostics: FileDiagnostic[] = [];

  const voxR = parseCvox(voxelsText);
  if (!voxR.ok) {
    diagnostics.push({
      file: voxelsPath,
      diag: { code: voxR.code, severity: 'error', message: voxR.message },
    });
  }

  // Manifest is optional. A voxel-only directory (`voxels.cvox` without a
  // sibling `cuboidy.json`) is a valid input — useful for previewing a
  // shape before wiring up rig hierarchy.
  const manifestText = await tryReadText(manifestPath);
  let manifestValue: Manifest | null = null;
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
        manifestValue = mR.value;
      }
    }
  }

  // Lint + cross-file only run when both halves parsed cleanly. Running
  // them on partially-parsed inputs would just emit noise on top of the
  // existing parse errors.
  if (voxR.ok) {
    for (const d of lintCvox(voxR.value)) {
      diagnostics.push({ file: voxelsPath, diag: d });
    }
    if (manifestValue !== null) {
      for (const d of validateCrossFile(manifestValue, voxR.value)) {
        diagnostics.push({ file: CROSS_FILE_LABEL, diag: d });
      }
    }
  }

  return { diagnostics, exitCode: computeExitCode(diagnostics, opts) };
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
