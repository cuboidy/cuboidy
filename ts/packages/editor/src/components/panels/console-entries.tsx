import type { ConsoleEntry } from './ConsolePanel.js';
import type { FileDiagnostic } from '../../lib/lint.js';
import type { LoadedSource } from '../../lib/types.js';

// The Console panel's entry list and the Files tree's per-file errors,
// assembled from the same inputs — out of App so the two derivations
// live beside the panel that shows them.

// The model's current problems, for the Console panel. Derived, never
// stored. fileParseErrors already covers EVERY file including the primary
// geometry and the manifest, so each is listed once — the panel used to
// push those two separately as well, and reported each of them twice.
export function buildConsoleEntries(
  source: LoadedSource,
  fileParseErrors: ReadonlyMap<string, string>,
  manifestParseError: string | null,
  lintDiagnostics: readonly FileDiagnostic[],
): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [];
  for (const [path, msg] of fileParseErrors) {
    entries.push({
      severity: 'error',
      source: path,
      message: (
        <>
          <strong>Error:</strong> {msg}
        </>
      ),
    });
  }
  // A load-time manifest error stands until the text is edited, at which
  // point fileParseErrors takes over reporting it.
  const manifestPath = source.manifestPath;
  if (
    source.manifestError !== undefined &&
    !fileParseErrors.has(manifestPath)
  ) {
    entries.push({
      severity: 'error',
      source: manifestPath,
      message: (
        <>
          <strong>Error:</strong> {source.manifestError}
        </>
      ),
    });
  }
  for (const pe of source.projectErrors ?? []) {
    entries.push({ severity: 'error', source: pe.file, message: pe.message });
  }
  // Core's lint, on the model as it currently stands. Held back while
  // anything fails to parse: lint runs on an AST, so a stale one would
  // report findings about text the author has already replaced.
  if (fileParseErrors.size === 0 && manifestParseError === null) {
    for (const { file, diag } of lintDiagnostics) {
      entries.push({
        severity: diag.severity,
        source: file,
        message: (
          <>
            {diag.message}
            {diag.ruleId !== undefined && (
              <span className="console-rule"> [{diag.ruleId}]</span>
            )}
          </>
        ),
      });
    }
  }
  return entries;
}

// Error per file path (parse errors on live-edited files + load-time
// project errors) — red names in the Files tree.
export function buildTreeFileErrors(
  source: LoadedSource,
  fileParseErrors: ReadonlyMap<string, string>,
  manifestParseError: string | null,
  geometryParseError: string | null,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const pe of source.projectErrors ?? []) m.set(pe.file, pe.message);
  for (const [p, msg] of fileParseErrors) m.set(p, msg);
  const mErr = manifestParseError ?? source.manifestError;
  if (mErr !== undefined && mErr !== null) {
    m.set(source.manifestPath, mErr);
  }
  if (geometryParseError !== null && source.primaryPath !== undefined) {
    m.set(source.primaryPath, geometryParseError);
  }
  return m;
}
