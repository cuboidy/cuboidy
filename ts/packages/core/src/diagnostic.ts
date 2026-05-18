import type { CuboidyErrorCode } from './result.js';

export type Severity = 'error' | 'warning' | 'hint';

export interface Diagnostic {
  code: CuboidyErrorCode;
  severity: Severity;
  message: string;
}
