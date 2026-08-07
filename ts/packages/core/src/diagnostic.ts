import type { CuboidyErrorCode } from './result.js';

export type Severity = 'error' | 'warning' | 'hint';

// SPEC §11.3 / §11.4 lint rule identifiers. Warnings start with `W`, hints
// with `H`. Numbering is stable (W01..W05, H01..H02) so external tooling
// can pin to specific rules. Add new IDs at the end; never renumber.
export type LintRuleId =
  | 'W01'
  | 'W02'
  | 'W03'
  | 'W04'
  | 'W05'
  // W06: cross-file — an `<x>-l` / `<x>-r` manifest pair whose positions are
  // not X-symmetric about the parent (likely a hand-mirrored asymmetry bug).
  | 'W06'
  // W07: cross-file — a geometry file exists in the package but is
  // referenced by neither the manifest `geometry` list nor any part's
  // `geometry.path` (SPEC §6.9, §6.13).
  | 'W07'
  // W08: cross-file — a manifest `palette` (§6.1) that no inline part falls
  // back to, so the binding does nothing. Usually a leftover v0.7 manifest,
  // where the same field overrode geometry files instead (SPEC §6.13).
  | 'W08'
  | 'H01'
  | 'H02'
  // H03: cross-file — a geometry file's inline palette is shadowed by the
  // manifest `palette` binding (SPEC §6.10 v0.7).
  | 'H03';

export interface Diagnostic {
  // Structural category (SPEC §11.2). For lint diagnostics that don't map
  // cleanly to a structural error, this falls back to `invalid-value` and
  // `ruleId` carries the precise identity.
  code: CuboidyErrorCode;
  severity: Severity;
  message: string;
  // Lint rule ID (W01..H02), present only for §11.3/§11.4 lint output.
  // When present, this is the canonical identifier for the diagnostic
  // (SPEC §11.7 prints `[<rule-id>]`); when absent, `code` is.
  ruleId?: LintRuleId;
}

// What a RESOLVER can say. `LintRuleId` is a vocabulary of authoring-time
// rules and resolution has none of them — it reports a file it could not
// read, a reference it could not bind, a name it could not disambiguate,
// and `project.ts` accordingly never set `ruleId` at any of its sites.
//
// Saying so in the type matters for the port: `docs/csharp-implementation.md`
// draws the line as "resolution is in scope, reporting is not", and without
// this the C# side would carry an eleven-value enum it can never populate
// into a library that has no lint. Structurally still a `Diagnostic`, so
// every consumer that renders lint output renders these unchanged.
export type ResolutionDiagnostic = Omit<Diagnostic, 'ruleId'>;
