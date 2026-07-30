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
  // W07: cross-file — a geometry file exists in the package but is not
  // referenced by the manifest `geometry` list (SPEC §6.9 v0.7).
  | 'W07'
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
