import { lintGeometry } from './voxel-rules.js';
import { validateProject } from './cross-file.js';
import type { Diagnostic } from '../diagnostic.js';
import type { Geometry } from '../geometry/types.js';
import type { InlineAnimation } from '../animation.js';
import type { Manifest } from '../manifest.js';
import type { DuplicatePartName, ResolvedPart, UnresolvedPart } from '../project.js';

// Linting a whole project: the per-file rules over every geometry file, then
// the cross-file rules over the resolved whole.
//
// This exists because it was written twice — once in `cli/lint-runner.ts`
// and once in the editor's `lib/lint.ts` — and the copies disagreed about
// something that matters. The CLI runs cross-file validation only when
// resolution came back clean; the editor ran it unconditionally, because
// its loader never surfaced the equivalent flag. So a package with one
// missing referenced file produced a short, accurate diagnosis from
// `cuboidy-lint` and a wall of consequential noise in the editor: W07 on
// files that ARE referenced by the file that failed to load, "not used by
// any manifest part" on parts whose shapes never arrived, and a missing-part
// error for each. The one place a model is authored was the one place the
// report was least usable.
//
// The seam is deliberately AFTER resolution. How a host enumerates files —
// the CLI walks a directory, the editor walks a captured in-memory map — is
// the only thing that genuinely differs between them, and it stays theirs.

/** Stands in for a path on findings that belong to no single file. */
export const CROSS_FILE = '<cross-file>';

export interface FileDiagnostic {
  /** Package-relative path, or CROSS_FILE for a whole-project finding. */
  file: string;
  diag: Diagnostic;
}

export interface ProjectLintInput {
  // Absent for a bare geometry load: there is no project to validate, and
  // a geometry file on its own is complete.
  manifest: Manifest | null;
  geometries: readonly { path: string; geometry: Geometry }[];
  parts: ReadonlyMap<string, ResolvedPart>;
  unresolved: readonly UnresolvedPart[];
  duplicates: readonly DuplicatePartName[];
  externalAnims: ReadonlyMap<string, { path: string; anim: InlineAnimation }>;
  // Every file in the package that IS geometry, package-relative, for W07.
  // Decided by content rather than extension — since v0.9 the manifest,
  // palettes and clips are all `.json` too.
  packageGeometryPaths: readonly string[];
  // Did every referenced file load, parse and resolve? Cross-file rules run
  // only when it did. Validating a half-resolved project reports the
  // consequences of the failure alongside the failure, which buries it.
  complete: boolean;
}

export function lintProject(input: ProjectLintInput): FileDiagnostic[] {
  const out: FileDiagnostic[] = [];

  for (const { path, geometry } of input.geometries) {
    for (const diag of lintGeometry(geometry)) out.push({ file: path, diag });
  }

  if (input.manifest === null || !input.complete) return out;

  for (const diag of validateProject({
    manifest: input.manifest,
    geometries: input.geometries,
    parts: input.parts,
    unresolved: input.unresolved,
    duplicates: input.duplicates,
    externalAnims: input.externalAnims,
    packageGeometryPaths: input.packageGeometryPaths,
  })) {
    out.push({ file: CROSS_FILE, diag });
  }

  return out;
}
