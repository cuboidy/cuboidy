import type { CuboidyErrorCode } from './result.js';

export type Severity = 'error' | 'warning' | 'hint';

// SPEC §11.3 / §11.4 lint rule identifiers. Warnings start with `W`, hints
// with `H`. Numbering is stable (W01..W05, H01..H02) so external tooling
// can pin to specific rules. Add new IDs at the end; never renumber.
export type LintRuleId = 'W01' | 'W02' | 'W03' | 'W04' | 'W05' | 'H01' | 'H02';

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
